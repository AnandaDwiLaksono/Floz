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
  memberCookie: string;
  adminId: string;
  memberId: string;
  workspaceId: string;
  workflowId: string;
  todoId: string;
  inProgId: string;
  doneId: string;
  cancelledId: string;
  archivedStatus1Id: string;
  archivedStatus2Id: string;
  emptyArchivedStatusId: string;
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
  const member = await auth.api.signUpEmail({ body: { email: 'member@example.com', password: 'password123', name: 'Member User' } });
  const adminCookie = await login(app, 'admin@example.com');
  const memberCookie = await login(app, 'member@example.com');

  const { sql: client } = createDatabase(databaseUrl);
  const roles = await client`INSERT INTO roles (code, name) VALUES ('ADMIN', 'Admin'), ('MEMBER', 'Member') ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id, code`;
  const adminRoleId = roles.find((r) => r.code === 'ADMIN')!.id;
  const memberRoleId = roles.find((r) => r.code === 'MEMBER')!.id;

  const workspace = (await client<{ id: string }[]>`INSERT INTO workspaces (name, slug, created_by) VALUES ('Kanban WS', 'kanban-ws', ${admin.user.id}) RETURNING id`)[0];
  await client`INSERT INTO workspace_memberships (workspace_id, user_id, role_id, status) VALUES (${workspace.id}, ${admin.user.id}, ${adminRoleId}, 'ACTIVE'), (${workspace.id}, ${member.user.id}, ${memberRoleId}, 'ACTIVE')`;

  // Fetch auto-created workflow and delete default statuses
  const wf = (await client<{ id: string }[]>`SELECT id FROM workflows WHERE workspace_id=${workspace.id} AND is_default = true AND is_active = true LIMIT 1`)[0];
  const workflowId = wf.id;

  await client`DELETE FROM workflow_transitions WHERE workflow_id=${workflowId}`;
  await client`DELETE FROM task_statuses WHERE workflow_id=${workflowId}`;

  // Insert active statuses (TODO, IN_PROGRESS, DONE, CANCELLED)
  const todo = (await client<{ id: string }[]>`INSERT INTO task_statuses (workflow_id, name, code, category, position, is_initial, is_terminal, is_active) VALUES (${workflowId}, 'To Do', 'TODO', 'TODO', 10, true, false, true) RETURNING id`)[0];
  const inProg = (await client<{ id: string }[]>`INSERT INTO task_statuses (workflow_id, name, code, category, position, is_initial, is_terminal, is_active) VALUES (${workflowId}, 'In Progress', 'IN_PROGRESS', 'IN_PROGRESS', 20, false, false, true) RETURNING id`)[0];
  const done = (await client<{ id: string }[]>`INSERT INTO task_statuses (workflow_id, name, code, category, position, is_initial, is_terminal, is_active) VALUES (${workflowId}, 'Done', 'DONE', 'DONE', 30, false, true, true) RETURNING id`)[0];
  const cancelled = (await client<{ id: string }[]>`INSERT INTO task_statuses (workflow_id, name, code, category, position, is_initial, is_terminal, is_active) VALUES (${workflowId}, 'Cancelled', 'CANCELLED', 'CANCELLED', 40, false, true, true) RETURNING id`)[0];

  // Insert archived statuses
  const arch1 = (await client<{ id: string }[]>`INSERT INTO task_statuses (workflow_id, name, code, category, position, is_initial, is_terminal, is_active) VALUES (${workflowId}, 'Old Review', 'OLD_REV', 'IN_PROGRESS', 15, false, false, false) RETURNING id`)[0];
  const arch2 = (await client<{ id: string }[]>`INSERT INTO task_statuses (workflow_id, name, code, category, position, is_initial, is_terminal, is_active) VALUES (${workflowId}, 'Legacy QA', 'LEG_QA', 'IN_PROGRESS', 25, false, false, false) RETURNING id`)[0];
  const archEmpty = (await client<{ id: string }[]>`INSERT INTO task_statuses (workflow_id, name, code, category, position, is_initial, is_terminal, is_active) VALUES (${workflowId}, 'Empty Stage', 'EMPTY_STAGE', 'TODO', 5, false, false, false) RETURNING id`)[0];

  await client.end();

  return {
    app,
    adminCookie,
    memberCookie,
    adminId: admin.user.id,
    memberId: member.user.id,
    workspaceId: workspace.id,
    workflowId,
    todoId: todo.id,
    inProgId: inProg.id,
    doneId: done.id,
    cancelledId: cancelled.id,
    archivedStatus1Id: arch1.id,
    archivedStatus2Id: arch2.id,
    emptyArchivedStatusId: archEmpty.id
  };
}

