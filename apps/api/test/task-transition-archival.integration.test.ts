import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ErrorFilter } from '../src/error.filter';
import cookieParser from 'cookie-parser';
import { createDatabase } from '@floz/database';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/floz';
process.env.DATABASE_URL = databaseUrl;
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? 'test-secret-at-least-32-characters-long';

type Fixture = {
  app: INestApplication;
  adminCookie: string;
  adminId: string;
  workspaceId: string;
  workflowId: string;
  todoStatusId: string;
  inProgressStatusId: string;
  doneStatusId: string;
  archivedStatusId: string;
};

async function createApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new ErrorFilter());
  await app.init();
  return app;
}

async function login(app: INestApplication, email: string, password = 'password123') {
  const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password }).expect(200);
  return res.headers['set-cookie'][0].split(';')[0];
}

async function resetDatabase() {
  const { sql: client } = createDatabase(databaseUrl);
  await client`TRUNCATE mentions, comments, approval_steps, approval_requests, task_history, task_assignees, tasks, recurrence_occurrences, recurrence_rules, recurrence_idempotency_keys, team_memberships, teams, workflow_transitions, task_statuses, workflows, workspace_memberships, workspaces, roles, sessions, accounts, users, verifications, outbox_events, notifications, notification_preferences, notification_dedup_ledger RESTART IDENTITY CASCADE`;
  await client.end();
}

async function createFixture(): Promise<Fixture> {
  await resetDatabase();
  const app = await createApp();
  const auth = app.get(AuthService).auth;
  const admin = await auth.api.signUpEmail({ body: { email: 'admin@example.com', password: 'password123', name: 'Admin User' } });
  const adminCookie = await login(app, 'admin@example.com');

  const { sql: client } = createDatabase(databaseUrl);
  const roles = await client`INSERT INTO roles (code, name) VALUES ('ADMIN', 'Admin') ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id, code`;
  const adminRoleId = roles.find((r) => r.code === 'ADMIN')!.id;

  const workspace = (await client<{ id: string }[]>`INSERT INTO workspaces (name, slug, created_by) VALUES ('Test Workspace', 'test-ws', ${admin.user.id}) RETURNING id`)[0];
  await client`INSERT INTO workspace_memberships (workspace_id, user_id, role_id, status) VALUES (${workspace.id}, ${admin.user.id}, ${adminRoleId}, 'ACTIVE')`;

  // Workflow setup
  // Grab the auto-created default workflow
  const wf = (await client<{ id: string }[]>`SELECT id FROM workflows WHERE workspace_id=${workspace.id} AND is_default = true AND is_active = true AND team_id IS NULL LIMIT 1`)[0];
  const workflowId = wf.id;

  // Clear existing default transitions and statuses so we can define our custom matrix
  await client`DELETE FROM workflow_transitions WHERE workflow_id=${workflowId}`;
  await client`DELETE FROM task_statuses WHERE workflow_id=${workflowId}`;

  const todo = (await client<{ id: string }[]>`INSERT INTO task_statuses (workflow_id, name, code, category, position, is_initial, is_terminal, is_active) VALUES (${workflowId}, 'To Do', 'TODO', 'TODO', 10, true, false, true) RETURNING id`)[0];
  const inProg = (await client<{ id: string }[]>`INSERT INTO task_statuses (workflow_id, name, code, category, position, is_initial, is_terminal, is_active) VALUES (${workflowId}, 'In Progress', 'IN_PROGRESS', 'IN_PROGRESS', 20, false, false, true) RETURNING id`)[0];
  const done = (await client<{ id: string }[]>`INSERT INTO task_statuses (workflow_id, name, code, category, position, is_initial, is_terminal, is_active) VALUES (${workflowId}, 'Done', 'DONE', 'DONE', 30, false, true, true) RETURNING id`)[0];
  const arch = (await client<{ id: string }[]>`INSERT INTO task_statuses (workflow_id, name, code, category, position, is_initial, is_terminal, is_active) VALUES (${workflowId}, 'Legacy Stage', 'LEGACY', 'IN_PROGRESS', 40, false, false, false) RETURNING id`)[0];

  // Configure transition matrix:
  // TODO -> IN_PROGRESS, TODO -> DONE, LEGACY (archived) -> IN_PROGRESS, LEGACY -> LEGACY, IN_PROGRESS -> LEGACY, IN_PROGRESS -> DONE, DONE -> TODO
  const transitions = [
    { from: todo.id, to: inProg.id },
    { from: todo.id, to: done.id },
    { from: arch.id, to: inProg.id },
    { from: arch.id, to: arch.id },
    { from: inProg.id, to: arch.id },
    { from: inProg.id, to: done.id },
    { from: done.id, to: todo.id }
  ];
  for (const t of transitions) {
    await client`INSERT INTO workflow_transitions (workflow_id, from_status_id, to_status_id) VALUES (${workflowId}, ${t.from}, ${t.to})`;
  }
  await client.end();

  return {
    app,
    adminCookie,
    adminId: admin.user.id,
    workspaceId: workspace.id,
    workflowId,
    todoStatusId: todo.id,
    inProgressStatusId: inProg.id,
    doneStatusId: done.id,
    archivedStatusId: arch.id
  };
}

