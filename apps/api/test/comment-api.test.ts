import 'reflect-metadata';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ErrorFilter } from '../src/error.filter';
import cookieParser from 'cookie-parser';
import { createDatabase } from '@floz/database';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth';
import { CommentService } from '../src/comment.service';

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
  teamId: string;
  taskId: string;
  restrictedTaskId: string;
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

  const team = await db`INSERT INTO teams (workspace_id, name, manager_user_id, is_active) VALUES (${workspaceId}, 'Team Alpha', ${managerId}, true) RETURNING id`;
  const teamId = String(team[0].id);

  await db`INSERT INTO team_memberships (team_id, user_id) VALUES (${teamId}, ${memberId})`;

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

  // General task (team_id is null) accessible by all workspace members
  const task = await db`INSERT INTO tasks (workspace_id, task_key, title, workflow_id, status_id, creator_id) VALUES (${workspaceId}, 'TSK-1', 'General Task 1', ${workflowId}, ${statusId}, ${memberId}) RETURNING id`;
  const taskId = String(task[0].id);

  // Restricted task (assigned to Team Alpha) accessible by Admin, Manager, and Member (not Field Worker)
  const restrictedTask = await db`INSERT INTO tasks (workspace_id, task_key, title, workflow_id, status_id, creator_id, team_id) VALUES (${workspaceId}, 'TSK-2', 'Restricted Task 2', ${workflowId}, ${statusId}, ${adminId}, ${teamId}) RETURNING id`;
  const restrictedTaskId = String(restrictedTask[0].id);

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
    teamId,
    taskId,
    restrictedTaskId,
  };
}

