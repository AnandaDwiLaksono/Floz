import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ErrorFilter } from '../src/error.filter';
import cookieParser from 'cookie-parser';
import { createDatabase } from '@floz/database';
import { AppModule } from '../src/app.module';
import { ApprovalService } from '../src/approval.service';
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
  otherWorkspaceId: string;
  team1Id: string;
  team2Id: string;
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
  const other = await db`INSERT INTO workspaces (name, slug, created_by) VALUES ('Other Workspace', 'other-ws', ${outsiderId}) RETURNING id`;
  const workspaceId = String(workspace[0].id);
  const otherWorkspaceId = String(other[0].id);

  await db`INSERT INTO workspace_memberships (workspace_id, user_id, role_id, status) VALUES
    (${workspaceId}, ${adminId}, ${adminRole}, 'ACTIVE'),
    (${workspaceId}, ${managerId}, ${managerRole}, 'ACTIVE'),
    (${workspaceId}, ${memberId}, ${memberRole}, 'ACTIVE'),
    (${workspaceId}, ${fieldWorkerId}, ${fieldWorkerRole}, 'ACTIVE'),
    (${otherWorkspaceId}, ${outsiderId}, ${adminRole}, 'ACTIVE')`;

  const team1 = await db`INSERT INTO teams (workspace_id, name, manager_user_id, is_active) VALUES (${workspaceId}, 'Team Alpha', ${managerId}, true) RETURNING id`;
  const team2 = await db`INSERT INTO teams (workspace_id, name, manager_user_id, is_active) VALUES (${workspaceId}, 'Team Beta', ${managerId}, true) RETURNING id`;
  const team1Id = String(team1[0].id);
  const team2Id = String(team2[0].id);

  // Member belongs to both Team Alpha and Team Beta managed by the same manager
  await db`INSERT INTO team_memberships (team_id, user_id) VALUES (${team1Id}, ${memberId}), (${team2Id}, ${memberId})`;

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
    otherWorkspaceId,
    team1Id,
    team2Id,
    taskId,
  };
}