describe('Task Runtime Transition Enforcement & Archived Status Escape (Task 7)', () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await createFixture();
  });

  afterAll(async () => {
    if (f?.app) await f.app.close();
  });

  it('1. available-transitions from archived status returns ONLY active targets', async () => {
    const base = `/api/v1/workspaces/${f.workspaceId}`;
    // Create task in active status then force its status_id to archived status
    const created = await request(f.app.getHttpServer())
      .post(`${base}/tasks`)
      .set('Cookie', f.adminCookie)
      .send({ title: 'Archived Source Task', workflow_id: f.workflowId, status_id: f.todoStatusId })
      .expect(201);

    const taskId = created.body.data.id;
    const { sql: client } = createDatabase(databaseUrl);
    await client`UPDATE tasks SET status_id=${f.archivedStatusId} WHERE id=${taskId}`;
    await client.end();

    const transitionsRes = await request(f.app.getHttpServer())
      .get(`${base}/tasks/${taskId}/available-transitions`)
      .set('Cookie', f.adminCookie)
      .expect(200);

    const targetIds = transitionsRes.body.data.map((t: { to_status_id: string }) => t.to_status_id);
    expect(targetIds).toContain(f.inProgressStatusId);
    expect(targetIds).not.toContain(f.archivedStatusId);
  });

  it('2. task in archived status CAN transition to active target (archived status escape)', async () => {
    const base = `/api/v1/workspaces/${f.workspaceId}`;
    const created = await request(f.app.getHttpServer())
      .post(`${base}/tasks`)
      .set('Cookie', f.adminCookie)
      .send({ title: 'Escape Task', workflow_id: f.workflowId, status_id: f.todoStatusId })
      .expect(201);

    const taskId = created.body.data.id;
    let version = created.body.data.version;

    const { sql: client } = createDatabase(databaseUrl);
    await client`UPDATE tasks SET status_id=${f.archivedStatusId} WHERE id=${taskId}`;
    await client.end();

    const res = await request(f.app.getHttpServer())
      .post(`${base}/tasks/${taskId}/transitions`)
      .set('Cookie', f.adminCookie)
      .send({ version, to_status_id: f.inProgressStatusId })
      .expect(201);

    expect(res.body.task.status.id).toBe(f.inProgressStatusId);
    expect(res.body.task.completed_at).toBeNull();
  });

  it('3. active source task transitioning to archived target status fails with 422 INVALID_TRANSITION', async () => {
    const base = `/api/v1/workspaces/${f.workspaceId}`;
    const created = await request(f.app.getHttpServer())
      .post(`${base}/tasks`)
      .set('Cookie', f.adminCookie)
      .send({ title: 'Target Inactive Task', workflow_id: f.workflowId, status_id: f.inProgressStatusId })
      .expect(201);

    const taskId = created.body.data.id;
    const version = created.body.data.version;

    await request(f.app.getHttpServer())
      .post(`${base}/tasks/${taskId}/transitions`)
      .set('Cookie', f.adminCookie)
      .send({ version, to_status_id: f.archivedStatusId })
      .expect(422)
      .expect(({ body }) => {
        expect(body.error.code).toBe('INVALID_TRANSITION');
      });
  });

  it('4. archived source task transitioning to archived target fails with 422 INVALID_TRANSITION', async () => {
    const base = `/api/v1/workspaces/${f.workspaceId}`;
    const created = await request(f.app.getHttpServer())
      .post(`${base}/tasks`)
      .set('Cookie', f.adminCookie)
      .send({ title: 'Archived to Archived Task', workflow_id: f.workflowId, status_id: f.todoStatusId })
      .expect(201);

    const taskId = created.body.data.id;
    const version = created.body.data.version;

    const { sql: client } = createDatabase(databaseUrl);
    await client`UPDATE tasks SET status_id=${f.archivedStatusId} WHERE id=${taskId}`;
    await client.end();

    await request(f.app.getHttpServer())
      .post(`${base}/tasks/${taskId}/transitions`)
      .set('Cookie', f.adminCookie)
      .send({ version, to_status_id: f.archivedStatusId })
      .expect(422)
      .expect(({ body }) => {
        expect(body.error.code).toBe('INVALID_TRANSITION');
      });
  });

  it('5. open -> DONE sets completed_at and records COMPLETED history', async () => {
    const base = `/api/v1/workspaces/${f.workspaceId}`;
    const created = await request(f.app.getHttpServer())
      .post(`${base}/tasks`)
      .set('Cookie', f.adminCookie)
      .send({ title: 'Complete Task', workflow_id: f.workflowId, status_id: f.todoStatusId })
      .expect(201);

    const taskId = created.body.data.id;
    const version = created.body.data.version;

    const res = await request(f.app.getHttpServer())
      .post(`${base}/tasks/${taskId}/transitions`)
      .set('Cookie', f.adminCookie)
      .send({ version, to_status_id: f.doneStatusId })
      .expect(201);

    expect(res.body.task.status.id).toBe(f.doneStatusId);
    expect(res.body.task.completed_at).not.toBeNull();

    const historyRes = await request(f.app.getHttpServer())
      .get(`${base}/tasks/${taskId}/history`)
      .set('Cookie', f.adminCookie)
      .expect(200);

    const lastHistory = historyRes.body.data[historyRes.body.data.length - 1];
    expect(lastHistory.event_type).toBe('COMPLETED');
  });

  it('6. DONE -> open status clears completed_at and records REOPENED history', async () => {
    const base = `/api/v1/workspaces/${f.workspaceId}`;
    const created = await request(f.app.getHttpServer())
      .post(`${base}/tasks`)
      .set('Cookie', f.adminCookie)
      .send({ title: 'Reopen Task', workflow_id: f.workflowId, status_id: f.todoStatusId })
      .expect(201);

    const taskId = created.body.data.id;
    let version = created.body.data.version;

    // Transition to DONE
    const doneRes = await request(f.app.getHttpServer())
      .post(`${base}/tasks/${taskId}/transitions`)
      .set('Cookie', f.adminCookie)
      .send({ version, to_status_id: f.doneStatusId })
      .expect(201);

    version = doneRes.body.task.version;
    expect(doneRes.body.task.completed_at).not.toBeNull();

    // Transition DONE -> TODO
    const reopenRes = await request(f.app.getHttpServer())
      .post(`${base}/tasks/${taskId}/transitions`)
      .set('Cookie', f.adminCookie)
      .send({ version, to_status_id: f.todoStatusId })
      .expect(201);

    expect(reopenRes.body.task.status.id).toBe(f.todoStatusId);
    expect(reopenRes.body.task.completed_at).toBeNull();

    const historyRes = await request(f.app.getHttpServer())
      .get(`${base}/tasks/${taskId}/history`)
      .set('Cookie', f.adminCookie)
      .expect(200);

    const lastHistory = historyRes.body.data[historyRes.body.data.length - 1];
    expect(lastHistory.event_type).toBe('REOPENED');
  });

  it('7. existing tasks remain readable and executable after workflow is archived', async () => {
    const base = `/api/v1/workspaces/${f.workspaceId}`;

    // Create existing task while workflow is active
    const created = await request(f.app.getHttpServer())
      .post(`${base}/tasks`)
      .set('Cookie', f.adminCookie)
      .send({ title: 'Archived Workflow Task', workflow_id: f.workflowId, status_id: f.todoStatusId })
      .expect(201);

    const taskId = created.body.data.id;
    const initialVersion = created.body.data.version;

    // Archive the workflow directly in database
    const { sql: client } = createDatabase(databaseUrl);
    await client`UPDATE workflows SET is_active = false WHERE id = ${f.workflowId}`;
    await client.end();

    // 1. GET Task -> still readable
    const detailRes = await request(f.app.getHttpServer())
      .get(`${base}/tasks/${taskId}`)
      .set('Cookie', f.adminCookie)
      .expect(200);
    expect(detailRes.body.data.id).toBe(taskId);

    // 2. GET available-transitions -> active target (inProgressStatusId) still available
    const transitionsRes = await request(f.app.getHttpServer())
      .get(`${base}/tasks/${taskId}/available-transitions`)
      .set('Cookie', f.adminCookie)
      .expect(200);
    const targetIds = transitionsRes.body.data.map((t: { to_status_id: string }) => t.to_status_id);
    expect(targetIds).toContain(f.inProgressStatusId);

    // 3. POST transition TODO -> IN_PROGRESS -> succeeds, version increments, history recorded
    const transitionRes = await request(f.app.getHttpServer())
      .post(`${base}/tasks/${taskId}/transitions`)
      .set('Cookie', f.adminCookie)
      .send({ version: initialVersion, to_status_id: f.inProgressStatusId })
      .expect(201);

    expect(transitionRes.body.task.status.id).toBe(f.inProgressStatusId);
    expect(transitionRes.body.task.version).toBe(initialVersion + 1);

    const historyRes = await request(f.app.getHttpServer())
      .get(`${base}/tasks/${taskId}/history`)
      .set('Cookie', f.adminCookie)
      .expect(200);
    const lastHistory = historyRes.body.data[historyRes.body.data.length - 1];
    expect(lastHistory.to_status_id).toBe(f.inProgressStatusId);

    // 4. Transition to archived target status while workflow is archived -> 422 INVALID_TRANSITION
    await request(f.app.getHttpServer())
      .post(`${base}/tasks/${taskId}/transitions`)
      .set('Cookie', f.adminCookie)
      .send({ version: transitionRes.body.task.version, to_status_id: f.archivedStatusId })
      .expect(422)
      .expect(({ body }) => {
        expect(body.error.code).toBe('INVALID_TRANSITION');
      });

    // 5. Creating a new task with archived workflow -> rejected
    await request(f.app.getHttpServer())
      .post(`${base}/tasks`)
      .set('Cookie', f.adminCookie)
      .send({ title: 'New Task Archived Workflow', workflow_id: f.workflowId, status_id: f.todoStatusId })
      .expect(422)
      .expect(({ body }) => {
        expect(body.error.code).toBe('WORKFLOW_SCOPE_MISMATCH');
      });

    // Restore workflow active state for cleanup/subsequent tests
    const { sql: cleanupClient } = createDatabase(databaseUrl);
    await cleanupClient`UPDATE workflows SET is_active = true WHERE id = ${f.workflowId}`;
    await cleanupClient.end();
  });
});