describe('Phase 10 Task 4 — Task Comments & Mentions API', () => {
  let app: INestApplication;
  let fix: Fixture;

  beforeAll(async () => {
    app = await createApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    fix = await fixture(app);
  });

  it('creates comment atomically with mentions and outbox event (exact counts)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/tasks/${fix.taskId}/comments`)
      .set('Cookie', fix.memberCookie)
      .send({
        content: '  Hello @manager and @admin, please review this task.\nLine 2 here.  ',
        mentioned_user_ids: [fix.managerId, fix.adminId],
      })
      .expect(201);

    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.content).toBe('Hello @manager and @admin, please review this task.\nLine 2 here.');
    expect(res.body.data.author.id).toBe(fix.memberId);
    expect(res.body.data.mentions.length).toBe(2);

    const { sql: db } = createDatabase(databaseUrl);
    const commentCount = (await db`SELECT count(*)::int AS count FROM comments WHERE id = ${res.body.data.id}`)[0].count;
    const mentionCount = (await db`SELECT count(*)::int AS count FROM mentions WHERE comment_id = ${res.body.data.id}`)[0].count;
    const outboxCount = (await db`SELECT count(*)::int AS count FROM outbox_events WHERE aggregate_id = ${res.body.data.id} AND event_type = 'comment.mentioned'`)[0].count;

    expect(commentCount).toBe(1);
    expect(mentionCount).toBe(2);
    expect(outboxCount).toBe(2);
    await db.end();
  });

  it('normalizes content and rejects empty content or content exceeding 2000 chars', async () => {
    // Empty after trim
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/tasks/${fix.taskId}/comments`)
      .set('Cookie', fix.memberCookie)
      .send({ content: '   \n\t   ' })
      .expect(400);

    // Exceeds 2000 chars
    const longContent = 'a'.repeat(2001);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/tasks/${fix.taskId}/comments`)
      .set('Cookie', fix.memberCookie)
      .send({ content: longContent })
      .expect(400);
  });

  it('deduplicates mentioned_user_ids server-side', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/tasks/${fix.taskId}/comments`)
      .set('Cookie', fix.memberCookie)
      .send({
        content: 'Testing mention deduplication',
        mentioned_user_ids: [fix.managerId, fix.managerId, fix.managerId],
      })
      .expect(201);

    expect(res.body.data.mentions.length).toBe(1);

    const { sql: db } = createDatabase(databaseUrl);
    const mentionCount = (await db`SELECT count(*)::int AS count FROM mentions WHERE comment_id = ${res.body.data.id}`)[0].count;
    const outboxCount = (await db`SELECT count(*)::int AS count FROM outbox_events WHERE aggregate_id = ${res.body.data.id} AND event_type = 'comment.mentioned'`)[0].count;

    expect(mentionCount).toBe(1);
    expect(outboxCount).toBe(1);
    await db.end();
  });

  it('allows self-mention in junction table but emits zero outbox notification for author', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/tasks/${fix.taskId}/comments`)
      .set('Cookie', fix.memberCookie)
      .send({
        content: 'Note to self @me',
        mentioned_user_ids: [fix.memberId],
      })
      .expect(201);

    const { sql: db } = createDatabase(databaseUrl);
    const mentionCount = (await db`SELECT count(*)::int AS count FROM mentions WHERE comment_id = ${res.body.data.id}`)[0].count;
    const outboxCount = (await db`SELECT count(*)::int AS count FROM outbox_events WHERE aggregate_id = ${res.body.data.id} AND event_type = 'comment.mentioned'`)[0].count;

    expect(mentionCount).toBe(1);
    expect(outboxCount).toBe(0); // Zero outbox event for self-mention!
    await db.end();
  });

  it('rejects inactive mention target (SUSPENDED or REMOVED or is_active=false) with 422 INVALID_MENTION_TARGET and rolls back completely', async () => {
    const { sql: db } = createDatabase(databaseUrl);

    // Create a suspended workspace member
    const suspended = await app.get(AuthService).auth.api.signUpEmail({ body: { email: 'suspended@example.com', password: 'password123', name: 'Suspended User' } });
    const suspendedId = String(suspended.user.id);
    const roleRow = (await db`SELECT id FROM roles WHERE code = 'MEMBER'`)[0];
    await db`INSERT INTO workspace_memberships (workspace_id, user_id, role_id, status) VALUES (${fix.workspaceId}, ${suspendedId}, ${roleRow.id}, 'SUSPENDED')`;

    // Create a user with is_active = false
    const inactive = await app.get(AuthService).auth.api.signUpEmail({ body: { email: 'inactive@example.com', password: 'password123', name: 'Inactive User' } });
    const inactiveId = String(inactive.user.id);
    await db`INSERT INTO workspace_memberships (workspace_id, user_id, role_id, status) VALUES (${fix.workspaceId}, ${inactiveId}, ${roleRow.id}, 'ACTIVE')`;
    await db`UPDATE users SET is_active = false WHERE id = ${inactiveId}`;

    const beforeComments = (await db`SELECT count(*)::int AS count FROM comments WHERE workspace_id=${fix.workspaceId}`)[0].count;
    const beforeMentions = (await db`SELECT count(*)::int AS count FROM mentions WHERE workspace_id=${fix.workspaceId}`)[0].count;
    const beforeOutbox = (await db`SELECT count(*)::int AS count FROM outbox_events WHERE workspace_id=${fix.workspaceId} AND event_type='comment.mentioned'`)[0].count;

    // Test SUSPENDED member -> 422 INVALID_MENTION_TARGET
    const resSuspended = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/tasks/${fix.taskId}/comments`)
      .set('Cookie', fix.memberCookie)
      .send({
        content: 'Hey suspended user',
        mentioned_user_ids: [suspendedId],
      })
      .expect(422);

    expect(resSuspended.body.error.code).toBe('INVALID_MENTION_TARGET');

    // Test is_active = false user -> 422 INVALID_MENTION_TARGET
    const resInactive = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/tasks/${fix.taskId}/comments`)
      .set('Cookie', fix.memberCookie)
      .send({
        content: 'Hey inactive user',
        mentioned_user_ids: [inactiveId],
      })
      .expect(422);

    expect(resInactive.body.error.code).toBe('INVALID_MENTION_TARGET');

    // Assert complete transaction rollback
    const afterComments = (await db`SELECT count(*)::int AS count FROM comments WHERE workspace_id=${fix.workspaceId}`)[0].count;
    const afterMentions = (await db`SELECT count(*)::int AS count FROM mentions WHERE workspace_id=${fix.workspaceId}`)[0].count;
    const afterOutbox = (await db`SELECT count(*)::int AS count FROM outbox_events WHERE workspace_id=${fix.workspaceId} AND event_type='comment.mentioned'`)[0].count;

    expect(afterComments).toBe(beforeComments);
    expect(afterMentions).toBe(beforeMentions);
    expect(afterOutbox).toBe(beforeOutbox);

    await db.end();
  });

  it('rejects cross-workspace mentioned user with 422 CROSS_WORKSPACE_REFERENCE', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/tasks/${fix.taskId}/comments`)
      .set('Cookie', fix.memberCookie)
      .send({
        content: 'Hey outsider',
        mentioned_user_ids: [fix.outsiderId],
      })
      .expect(422);

    expect(res.body.error.code).toBe('CROSS_WORKSPACE_REFERENCE');
  });

  it('rejects a former team member from restricted task comments', async () => {
    const { sql: db } = createDatabase(databaseUrl);
    await db`UPDATE team_memberships SET left_at = NOW() WHERE team_id = ${fix.teamId} AND user_id = ${fix.memberId}`;
    await db.end();

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/tasks/${fix.restrictedTaskId}/comments`)
      .set('Cookie', fix.memberCookie)
      .send({ content: 'Should be forbidden' })
      .expect(403);
  });

  it('rejects mention target without task access with 422 INVALID_MENTION_TARGET', async () => {
    // Member mentions Field Worker on restrictedTaskId (Field Worker is not on Team Alpha)
    const res = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/tasks/${fix.restrictedTaskId}/comments`)
      .set('Cookie', fix.memberCookie)
      .send({
        content: 'Hey field worker on restricted task',
        mentioned_user_ids: [fix.fieldWorkerId],
      })
      .expect(422);

    expect(res.body.error.code).toBe('INVALID_MENTION_TARGET');
  });

  it('proves atomic rollback on comment creation failure (0 comments, 0 mentions, 0 outbox)', async () => {
    const { sql: db } = createDatabase(databaseUrl);
    const beforeComments = (await db`SELECT count(*)::int AS count FROM comments WHERE workspace_id=${fix.workspaceId}`)[0].count;
    const beforeMentions = (await db`SELECT count(*)::int AS count FROM mentions WHERE workspace_id=${fix.workspaceId}`)[0].count;
    const beforeOutbox = (await db`SELECT count(*)::int AS count FROM outbox_events WHERE workspace_id=${fix.workspaceId} AND event_type='comment.mentioned'`)[0].count;
    await db.end();

    // Force late failure on comment detailTx/format
    const service = app.get<CommentService>(CommentService) as unknown as { formatComment: (...args: unknown[]) => unknown };
    const spy = vi.spyOn(service, 'formatComment').mockImplementationOnce(() => {
      throw new Error('forced late comment failure');
    });

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/tasks/${fix.taskId}/comments`)
      .set('Cookie', fix.memberCookie)
      .send({
        content: 'Failing comment transaction',
        mentioned_user_ids: [fix.managerId],
      })
      .expect(500);

    expect(spy).toHaveBeenCalled();

    const { sql: dbAfter } = createDatabase(databaseUrl);
    const afterComments = (await dbAfter`SELECT count(*)::int AS count FROM comments WHERE workspace_id=${fix.workspaceId}`)[0].count;
    const afterMentions = (await dbAfter`SELECT count(*)::int AS count FROM mentions WHERE workspace_id=${fix.workspaceId}`)[0].count;
    const afterOutbox = (await dbAfter`SELECT count(*)::int AS count FROM outbox_events WHERE workspace_id=${fix.workspaceId} AND event_type='comment.mentioned'`)[0].count;
    await dbAfter.end();

    spy.mockRestore();

    expect(afterComments).toBe(beforeComments);
    expect(afterMentions).toBe(beforeMentions);
    expect(afterOutbox).toBe(beforeOutbox);
  });

  it('paginates comments chronologically with keyset pagination (created_at ASC, id ASC)', async () => {
    // Create 3 comments
    const c1 = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/tasks/${fix.taskId}/comments`)
      .set('Cookie', fix.memberCookie)
      .send({ content: 'Comment 1' })
      .expect(201);

    const c2 = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/tasks/${fix.taskId}/comments`)
      .set('Cookie', fix.managerCookie)
      .send({ content: 'Comment 2' })
      .expect(201);

    const c3 = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/tasks/${fix.taskId}/comments`)
      .set('Cookie', fix.adminCookie)
      .send({ content: 'Comment 3' })
      .expect(201);

    const page1 = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${fix.workspaceId}/tasks/${fix.taskId}/comments?limit=2`)
      .set('Cookie', fix.memberCookie)
      .expect(200);

    expect(page1.body.data.length).toBe(2);
    expect(page1.body.data[0].id).toBe(c1.body.data.id);
    expect(page1.body.data[1].id).toBe(c2.body.data.id);
    expect(page1.body.meta.pagination.has_more).toBe(true);
    expect(page1.body.meta.pagination.next_cursor).toBeDefined();

    const page2 = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${fix.workspaceId}/tasks/${fix.taskId}/comments?limit=2&cursor=${page1.body.meta.pagination.next_cursor}`)
      .set('Cookie', fix.memberCookie)
      .expect(200);

    expect(page2.body.data.length).toBe(1);
    expect(page2.body.data[0].id).toBe(c3.body.data.id);
    expect(page2.body.meta.pagination.has_more).toBe(false);
  });

  it('enforces soft-delete authorization (author or admin) and idempotent repeated DELETE', async () => {
    const c = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${fix.workspaceId}/tasks/${fix.taskId}/comments`)
      .set('Cookie', fix.memberCookie)
      .send({ content: 'To be deleted', mentioned_user_ids: [fix.managerId] })
      .expect(201);

    const commentId = c.body.data.id;

    // Unauthorized user (Field Worker) cannot delete -> 403
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${fix.workspaceId}/tasks/${fix.taskId}/comments/${commentId}`)
      .set('Cookie', fix.fieldWorkerCookie)
      .expect(403);

    // Author deletes -> 204 No Content
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${fix.workspaceId}/tasks/${fix.taskId}/comments/${commentId}`)
      .set('Cookie', fix.memberCookie)
      .expect(204);

    // Deleted comment hidden from GET
    const list = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${fix.workspaceId}/tasks/${fix.taskId}/comments`)
      .set('Cookie', fix.memberCookie)
      .expect(200);
    expect(list.body.data.map((item: { id: string }) => item.id)).not.toContain(commentId);

    // Repeated DELETE by author returns 204 idempotently
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${fix.workspaceId}/tasks/${fix.taskId}/comments/${commentId}`)
      .set('Cookie', fix.memberCookie)
      .expect(204);

    // Repeated DELETE by admin also returns 204 idempotently
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${fix.workspaceId}/tasks/${fix.taskId}/comments/${commentId}`)
      .set('Cookie', fix.adminCookie)
      .expect(204);

    // DB row and mention row still exist (soft deleted)
    const { sql: db } = createDatabase(databaseUrl);
    const row = (await db`SELECT deleted_at FROM comments WHERE id = ${commentId}`)[0];
    expect(row.deleted_at).not.toBeNull();

    const mentions = await db`SELECT * FROM mentions WHERE comment_id = ${commentId}`;
    expect(mentions.length).toBe(1);
    await db.end();
  });
});
