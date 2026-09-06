import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  adminCookie: string;
  managerCookie: string;
  memberCookie: string;
  fieldWorkerCookie: string;
  outsiderCookie: string;
  adminId: string;
  managerId: string;
  memberId: string;
  fieldWorkerId: string;
  outsiderId: string;
  workspaceId: string;
  taskId: string;
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

async function fixture(app: INestApplication): Promise<Fixture> {
  const auth = app.get(AuthService).auth;
  const admin = await auth.api.signUpEmail({ body: { email: 'admin@example.com', password: 'password123', name: 'Admin User' } });
  const manager = await auth.api.signUpEmail({ body: { email: 'manager@example.com', password: 'password123', name: 'Manager User' } });
  const member = await auth.api.signUpEmail({ body: { email: 'member@example.com', password: 'password123', name: 'Member User' } });
  const fieldWorker = await auth.api.signUpEmail({ body: { email: 'field@example.com', password: 'password123', name: 'Field Worker' } });
  const outsider = await auth.api.signUpEmail({ body: { email: 'outsider@example.com', password: 'password123', name: 'Outsider User' } });

  const adminId = String(admin.user.id);
  const managerId = String(manager.user.id);
  const memberId = String(member.user.id);
  const fieldWorkerId = String(fieldWorker.user.id);
  const outsiderId = String(outsider.user.id);

  const { sql: db } = createDatabase(databaseUrl);
  const roles = await db`INSERT INTO roles (code, name) VALUES ('ADMIN', 'Admin'), ('MANAGER', 'Manager'), ('MEMBER', 'Member'), ('FIELD_WORKER', 'Field Worker') ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id, code`;
  const adminRole = String(roles.find((r) => r.code === 'ADMIN')!.id);
  const managerRole = String(roles.find((r) => r.code === 'MANAGER')!.id);
  const memberRole = String(roles.find((r) => r.code === 'MEMBER')!.id);
  const fieldWorkerRole = String(roles.find((r) => r.code === 'FIELD_WORKER')!.id);

  const workspace = await db`INSERT INTO workspaces (name, slug, created_by) VALUES ('Floz Workspace', 'floz-ws', ${adminId}) RETURNING id`;
  await db`INSERT INTO workspaces (name, slug, created_by) VALUES ('Other Workspace', 'other-ws', ${outsiderId}) RETURNING id`;
  const workspaceId = String(workspace[0].id);

  await db`INSERT INTO workspace_memberships (workspace_id, user_id, role_id, status) VALUES
    (${workspaceId}, ${adminId}, ${adminRole}, 'ACTIVE'),
    (${workspaceId}, ${managerId}, ${managerRole}, 'ACTIVE'),
    (${workspaceId}, ${memberId}, ${memberRole}, 'ACTIVE'),
    (${workspaceId}, ${fieldWorkerId}, ${fieldWorkerRole}, 'ACTIVE')`;

  let wf = await db`SELECT id FROM workflows WHERE workspace_id=${workspaceId} AND code='DEFAULT'`;
  if (!wf.length) {
    wf = await db`INSERT INTO workflows (workspace_id, code, name, is_default, is_active, created_by) VALUES (${workspaceId}, 'DEFAULT', 'Default Workflow', true, true, ${adminId}) RETURNING id`;
  }
  const workflowId = String(wf[0].id);

  let status = await db`SELECT id FROM task_statuses WHERE workflow_id=${workflowId} AND code='TODO'`;
  if (!status.length) {
    status = await db`INSERT INTO task_statuses (workflow_id, code, name, category, position, is_initial) VALUES (${workflowId}, 'TODO', 'To Do', 'TODO', 1, true) RETURNING id`;
  }
  const statusId = String(status[0].id);

  const task = await db`INSERT INTO tasks (workspace_id, task_key, title, workflow_id, status_id, creator_id) VALUES (${workspaceId}, 'TSK-1', 'Linked Task 1', ${workflowId}, ${statusId}, ${memberId}) RETURNING id`;
  const taskId = String(task[0].id);

  await db.end();

  const adminCookie = await login(app, 'admin@example.com');
  const managerCookie = await login(app, 'manager@example.com');
  const memberCookie = await login(app, 'member@example.com');
  const fieldWorkerCookie = await login(app, 'field@example.com');
  const outsiderCookie = await login(app, 'outsider@example.com');

  return {
    adminCookie,
    managerCookie,
    memberCookie,
    fieldWorkerCookie,
    outsiderCookie,
    adminId,
    managerId,
    memberId,
    fieldWorkerId,
    outsiderId,
    workspaceId,
    taskId,
  };
}