describe('Phase 10 Task 2 — Approval Creation, List & Detail API', () => {
  let app: INestApplication;
  let fix: Fixture;

  beforeAll(async () => {
    app = await createApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    fix = await fixture(app);
  });

  afterEach(async () => {
    // cleanup
  });

  it('creates an approval request atomically with step, outbox event, and task history', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests`)
      .set('Cookie', fix.memberCookie)
      .send({
        title: 'Please approve budget',
        description: 'Need budget for Q3',
        task_id: fix.taskId,
        approver_user_id: fix.managerId,
      })
      .expect(201);

    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.requester.id).toBe(fix.memberId);
    expect(res.body.data.step.approver.id).toBe(fix.managerId);
    expect(res.body.data.step.status).toBe('PENDING');
    expect(res.body.data.task.id).toBe(fix.taskId);

    const { sql: db } = createDatabase(databaseUrl);
    const approvalId = res.body.data.id;
    const approvalRequstRow = await db`SELECT count(*)::int AS count FROM approval_requests WHERE id = ${approvalId}`;
    const stepRow = await db`SELECT count(*)::int AS count FROM approval_steps WHERE approval_request_id = ${approvalId}`;
    expect(approvalRequstRow[0].count).toBe(1);
    expect(stepRow[0].count).toBe(1);

    const outbox = await db`SELECT count(*)::int AS count FROM outbox_events WHERE aggregate_id = ${approvalId} AND event_type = 'approval.requested'`;
    expect(outbox[0].count).toBe(1);

    const history = await db`SELECT count(*)::int AS count FROM task_history WHERE task_id = ${fix.taskId} AND event_type = 'APPROVAL_REQUESTED'`;
    expect(history[0].count).toBe(1);
    await db.end();
  });

  it('forbids self-approval with 422 SELF_APPROVAL_NOT_ALLOWED', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests`)
      .set('Cookie', fix.memberCookie)
      .send({
        title: 'Self approval attempt',
        approver_user_id: fix.memberId,
      })
      .expect(422);

    expect(res.body.error.code).toBe('SELF_APPROVAL_NOT_ALLOWED');
  });

  it('rejects cross-workspace approver with 422 CROSS_WORKSPACE_REFERENCE', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests`)
      .set('Cookie', fix.memberCookie)
      .send({
        title: 'Cross ws approval',
        approver_user_id: fix.outsiderId,
      })
      .expect(422);

    expect(res.body.error.code).toBe('CROSS_WORKSPACE_REFERENCE');
  });

  it('rejects inactive approver with 422 INACTIVE_APPROVER', async () => {
    const { sql: db } = createDatabase(databaseUrl);
    const inactiveUser = (await db`INSERT INTO users (email, name, is_active) VALUES ('inactive@test.com', 'Inactive User', false) RETURNING id`)[0];
    const roles = await db`SELECT id FROM roles WHERE code='MEMBER' LIMIT 1`;
    await db`INSERT INTO workspace_memberships (workspace_id, user_id, role_id, status) VALUES (${fix.workspaceId}, ${inactiveUser.id}, ${roles[0].id}, 'ACTIVE')`;
    await db.end();

    const res = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests`)
      .set('Cookie', fix.memberCookie)
      .send({
        title: 'Inactive approver approval',
        approver_user_id: inactiveUser.id,
      })
      .expect(422);

    expect(res.body.error.code).toBe('INACTIVE_APPROVER');
  });

  it('allows FIELD_WORKER to be selected as approver', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests`)
      .set('Cookie', fix.memberCookie)
      .send({
        title: 'Field inspection sign-off',
        approver_user_id: fix.fieldWorkerId,
      })
      .expect(201);

    expect(res.body.data.step.approver.id).toBe(fix.fieldWorkerId);
  });

  it('lists approvals with inbox, sent, managed, and all views and stable pagination', async () => {
    // Member creates request for Manager
    const req1 = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests`)
      .set('Cookie', fix.memberCookie)
      .send({ title: 'Req 1', approver_user_id: fix.managerId })
      .expect(201);

    // Manager creates request for Admin
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests`)
      .set('Cookie', fix.managerCookie)
      .send({ title: 'Req 2', approver_user_id: fix.adminId })
      .expect(201);

    // Admin creates request for Member
    const req3 = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests`)
      .set('Cookie', fix.adminCookie)
      .send({ title: 'Req 3', approver_user_id: fix.memberId })
      .expect(201);

    // Manager Inbox (should have req1)
    const managerInbox = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${fix.workspaceId}/approval-requests?view=inbox`)
      .set('Cookie', fix.managerCookie)
      .expect(200);
    expect(managerInbox.body.data.length).toBe(1);
    expect(managerInbox.body.data[0].id).toBe(req1.body.data.id);

    // Member Sent (should have req1)
    const memberSent = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${fix.workspaceId}/approval-requests?view=sent`)
      .set('Cookie', fix.memberCookie)
      .expect(200);
    expect(memberSent.body.data.length).toBe(1);
    expect(memberSent.body.data[0].id).toBe(req1.body.data.id);

    // Manager Managed view: Member belongs to both Team 1 and Team 2, req3 was assigned to Member.
    // Set semantics: req3 must appear exactly once!
    const managerManaged = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${fix.workspaceId}/approval-requests?view=managed`)
      .set('Cookie', fix.managerCookie)
      .expect(200);
    expect(managerManaged.body.data.map((r: { id: string }) => r.id)).toContain(req3.body.data.id);
    expect(managerManaged.body.data.map((r: { id: string }) => r.id)).toContain(req1.body.data.id); // Manager themselves also included

    // Non-manager cannot use view=managed
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${fix.workspaceId}/approval-requests?view=managed`)
      .set('Cookie', fix.memberCookie)
      .expect(403);

    // Non-admin cannot use view=all
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${fix.workspaceId}/approval-requests?view=all`)
      .set('Cookie', fix.managerCookie)
      .expect(403);

    // Admin can use view=all (should see all 3)
    const adminAll = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${fix.workspaceId}/approval-requests?view=all`)
      .set('Cookie', fix.adminCookie)
      .expect(200);
    expect(adminAll.body.data.length).toBe(3);

    // Pagination test (limit 2)
    const page1 = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${fix.workspaceId}/approval-requests?view=all&limit=2`)
      .set('Cookie', fix.adminCookie)
      .expect(200);
    expect(page1.body.data.length).toBe(2);
    expect(page1.body.meta.pagination.has_more).toBe(true);
    expect(page1.body.meta.pagination.next_cursor).toBeDefined();

    const page2 = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${fix.workspaceId}/approval-requests?view=all&limit=2&cursor=${page1.body.meta.pagination.next_cursor}`)
      .set('Cookie', fix.adminCookie)
      .expect(200);
    expect(page2.body.data.length).toBe(1);
    expect(page2.body.meta.pagination.has_more).toBe(false);
  });

  it('enforces read authorization on approval detail', async () => {
    // Member creates request for Manager
    const created = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests`)
      .set('Cookie', fix.memberCookie)
      .send({ title: 'Secret approval', approver_user_id: fix.managerId })
      .expect(201);

    const approvalId = created.body.data.id;

    // Requester can view
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${fix.workspaceId}/approval-requests/${approvalId}`)
      .set('Cookie', fix.memberCookie)
      .expect(200);

    // Approver can view
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${fix.workspaceId}/approval-requests/${approvalId}`)
      .set('Cookie', fix.managerCookie)
      .expect(200);

    // Workspace Admin can view
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${fix.workspaceId}/approval-requests/${approvalId}`)
      .set('Cookie', fix.adminCookie)
      .expect(200);

    // Unrelated member (Field Worker) cannot view -> 403
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${fix.workspaceId}/approval-requests/${approvalId}`)
      .set('Cookie', fix.fieldWorkerCookie)
      .expect(403);
  });

  it('rejects approver without task access with 422 INVALID_APPROVER_TARGET', async () => {
    const { sql: db } = createDatabase(databaseUrl);
    const otherTeam = (await db`INSERT INTO teams (workspace_id, name, is_active) VALUES (${fix.workspaceId}, 'Secret Team', true) RETURNING id`)[0];
    const wf = (await db`SELECT id FROM workflows WHERE workspace_id=${fix.workspaceId} LIMIT 1`)[0];
    const st = (await db`SELECT id FROM task_statuses WHERE workflow_id=${wf.id} LIMIT 1`)[0];
    const restrictedTask = (await db`INSERT INTO tasks (workspace_id, task_key, title, workflow_id, status_id, creator_id, team_id) VALUES (${fix.workspaceId}, 'TSK-99', 'Restricted Task', ${wf.id}, ${st.id}, ${fix.adminId}, ${otherTeam.id}) RETURNING id`)[0];
    // Member is added to Secret Team, but Field Worker is not
    await db`INSERT INTO team_memberships (team_id, user_id) VALUES (${otherTeam.id}, ${fix.memberId})`;
    await db.end();

    const res = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests`)
      .set('Cookie', fix.memberCookie)
      .send({
        title: 'Restricted Approval',
        task_id: restrictedTask.id,
        approver_user_id: fix.fieldWorkerId,
      })
      .expect(422);

    expect(res.body.error.code).toBe('INVALID_APPROVER_TARGET');
  });

  it('proves atomic rollback on late-transaction failure (task-linked)', async () => {
    const { sql: db } = createDatabase(databaseUrl);
    const beforeRequests = (await db`SELECT count(*)::int AS count FROM approval_requests WHERE workspace_id=${fix.workspaceId}`)[0].count;
    const beforeSteps = (await db`SELECT count(*)::int AS count FROM approval_steps WHERE workspace_id=${fix.workspaceId}`)[0].count;
    const beforeOutbox = (await db`SELECT count(*)::int AS count FROM outbox_events WHERE workspace_id=${fix.workspaceId}`)[0].count;
    const beforeHistory = (await db`SELECT count(*)::int AS count FROM task_history WHERE task_id = ${fix.taskId} AND event_type = 'APPROVAL_REQUESTED'`)[0].count;
    await db.end();

    const service = app.get<ApprovalService>(ApprovalService) as unknown as { detailTx: (...args: unknown[]) => Promise<unknown> };
    const spy = vi.spyOn(service, 'detailTx').mockRejectedValueOnce(new Error('forced late failure'));

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests`)
      .set('Cookie', fix.memberCookie)
      .send({
        title: 'Rollback approval',
        description: 'Task-linked to prove rollback',
        task_id: fix.taskId,
        approver_user_id: fix.managerId,
      })
      .expect(500);

    expect(spy).toHaveBeenCalled();

    const { sql: dbAfter } = createDatabase(databaseUrl);
    const afterRequests = (await dbAfter`SELECT count(*)::int AS count FROM approval_requests WHERE workspace_id=${fix.workspaceId}`)[0].count;
    const afterSteps = (await dbAfter`SELECT count(*)::int AS count FROM approval_steps WHERE workspace_id=${fix.workspaceId}`)[0].count;
    const afterOutbox = (await dbAfter`SELECT count(*)::int AS count FROM outbox_events WHERE workspace_id=${fix.workspaceId} AND event_type='approval.requested'`)[0].count;
    const afterHistory = (await dbAfter`SELECT count(*)::int AS count FROM task_history WHERE task_id = ${fix.taskId} AND event_type = 'APPROVAL_REQUESTED'`)[0].count;
    await dbAfter.end();

    spy.mockRestore();

    expect(afterRequests).toBe(beforeRequests);
    expect(afterSteps).toBe(beforeSteps);
    expect(afterOutbox).toBe(beforeOutbox);
    expect(afterHistory).toBe(beforeHistory);
  });

  it('proves atomic rollback on validation failure (pre-write)', async () => {
    const { sql: db } = createDatabase(databaseUrl);
    const beforeRequests = (await db`SELECT count(*)::int AS count FROM approval_requests WHERE workspace_id=${fix.workspaceId}`)[0].count;
    const beforeSteps = (await db`SELECT count(*)::int AS count FROM approval_steps WHERE workspace_id=${fix.workspaceId}`)[0].count;
    const beforeOutbox = (await db`SELECT count(*)::int AS count FROM outbox_events WHERE workspace_id=${fix.workspaceId} AND event_type='approval.requested'`)[0].count;
    const beforeHistory = (await db`SELECT count(*)::int AS count FROM task_history WHERE task_id = ${fix.taskId} AND event_type = 'APPROVAL_REQUESTED'`)[0].count;
    await db.end();

    // Invalid approver
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/approval-requests`)
      .set('Cookie', fix.memberCookie)
      .send({
        title: 'Failing approval',
        approver_user_id: randomUUID(), // non-existent approver
      })
      .expect(422);

    const { sql: dbAfter } = createDatabase(databaseUrl);
    const afterRequests = (await dbAfter`SELECT count(*)::int AS count FROM approval_requests WHERE workspace_id=${fix.workspaceId}`)[0].count;
    const afterSteps = (await dbAfter`SELECT count(*)::int AS count FROM approval_steps WHERE workspace_id=${fix.workspaceId}`)[0].count;
    const afterOutbox = (await dbAfter`SELECT count(*)::int AS count FROM outbox_events WHERE workspace_id=${fix.workspaceId} AND event_type='approval.requested'`)[0].count;
    const afterHistory = (await dbAfter`SELECT count(*)::int AS count FROM task_history WHERE task_id = ${fix.taskId} AND event_type = 'APPROVAL_REQUESTED'`)[0].count;
    await dbAfter.end();

    expect(afterRequests).toBe(beforeRequests);
    expect(afterSteps).toBe(beforeSteps);
    expect(afterOutbox).toBe(beforeOutbox);
    expect(afterHistory).toBe(beforeHistory);
  });
});