describe('Read Projections, Kanban & Recurrence Compatibility (Task 8)', () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await createFixture();
  });

  afterAll(async () => {
    if (f?.app) await f.app.close();
  });

  it('1. Kanban projection includes ALL active statuses including active CANCELLED', async () => {
    const base = `/api/v1/workspaces/${f.workspaceId}`;
    const res = await request(f.app.getHttpServer())
      .get(`${base}/kanban`)
      .set('Cookie', f.memberCookie)
      .expect(200);

    const activeColumnIds = res.body.data.columns.map((c: { status: { id: string } }) => c.status.id);
    expect(activeColumnIds).toEqual([f.todoId, f.inProgId, f.doneId, f.cancelledId]);
  });

  it('2. occupied archived statuses generate separate columns to the right with "Archived: " prefix and no duplicates', async () => {
    const base = `/api/v1/workspaces/${f.workspaceId}`;

    // Create tasks in active status first
    const task1 = await request(f.app.getHttpServer())
      .post(`${base}/tasks`)
      .set('Cookie', f.adminCookie)
      .send({ title: 'Task in Arch 1', workflow_id: f.workflowId, status_id: f.todoId })
      .expect(201);

    const task2 = await request(f.app.getHttpServer())
      .post(`${base}/tasks`)
      .set('Cookie', f.adminCookie)
      .send({ title: 'Task in Arch 2', workflow_id: f.workflowId, status_id: f.todoId })
      .expect(201);

    // Force tasks into archived status 1 & status 2 in database
    const { sql: client } = createDatabase(databaseUrl);
    await client`UPDATE tasks SET status_id=${f.archivedStatus1Id} WHERE id=${task1.body.data.id}`;
    await client`UPDATE tasks SET status_id=${f.archivedStatus2Id} WHERE id=${task2.body.data.id}`;
    await client.end();

    const kanbanRes = await request(f.app.getHttpServer())
      .get(`${base}/kanban`)
      .set('Cookie', f.memberCookie)
      .expect(200);

    const columns = kanbanRes.body.data.columns;
    // Expected order: active columns (TODO, IN_PROGRESS, DONE, CANCELLED) then occupied archived columns (Old Review, Legacy QA)
    // Position of arch1 is 15, arch2 is 25. So arch1 appears before arch2.
    expect(columns.length).toBe(6);

    // Check empty archived status is NOT present
    const columnIds = columns.map((c: { status: { id: string } }) => c.status.id);
    expect(columnIds).not.toContain(f.emptyArchivedStatusId);

    // Check archived column attributes
    const arch1Col = columns.find((c: { status: { id: string } }) => c.status.id === f.archivedStatus1Id);
    expect(arch1Col).toBeDefined();
    expect(arch1Col.status.name).toBe('Archived: Old Review');
    expect(arch1Col.status.is_active).toBe(false);
    expect(arch1Col.task_count).toBe(1);
    expect(arch1Col.cards[0].id).toBe(task1.body.data.id);

    const arch2Col = columns.find((c: { status: { id: string } }) => c.status.id === f.archivedStatus2Id);
    expect(arch2Col).toBeDefined();
    expect(arch2Col.status.name).toBe('Archived: Legacy QA');
    expect(arch2Col.status.is_active).toBe(false);
    expect(arch2Col.task_count).toBe(1);
    expect(arch2Col.cards[0].id).toBe(task2.body.data.id);

    // Verify total cards count matches exactly (no duplicate tasks)
    const allTaskIds = columns.flatMap((c: { cards: { id: string }[] }) => c.cards.map((card) => card.id));
    expect(new Set(allTaskIds).size).toBe(allTaskIds.length);
  });

  it('3. task in archived status remains present and readable in Task List, Task Detail, and Calendar', async () => {
    const base = `/api/v1/workspaces/${f.workspaceId}`;

    const task = await request(f.app.getHttpServer())
      .post(`${base}/tasks`)
      .set('Cookie', f.adminCookie)
      .send({ title: 'Task Detail Test', workflow_id: f.workflowId, status_id: f.todoId, due_at: '2026-09-10T12:00:00.000Z', assignees: [{ user_id: f.memberId, is_primary: true }] })
      .expect(201);

    const taskId = task.body.data.id;
    const before = await request(f.app.getHttpServer()).get(`${base}/my-work`).set('Cookie', f.memberCookie).query({ date: '2026-09-05' }).expect(200);
    expect(before.body.data.upcoming.find((t: { id: string }) => t.id === taskId).status).toEqual({ id: f.todoId, code: 'TODO', name: 'To Do', category: 'TODO', is_active: true });

    const { sql: client } = createDatabase(databaseUrl);
    await client`UPDATE tasks SET status_id=${f.archivedStatus1Id} WHERE id=${taskId}`;
    await client.end();

    // 1. Task Detail
    const detailRes = await request(f.app.getHttpServer())
      .get(`${base}/tasks/${taskId}`)
      .set('Cookie', f.memberCookie)
      .expect(200);
    expect(detailRes.body.data.status.id).toBe(f.archivedStatus1Id);
    expect(detailRes.body.data.status.name).toBe('Old Review');
    expect(detailRes.body.data.status.is_active).toBe(false);

    // 2. Task List
    const listRes = await request(f.app.getHttpServer())
      .get(`${base}/tasks`)
      .set('Cookie', f.memberCookie)
      .expect(200);
    const foundInList = listRes.body.data.find((t: { id: string }) => t.id === taskId);
    expect(foundInList).toBeDefined();
    expect(foundInList.status.is_active).toBe(false);

    // 3. Calendar
    const calRes = await request(f.app.getHttpServer())
      .get(`${base}/calendar/tasks`)
      .set('Cookie', f.memberCookie)
      .query({ from: '2026-09-01T00:00:00.000Z', to: '2026-09-30T00:00:00.000Z' })
      .expect(200);
    const foundInCal = calRes.body.data.find((t: { id: string }) => t.id === taskId);
    expect(foundInCal).toBeDefined();
    expect(foundInCal.status.id).toBe(f.archivedStatus1Id);
    expect(foundInCal.status.is_active).toBe(false);

    // 4. My Work - archived non-terminal status task assigned to user remains present
    const myWorkRes = await request(f.app.getHttpServer())
      .get(`${base}/my-work`)
      .set('Cookie', f.memberCookie)
      .query({ date: '2026-09-05' })
      .expect(200);
    const foundInMyWork = myWorkRes.body.data.upcoming.find((t: { id: string }) => t.id === taskId);
    expect(foundInMyWork).toMatchObject({ status: { id: f.archivedStatus1Id, code: 'OLD_REV', name: 'Old Review', category: 'IN_PROGRESS', is_active: false } });
  });

  it('4. recurrence rule create and update cannot target archived workflow or archived status', async () => {
    const base = `/api/v1/workspaces/${f.workspaceId}`;

    // Create archived workflow
    const { sql: client } = createDatabase(databaseUrl);
    const archWf = (await client<{ id: string }[]>`INSERT INTO workflows (workspace_id, code, name, is_default, is_active, created_by) VALUES (${f.workspaceId}, 'ARCH_WF', 'Archived WF', false, false, ${f.adminId}) RETURNING id`)[0];
    await client.end();

    // Create recurring task targeting archived workflow -> 422 WORKFLOW_SCOPE_MISMATCH
    await request(f.app.getHttpServer())
      .post(`${base}/recurring-tasks`)
      .set('Cookie', f.memberCookie)
      .set('Idempotency-Key', 'rec-key-1')
      .send({
        name: 'Archived WF Recurrence',
        frequency: 'DAILY',
        interval_value: 1,
        timezone: 'Asia/Jakarta',
        start_at: '2026-09-01T09:00:00.000Z',
        title: 'Recurrence Title',
        workflow_id: archWf.id
      })
      .expect(422)
      .expect(({ body }) => {
        expect(body.error.code).toBe('WORKFLOW_SCOPE_MISMATCH');
      });

    // Create recurring task targeting archived status -> 400 STATUS_SCOPE_MISMATCH
    await request(f.app.getHttpServer())
      .post(`${base}/recurring-tasks`)
      .set('Cookie', f.memberCookie)
      .set('Idempotency-Key', 'rec-key-2')
      .send({
        name: 'Archived Status Recurrence',
        frequency: 'DAILY',
        interval_value: 1,
        timezone: 'Asia/Jakarta',
        start_at: '2026-09-01T09:00:00.000Z',
        title: 'Recurrence Title',
        workflow_id: f.workflowId,
        status_id: f.archivedStatus1Id
      })
    // Create valid recurring rule
    const validRec = await request(f.app.getHttpServer())
      .post(`${base}/recurring-tasks`)
      .set('Cookie', f.memberCookie)
      .set('Idempotency-Key', 'rec-key-valid')
      .send({
        name: 'Valid Recurrence',
        frequency: 'DAILY',
        interval_value: 1,
        timezone: 'Asia/Jakarta',
        start_at: '2026-09-01T09:00:00.000Z',
        title: 'Recurrence Title',
        workflow_id: f.workflowId,
        status_id: f.todoId
      })
      .expect(201);

    const recRuleId = validRec.body.data.id;

    // Patch recurrence rule with archived workflow -> 422 WORKFLOW_SCOPE_MISMATCH
    await request(f.app.getHttpServer())
      .patch(`${base}/recurrence-rules/${recRuleId}`)
      .set('Cookie', f.memberCookie)
      .send({
        workflow_id: archWf.id
      })
      .expect(422)
      .expect(({ body }) => {
        expect(body.error.code).toBe('WORKFLOW_SCOPE_MISMATCH');
      });

    // Patch recurrence rule with archived status -> 400 STATUS_SCOPE_MISMATCH
    await request(f.app.getHttpServer())
      .patch(`${base}/recurrence-rules/${recRuleId}`)
      .set('Cookie', f.memberCookie)
      .send({
        status_id: f.archivedStatus1Id
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.error.code).toBe('STATUS_SCOPE_MISMATCH');
      });
  });
});