describe('Phase 10 Task 3 — Approval Terminal Mutation Engine & Real Concurrency', () => {
  let app: INestApplication;
  let fix: Fixture;

  beforeAll(async () => {
    app = await createApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    fix = await fixture(app);
  });

  it('rejects mismatched stepId and approvalRequestId with 404 NOT_FOUND', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests`)
      .set('Cookie', fix.memberCookie)
      .send({ title: 'Req 1', approver_user_id: fix.managerId })
      .expect(201);

    const reqId = created.body.data.id;
    const fakeStepId = randomUUID();

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests/${reqId}/steps/${fakeStepId}/approve`)
      .set('Cookie', fix.managerCookie)
      .send({ reason: 'Looks good' })
      .expect(404);
  });

  it('validates reason normalization for approve, reject, and cancel', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests`)
      .set('Cookie', fix.memberCookie)
      .send({ title: 'Req 1', approver_user_id: fix.managerId })
      .expect(201);

    const reqId = created.body.data.id;
    const stepId = created.body.data.step.id;

    // Reject without reason fails (400)
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests/${reqId}/steps/${stepId}/reject`)
      .set('Cookie', fix.managerCookie)
      .send({ reason: '  ' })
      .expect(400);

    // Reject with reason shorter than 3 chars fails (400)
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests/${reqId}/steps/${stepId}/reject`)
      .set('Cookie', fix.managerCookie)
      .send({ reason: 'no' })
      .expect(400);

    // Approve with whitespace reason trims and accepts
    const approved = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests/${reqId}/steps/${stepId}/approve`)
      .set('Cookie', fix.managerCookie)
      .send({ reason: '  Great job  ' })
      .expect(200);

    expect(approved.body.data.step.reason).toBe('Great job');
    expect(approved.body.data.status).toBe('APPROVED');
  });

  it('handles stale approver: suspended approver fails 403, active ADMIN override succeeds', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests`)
      .set('Cookie', fix.memberCookie)
      .send({ title: 'Stale approver req', approver_user_id: fix.managerId })
      .expect(201);

    const reqId = created.body.data.id;
    const stepId = created.body.data.step.id;

    // Deactivate Manager
    const { sql: db } = createDatabase(databaseUrl);
    await db`UPDATE users SET is_active = false WHERE id = ${fix.managerId}`;
    await db.end();

    // Manager attempts decision -> 403 (Account Inactive / Forbidden)
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests/${reqId}/steps/${stepId}/approve`)
      .set('Cookie', fix.managerCookie)
      .send({ reason: 'Manager approve' })
      .expect(403);

    // Workspace Admin executes override -> succeeds!
    const override = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests/${reqId}/steps/${stepId}/approve`)
      .set('Cookie', fix.adminCookie)
      .send({ reason: 'Admin override' })
      .expect(200);

    expect(override.body.data.status).toBe('APPROVED');
    expect(override.body.data.step.decided_by.id).toBe(fix.adminId);
    expect(override.body.data.step.approver.id).toBe(fix.managerId);
  });

  it('proves real concurrency race: Approve vs Reject (exactly 1 wins, racing loser gets 409, exact lifecycle side-effects)', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests`)
      .set('Cookie', fix.memberCookie)
      .send({ title: 'Race 1', task_id: fix.taskId, approver_user_id: fix.managerId })
      .expect(201);

    const reqId = created.body.data.id;
    const stepId = created.body.data.step.id;

    const [res1, res2] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests/${reqId}/steps/${stepId}/approve`)
        .set('Cookie', fix.managerCookie)
        .send({ reason: 'Approved in race' }),
      request(app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests/${reqId}/steps/${stepId}/reject`)
        .set('Cookie', fix.adminCookie)
        .send({ reason: 'Rejected in race' }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = res1.status === 200 ? res1 : res2;
    const loser = res1.status === 409 ? res1 : res2;
    expect(loser.body.error.code).toBe('APPROVAL_NOT_PENDING');

    const finalStatus = winner.body.data.status;
    expect(winner.body.data.step.status).toBe(finalStatus);

    const { sql: db } = createDatabase(databaseUrl);
    const outbox = await db`SELECT * FROM outbox_events WHERE aggregate_id = ${reqId} ORDER BY created_at, id`;
    expect(outbox.length).toBe(2);
    expect(outbox[0].event_type).toBe('approval.requested');
    expect(outbox[1].event_type).toBe('approval.decided');

    const history = await db`SELECT * FROM task_history WHERE task_id = ${fix.taskId} ORDER BY created_at, id`;
    expect(history.length).toBe(2);
    expect(history[0].event_type).toBe('APPROVAL_REQUESTED');
    expect(history[1].event_type).toBe('APPROVAL_COMPLETED');
    expect(history[1].metadata.status).toBe(finalStatus);
    await db.end();
  });

  it('proves real concurrency race: Approve vs Cancel (exactly 1 wins, racing loser gets 409)', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests`)
      .set('Cookie', fix.memberCookie)
      .send({ title: 'Race 2', task_id: fix.taskId, approver_user_id: fix.managerId })
      .expect(201);

    const reqId = created.body.data.id;
    const stepId = created.body.data.step.id;

    const [res1, res2] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests/${reqId}/steps/${stepId}/approve`)
        .set('Cookie', fix.managerCookie)
        .send({ reason: 'Approved in race' }),
      request(app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests/${reqId}/cancel`)
        .set('Cookie', fix.memberCookie)
        .send({ reason: 'Cancelled in race' }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = res1.status === 200 ? res1 : res2;
    const loser = res1.status === 409 ? res1 : res2;
    expect(loser.body.error.code).toBe('APPROVAL_NOT_PENDING');

    const finalStatus = winner.body.data.status;
    expect(winner.body.data.step.status).toBe(finalStatus);

    if (finalStatus === 'CANCELLED') {
      expect(winner.body.data.step.decision).toBeNull();
      expect(winner.body.data.step.decided_by).toBeNull();
    }

    const { sql: db } = createDatabase(databaseUrl);
    const outbox = await db`SELECT * FROM outbox_events WHERE aggregate_id = ${reqId}`;
    expect(outbox.length).toBe(2);

    const history = await db`SELECT * FROM task_history WHERE task_id = ${fix.taskId}`;
    expect(history.length).toBe(2);
    await db.end();
  });

  it('proves real concurrency race: Reject vs Cancel (exactly 1 wins, racing loser gets 409)', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests`)
      .set('Cookie', fix.memberCookie)
      .send({ title: 'Race 3', task_id: fix.taskId, approver_user_id: fix.managerId })
      .expect(201);

    const reqId = created.body.data.id;
    const stepId = created.body.data.step.id;

    const [res1, res2] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests/${reqId}/steps/${stepId}/reject`)
        .set('Cookie', fix.managerCookie)
        .send({ reason: 'Rejected in race' }),
      request(app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests/${reqId}/cancel`)
        .set('Cookie', fix.memberCookie)
        .send({ reason: 'Cancelled in race' }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  it('proves real concurrency race: Cancel vs Cancel (exactly 1 wins, racing loser gets 409)', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests`)
      .set('Cookie', fix.memberCookie)
      .send({ title: 'Race 4', task_id: fix.taskId, approver_user_id: fix.managerId })
      .expect(201);

    const reqId = created.body.data.id;

    const [res1, res2] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests/${reqId}/cancel`)
        .set('Cookie', fix.memberCookie)
        .send({ reason: 'Cancel 1' }),
      request(app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests/${reqId}/cancel`)
        .set('Cookie', fix.adminCookie)
        .send({ reason: 'Cancel 2' }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);
  });
});
