import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { createDatabase } from '@floz/database';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth';
import { createTaskAssigneesTx, createTaskRecordTx, validateTaskTemplateReferences, writeTaskHistoryTx } from '../src/task-core';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/floz';
process.env.DATABASE_URL = databaseUrl;
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? 'test-secret-at-least-32-characters-long';

type Fixture = { adminCookie: string; memberCookie: string; outsiderCookie: string; adminId: string; memberId: string; outsiderId: string; workspaceId: string; otherWorkspaceId: string; workflowId: string; todoId: string; doingId: string; doneId: string };

async function createApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

async function resetDatabase() {
  const { sql: client } = createDatabase(databaseUrl);
  await client`TRUNCATE team_memberships, teams, workspace_memberships, workspaces, roles, sessions, accounts, users, verifications RESTART IDENTITY CASCADE`;
  await client.end();
}

async function login(app: INestApplication, email: string, password = 'password123') {
  const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password }).expect(200);
  return res.headers['set-cookie'][0].split(';')[0];
}

async function fixture(app: INestApplication): Promise<Fixture> {
  const auth = app.get(AuthService).auth;
  const admin = await auth.api.signUpEmail({ body: { email: 'admin@example.com', password: 'password123', name: 'Admin' } });
  const member = await auth.api.signUpEmail({ body: { email: 'member@example.com', password: 'password123', name: 'Member' } });
  const outsider = await auth.api.signUpEmail({ body: { email: 'outsider@example.com', password: 'password123', name: 'Outsider' } });
  const adminId = String(admin.user.id);
  const memberId = String(member.user.id);
  const outsiderId = String(outsider.user.id);
  const { sql: db2 } = createDatabase(databaseUrl);
  const role = await db2`INSERT INTO roles (code, name) VALUES ('ADMIN', 'Admin'), ('MEMBER', 'Member') ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id, code`;
  const adminRole = String(role.find((r) => r.code === 'ADMIN')!.id);
  const memberRole = String(role.find((r) => r.code === 'MEMBER')!.id);
  const workspace = await db2`INSERT INTO workspaces (name, slug, created_by) VALUES ('Floz', 'floz', ${adminId}) RETURNING id`;
  const other = await db2`INSERT INTO workspaces (name, slug, created_by) VALUES ('Other', 'other', ${outsiderId}) RETURNING id`;
  const workspaceId = String(workspace[0].id);
  const otherWorkspaceId = String(other[0].id);
  await db2`INSERT INTO workspace_memberships (workspace_id, user_id, role_id) VALUES (${workspaceId}, ${adminId}, ${adminRole}), (${workspaceId}, ${memberId}, ${memberRole}), (${otherWorkspaceId}, ${outsiderId}, ${adminRole})`;
  const workflow = await db2`SELECT w.id, s.id AS status_id, s.code FROM workflows w JOIN task_statuses s ON s.workflow_id=w.id WHERE w.workspace_id=${workspaceId}`;
  const workflowId = String(workflow[0].id);
  const status = (code: string) => String(workflow.find((row) => row.code === code)!.status_id);
  await db2.end();

  return { adminCookie: await login(app, 'admin@example.com'), memberCookie: await login(app, 'member@example.com'), outsiderCookie: await login(app, 'outsider@example.com'), adminId, memberId, outsiderId, workspaceId, otherWorkspaceId, workflowId, todoId: status('TODO'), doingId: status('IN_PROGRESS'), doneId: status('DONE') };
}

describe('API', () => {
  it('exports canonical transactional task creation helpers', () => {
    expect([validateTaskTemplateReferences, createTaskRecordTx, createTaskAssigneesTx, writeTaskHistoryTx].every((helper) => typeof helper === 'function')).toBe(true);
  });

  let app: INestApplication | undefined;

  beforeAll(async () => { await resetDatabase(); });
  beforeEach(async () => { app = await createApp(); });
  afterEach(async () => { await app?.close(); app = undefined; await resetDatabase(); });

  it('keeps /api/v1 health shape', async () => {
    await request(app!.getHttpServer()).get('/api/v1/health').expect(200).expect(({ body }) => expect(body).toEqual({ data: { status: 'ok', service: 'api' } }));
  });

  it('persists workspace and team relations with isolation and reference rejection', async () => {
    const f = await fixture(app!);
    await request(app!.getHttpServer()).get('/api/v1/workspaces').set('Cookie', f.memberCookie).expect(200).expect(({ body }) => expect(body.data.map((w: { id: string }) => w.id)).toEqual([f.workspaceId]));
    await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.otherWorkspaceId}`).set('Cookie', f.memberCookie).expect(404);
    await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/teams`).set('Cookie', f.memberCookie).send({ name: 'Ops' }).expect(403);
    await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/teams`).set('Cookie', f.adminCookie).send({ name: 'Ops', manager_user_id: f.outsiderId }).expect(400);
    const team = await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/teams`).set('Cookie', f.adminCookie).send({ name: 'Ops', manager_user_id: f.memberId }).expect(201);
    await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/teams/${team.body.data.id}/members`).set('Cookie', f.adminCookie).send({ user_id: f.outsiderId }).expect(400);
    await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/teams/${team.body.data.id}/members`).set('Cookie', f.adminCookie).send({ user_id: f.memberId }).expect(201);
    await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.workspaceId}/teams/${team.body.data.id}/members`).set('Cookie', f.memberCookie).expect(200).expect(({ body }) => expect(body.data).toEqual([{ user_id: f.memberId, membership_role: 'MEMBER' }]));
  });

  it('rejects invalid task workflow, status, team, assignee, and primary assignment references', async () => {
    const f = await fixture(app!);
    const path = `/api/v1/workspaces/${f.workspaceId}/tasks`;
    const alienWorkflow = await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.otherWorkspaceId}/tasks`).set('Cookie', f.outsiderCookie).send({ title: 'Alien workflow' }).expect(201);
    const alienStatus = alienWorkflow.body.data.status.id;
    const alienTeam = (await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.otherWorkspaceId}/teams`).set('Cookie', f.outsiderCookie).send({ name: 'Other Ops' }).expect(201)).body.data.id;
    for (const body of [
      { title: '' },
      { title: 'Bad workflow', workflow_id: alienWorkflow.body.data.workflow_id },
      { title: 'Bad status', status_id: alienStatus },
      { title: 'Bad team', team_id: alienTeam },
      { title: 'Bad assignee', assignees: [{ user_id: f.outsiderId }] },
      { title: 'Two primary', assignees: [{ user_id: f.adminId, is_primary: true }, { user_id: f.memberId, is_primary: true }] }
    ]) await request(app!.getHttpServer()).post(path).set('Cookie', f.memberCookie).send(body).expect(400);
  });

  it('enforces task isolation, optimistic locking, assignment replacement, history, and soft delete', async () => {
    const f = await fixture(app!);
    const created = await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/tasks`).set('Cookie', f.memberCookie).send({ title: 'Isolated' }).expect(201);
    const id = created.body.data.id;
    for (const method of ['get', 'patch', 'post', 'delete'] as const) {
      const target = method === 'post' ? `/api/v1/workspaces/${f.otherWorkspaceId}/tasks/${id}/assignments` : `/api/v1/workspaces/${f.otherWorkspaceId}/tasks/${id}`;
      const call = request(app!.getHttpServer())[method](target).set('Cookie', f.adminCookie);
      if (method === 'patch') call.send({ title: 'Cross', version: 1 });
      if (method === 'post') call.send({ version: 1, assignees: [] });
      if (method === 'delete') call.query({ version: 1 });
      await call.expect(404);
    }
    const assigned = await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/tasks/${id}/assignments`).set('Cookie', f.memberCookie).send({ version: 1, assignees: [{ user_id: f.adminId, is_primary: true }] }).expect(201);
    expect(assigned.body.data.assignees.map((a: { user_id: string }) => a.user_id)).toEqual([f.adminId]);
    await request(app!.getHttpServer()).patch(`/api/v1/workspaces/${f.workspaceId}/tasks/${id}`).set('Cookie', f.memberCookie).send({ title: 'Stale', version: 1 }).expect(409);
    const replaced = await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/tasks/${id}/assignments`).set('Cookie', f.memberCookie).send({ version: 2, assignees: [{ user_id: f.memberId }] }).expect(201);
    expect(replaced.body.data.assignees.map((a: { user_id: string }) => a.user_id)).toEqual([f.memberId]);
    await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.workspaceId}/tasks/${id}/history`).set('Cookie', f.memberCookie).expect(200).expect(({ body }) => expect(body.data.map((h: { event_type: string }) => h.event_type)).toEqual(['CREATED', 'ASSIGNEES_CHANGED', 'ASSIGNEES_CHANGED']));
    await request(app!.getHttpServer()).delete(`/api/v1/workspaces/${f.workspaceId}/tasks/${id}`).set('Cookie', f.adminCookie).query({ version: 3 }).expect(204);
    await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.workspaceId}/tasks/${id}`).set('Cookie', f.memberCookie).expect(404);
  });

  it('validates transitions and records completion and reopen timestamps', async () => {
    const f = await fixture(app!);
    const created = await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/tasks`).set('Cookie', f.memberCookie).send({ title: 'Transition' }).expect(201);
    const id = created.body.data.id;
    await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/tasks/${id}/transitions`).set('Cookie', f.memberCookie).send({ to_status_id: f.doneId, version: 1 }).expect(400);
    const doing = await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/tasks/${id}/transitions`).set('Cookie', f.memberCookie).send({ to_status_id: f.doingId, version: 1 }).expect(201);
    const done = await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/tasks/${id}/transitions`).set('Cookie', f.memberCookie).send({ to_status_id: f.doneId, version: doing.body.task.version }).expect(201);
    expect(done.body.task.completed_at).not.toBeNull();
    const reopened = await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/tasks/${id}/transitions`).set('Cookie', f.memberCookie).send({ to_status_id: f.doingId, version: done.body.task.version }).expect(201);
    expect(reopened.body.task.completed_at).toBeNull();
    await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.workspaceId}/tasks/${id}/history`).set('Cookie', f.memberCookie).expect(200).expect(({ body }) => expect(body.data.map((h: { event_type: string }) => h.event_type)).toEqual(['CREATED', 'STATUS_CHANGED', 'COMPLETED', 'REOPENED']));
  });

  it('filters, searches, sorts, and paginates task lists', async () => {
    const f = await fixture(app!);
    const path = `/api/v1/workspaces/${f.workspaceId}/tasks`;
    await request(app!.getHttpServer()).post(path).set('Cookie', f.memberCookie).send({ title: 'Alpha pump', priority: 'LOW' }).expect(201);
    await request(app!.getHttpServer()).post(path).set('Cookie', f.memberCookie).send({ title: 'Beta valve', priority: 'HIGH' }).expect(201);
    await request(app!.getHttpServer()).post(path).set('Cookie', f.memberCookie).send({ title: 'Gamma pump', priority: 'HIGH' }).expect(201);
    await request(app!.getHttpServer()).get(path).set('Cookie', f.memberCookie).query({ q: 'pump', priority: 'HIGH', status_id: f.todoId, sort: 'task_key', limit: 1 }).expect(200).expect(({ body }) => { expect(body.data.map((t: { title: string }) => t.title)).toEqual(['Gamma pump']); expect(body.meta.pagination.has_more).toBe(false); });
    await request(app!.getHttpServer()).get(path).set('Cookie', f.memberCookie).query({ sort: '-task_key', limit: 2 }).expect(200).expect(({ body }) => { expect(body.data.map((t: { title: string }) => t.title)).toEqual(['Gamma pump', 'Beta valve']); expect(body.meta.pagination.has_more).toBe(true); });
    await request(app!.getHttpServer()).get(path).set('Cookie', f.memberCookie).query({ sort: 'invalid' }).expect(400);
  });

  it('uses opaque cursors without duplication, skips, or workspace leaks', async () => {
    const f = await fixture(app!);
    const path = `/api/v1/workspaces/${f.workspaceId}/tasks`;
    const otherPath = `/api/v1/workspaces/${f.otherWorkspaceId}/tasks`;
    for (const title of ['Pump A', 'Pump B', 'Pump C', 'Pump D', 'Pump E']) await request(app!.getHttpServer()).post(path).set('Cookie', f.memberCookie).send({ title, priority: 'MEDIUM' }).expect(201);
    await request(app!.getHttpServer()).post(otherPath).set('Cookie', f.outsiderCookie).send({ title: 'Other', priority: 'URGENT' }).expect(201);
    const query = { sort: 'priority', limit: 2, q: 'Pump', priority: 'MEDIUM', status_id: f.todoId };
    const first = await request(app!.getHttpServer()).get(path).set('Cookie', f.memberCookie).query(query).expect(200);
    const second = await request(app!.getHttpServer()).get(path).set('Cookie', f.memberCookie).query({ ...query, cursor: first.body.meta.pagination.next_cursor }).expect(200);
    const final = await request(app!.getHttpServer()).get(path).set('Cookie', f.memberCookie).query({ ...query, cursor: second.body.meta.pagination.next_cursor }).expect(200);
    const ids = [...first.body.data, ...second.body.data, ...final.body.data].map((task: { id: string }) => task.id);
    expect([first.body.data.length, second.body.data.length, final.body.data.length]).toEqual([2, 2, 1]);
    expect(new Set(ids).size).toBe(5);
    expect(first.body.meta.pagination.has_more).toBe(true);
    expect(second.body.meta.pagination.has_more).toBe(true);
    expect(final.body.meta.pagination).toMatchObject({ has_more: false, next_cursor: null });
    await request(app!.getHttpServer()).get(path).set('Cookie', f.memberCookie).query({ ...query, cursor: Buffer.from(JSON.stringify({ v: 1, sort: 'created_at', direction: 'ASC', value: 'x', id: randomUUID() })).toString('base64url') }).expect(422).expect(({ body }) => expect(body.message).toBe('VALIDATION_ERROR'));
    await request(app!.getHttpServer()).get(path).set('Cookie', f.memberCookie).query({ ...query, cursor: '%%%' }).expect(422).expect(({ body }) => expect(body.message).toBe('VALIDATION_ERROR'));
    await request(app!.getHttpServer()).get(otherPath).set('Cookie', f.outsiderCookie).query({ sort: 'priority', limit: 2, cursor: first.body.meta.pagination.next_cursor }).expect(200).expect(({ body }) => expect(body.data.map((task: { title: string }) => task.title)).toEqual(['Other']));
  });

  it('projects the default workflow kanban with ordered columns, public filters, counts, isolation, and deleted exclusion', async () => {
    const f = await fixture(app!);
    const path = `/api/v1/workspaces/${f.workspaceId}/tasks`;
    const first = await request(app!.getHttpServer()).post(path).set('Cookie', f.memberCookie).send({ title: 'Due first', priority: 'HIGH', due_at: '2026-08-01T00:00:00.000Z', assignees: [{ user_id: f.memberId, is_primary: true }] }).expect(201);
    const second = await request(app!.getHttpServer()).post(path).set('Cookie', f.memberCookie).send({ title: 'Due last', priority: 'LOW' }).expect(201);
    const doing = await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/tasks/${second.body.data.id}/transitions`).set('Cookie', f.memberCookie).send({ to_status_id: f.doingId, version: second.body.data.version }).expect(201);
    await request(app!.getHttpServer()).delete(`/api/v1/workspaces/${f.workspaceId}/tasks/${doing.body.task.id}`).set('Cookie', f.adminCookie).query({ version: doing.body.task.version }).expect(204);
    await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.otherWorkspaceId}/tasks`).set('Cookie', f.outsiderCookie).send({ title: 'Other task', priority: 'URGENT' }).expect(201);
    const board = await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.workspaceId}/kanban`).set('Cookie', f.memberCookie).query({ workflow_id: f.workflowId, priority: 'HIGH,URGENT', assignee_id: f.memberId, due_from: '2026-08-01T00:00:00.000Z', due_to: '2026-08-02T00:00:00.000Z' }).expect(200);
    expect(board.body.data.workflow.id).toBe(f.workflowId);
    expect(board.body.data.columns.map((column: { status: { id: string } }) => column.status.id)).toEqual([f.todoId, f.doingId, f.doneId]);
    expect(board.body.data.columns[0]).toMatchObject({ task_count: 1, cards: [{ id: first.body.data.id, title: 'Due first', assignees: [{ user_id: f.memberId, is_primary: true, full_name: 'Member' }] }] });
    expect(board.body.data.columns.flatMap((column: { cards: { title: string }[] }) => column.cards).map((card: { title: string }) => card.title)).not.toContain('Other task');
    await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.otherWorkspaceId}/kanban`).set('Cookie', f.memberCookie).expect(404);
  });

  it('projects scheduled and deadline-only tasks for a bounded calendar range', async () => {
    const f = await fixture(app!);
    const path = `/api/v1/workspaces/${f.workspaceId}/tasks`;
    const scheduled = await request(app!.getHttpServer()).post(path).set('Cookie', f.memberCookie).send({ title: 'Scheduled', start_at: '2026-08-10T01:00:00.000Z', due_at: '2026-08-10T03:00:00.000Z', assignees: [{ user_id: f.memberId, is_primary: true }] }).expect(201);
    await request(app!.getHttpServer()).post(path).set('Cookie', f.memberCookie).send({ title: 'Deadline only', due_at: '2026-08-10T04:00:00.000Z' }).expect(201);
    await request(app!.getHttpServer()).post(path).set('Cookie', f.memberCookie).send({ title: 'Outside', due_at: '2026-08-12T00:00:00.000Z' }).expect(201);
    await request(app!.getHttpServer()).post(path).set('Cookie', f.memberCookie).send({ title: 'Start only', start_at: '2026-08-10T05:00:00.000Z' }).expect(201);

    const res = await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.workspaceId}/calendar/tasks`).set('Cookie', f.memberCookie).query({ from: '2026-08-10T00:00:00.000Z', to: '2026-08-11T00:00:00.000Z' }).expect(200);

    expect(res.body.meta).toEqual({ from: '2026-08-10T00:00:00.000Z', to: '2026-08-11T00:00:00.000Z' });
    expect(res.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: scheduled.body.data.id, task_key: scheduled.body.data.task_key, title: 'Scheduled', start_at: '2026-08-10T01:00:00.000Z', due_at: '2026-08-10T03:00:00.000Z', is_deadline_only: false, primary_assignee: { id: f.memberId, full_name: 'Member' } }),
      expect.objectContaining({ title: 'Deadline only', start_at: null, due_at: '2026-08-10T04:00:00.000Z', is_deadline_only: true, primary_assignee: null }),
    ]));
    expect(res.body.data.map((task: { title: string }) => task.title)).toEqual(['Scheduled', 'Deadline only']);
  });

  it('filters calendar projection by workspace team and assignee and validates references', async () => {
    const f = await fixture(app!);
    const path = `/api/v1/workspaces/${f.workspaceId}/tasks`;
    const team = await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/teams`).set('Cookie', f.adminCookie).send({ name: 'Ops' }).expect(201);
    const alienTeam = await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.otherWorkspaceId}/teams`).set('Cookie', f.outsiderCookie).send({ name: 'Other Ops' }).expect(201);
    await request(app!.getHttpServer()).post(path).set('Cookie', f.memberCookie).send({ title: 'Mine', team_id: team.body.data.id, due_at: '2026-08-10T01:00:00.000Z', assignees: [{ user_id: f.memberId, is_primary: true }] }).expect(201);
    await request(app!.getHttpServer()).post(path).set('Cookie', f.memberCookie).send({ title: 'Admin', due_at: '2026-08-10T02:00:00.000Z', assignees: [{ user_id: f.adminId, is_primary: true }] }).expect(201);

    const query = { from: '2026-08-10T00:00:00.000Z', to: '2026-08-11T00:00:00.000Z' };
    await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.workspaceId}/calendar/tasks`).set('Cookie', f.memberCookie).query({ ...query, team_id: team.body.data.id }).expect(200).expect(({ body }) => expect(body.data.map((task: { title: string }) => task.title)).toEqual(['Mine']));
    await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.workspaceId}/calendar/tasks`).set('Cookie', f.memberCookie).query({ ...query, assignee_id: f.memberId }).expect(200).expect(({ body }) => expect(body.data.map((task: { title: string }) => task.title)).toEqual(['Mine']));
    await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.workspaceId}/calendar/tasks`).set('Cookie', f.memberCookie).query({ ...query, team_id: alienTeam.body.data.id }).expect(400).expect(({ body }) => expect(body.message).toBe('TEAM_SCOPE_MISMATCH'));
    await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.workspaceId}/calendar/tasks`).set('Cookie', f.memberCookie).query({ ...query, assignee_id: f.outsiderId }).expect(400).expect(({ body }) => expect(body.message).toBe('CROSS_WORKSPACE_REFERENCE'));
  });

  it('rejects invalid calendar bounds and excludes deleted tasks', async () => {
    const f = await fixture(app!);
    const task = await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/tasks`).set('Cookie', f.memberCookie).send({ title: 'Deleted', due_at: '2026-08-10T01:00:00.000Z' }).expect(201);
    await request(app!.getHttpServer()).delete(`/api/v1/workspaces/${f.workspaceId}/tasks/${task.body.data.id}`).set('Cookie', f.adminCookie).query({ version: task.body.data.version }).expect(204);
    await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.workspaceId}/calendar/tasks`).set('Cookie', f.memberCookie).query({ from: '2026-08-10T00:00:00.000Z', to: '2026-08-11T00:00:00.000Z' }).expect(200).expect(({ body }) => expect(body.data).toEqual([]));
    for (const query of [{ to: '2026-08-11T00:00:00.000Z' }, { from: '2026-08-10T00:00:00.000Z' }, { from: 'bad', to: '2026-08-11T00:00:00.000Z' }, { from: '2026-08-11T00:00:00.000Z', to: '2026-08-10T00:00:00.000Z' }]) {
      await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.workspaceId}/calendar/tasks`).set('Cookie', f.memberCookie).query(query).expect(400).expect(({ body }) => expect(body.message).toBe('VALIDATION_ERROR'));
    }
  });

  it('supports scheduled overlap half-open calendar ranges', async () => {
    const f = await fixture(app!);
    await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/tasks`).set('Cookie', f.memberCookie).send({ title: 'Overlap start', start_at: '2026-08-09T23:00:00.000Z', due_at: '2026-08-10T00:00:00.000Z' }).expect(201);
    await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/tasks`).set('Cookie', f.memberCookie).send({ title: 'Overlap body', start_at: '2026-08-09T23:00:00.000Z', due_at: '2026-08-10T01:00:00.000Z' }).expect(201);
    await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.workspaceId}/calendar/tasks`).set('Cookie', f.memberCookie).query({ from: '2026-08-10T00:00:00.000Z', to: '2026-08-11T00:00:00.000Z' }).expect(200).expect(({ body }) => expect(body.data.map((task: { title: string }) => task.title)).toEqual(['Overlap body']));
    await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.otherWorkspaceId}/calendar/tasks`).set('Cookie', f.memberCookie).query({ from: '2026-08-10T00:00:00.000Z', to: '2026-08-11T00:00:00.000Z' }).expect(404);
  });

  it('enforces strict calendar boundaries, equal-range rejection, UUID validation, and projection contract', async () => {
    const f = await fixture(app!);
    const path = `/api/v1/workspaces/${f.workspaceId}/tasks`;
    const endingAtFrom = await request(app!.getHttpServer()).post(path).set('Cookie', f.memberCookie).send({ title: 'Ends at from', start_at: '2026-08-09T23:00:00.000Z', due_at: '2026-08-10T00:00:00.000Z' }).expect(201);
    const primary = await request(app!.getHttpServer()).post(path).set('Cookie', f.memberCookie).send({ title: 'Primary contract', due_at: '2026-08-10T01:00:00.000Z', assignees: [{ user_id: f.adminId }, { user_id: f.memberId, is_primary: true }] }).expect(201);
    const query = { from: '2026-08-10T00:00:00.000Z', to: '2026-08-11T00:00:00.000Z' };
    const result = await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.workspaceId}/calendar/tasks`).set('Cookie', f.memberCookie).query(query).expect(200);
    expect(result.body.data.find((task: { id: string }) => task.id === endingAtFrom.body.data.id)).toBeUndefined();
    expect(result.body.data.find((task: { id: string }) => task.id === primary.body.data.id)).toMatchObject({ primary_assignee: { id: f.memberId, full_name: 'Member' } });
    expect(Object.keys(result.body.data[0]).sort()).toEqual(['due_at', 'id', 'is_deadline_only', 'primary_assignee', 'priority', 'start_at', 'status', 'task_key', 'title']);
    await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.workspaceId}/calendar/tasks`).set('Cookie', f.memberCookie).query({ from: query.from, to: query.from }).expect(400).expect(({ body }) => expect(body.message).toBe('VALIDATION_ERROR'));
    await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.workspaceId}/calendar/tasks`).set('Cookie', f.memberCookie).query({ ...query, team_id: 'not-a-uuid' }).expect(400).expect(({ body }) => expect(body.message).toBe('VALIDATION_ERROR'));
    await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.workspaceId}/calendar/tasks`).set('Cookie', f.memberCookie).query({ ...query, assignee_id: 'not-a-uuid' }).expect(400).expect(({ body }) => expect(body.message).toBe('VALIDATION_ERROR'));
  });

  it('wires recurrence routes and validates inputs; Task 7 owns business behavior', async () => {
    const f = await fixture(app!);
    const base = `/api/v1/workspaces/${f.workspaceId}`;
    const create = `${base}/recurring-tasks`;
    const rule = `${base}/recurrence-rules/${randomUUID()}`;
    const valid = { name: 'Daily inspection', frequency: 'DAILY', interval_value: 1, timezone: 'Asia/Jakarta', start_at: '2026-08-27T09:00:00.000Z', title: 'Inspect pump', workflow_id: f.workflowId, team_id: f.workspaceId, assignee_ids: [f.memberId], primary_assignee_id: f.memberId };
    await request(app!.getHttpServer()).post(create).send(valid).expect(401);
    await request(app!.getHttpServer()).post(create).set('Cookie', f.memberCookie).send(valid).expect(501);
    for (const body of [{ ...valid, frequency: 'CUSTOM' }, { ...valid, interval_value: 0 }, { ...valid, occurrence_limit: 0 }, { ...valid, end_at: '2026-09-01T09:00:00.000Z', occurrence_limit: 2 }, { ...valid, timezone: 'UTC' }, { ...valid, workflow_id: 'not-a-uuid' }]) await request(app!.getHttpServer()).post(create).set('Cookie', f.memberCookie).send(body).expect(400);
    await request(app!.getHttpServer()).get(`${base}/recurrence-rules`).set('Cookie', f.memberCookie).query({ active: true, team_id: f.workspaceId, assignee_id: f.memberId, cursor: 'opaque', limit: 10 }).expect(501);
    for (const query of [{ active: 'maybe' }, { limit: 0 }, { limit: 'many' }, { team_id: 'not-a-uuid' }, { assignee_id: 'not-a-uuid' }]) await request(app!.getHttpServer()).get(`${base}/recurrence-rules`).set('Cookie', f.memberCookie).query(query).expect(400);
    await request(app!.getHttpServer()).get(`${base}/recurrence-rules/not-a-uuid`).set('Cookie', f.memberCookie).expect(400);
    await request(app!.getHttpServer()).patch(rule).set('Cookie', f.memberCookie).send({ frequency: 'CUSTOM' }).expect(400);
    await request(app!.getHttpServer()).patch(rule).set('Cookie', f.memberCookie).send({ frequency: 'WEEKLY', interval_value: 2 }).expect(501);
    await request(app!.getHttpServer()).post(`${rule}/stop`).set('Cookie', f.memberCookie).expect(501);
  });

  it('supports task workflow, assignment, transition, filtering, and history APIs', async () => {
    const f = await fixture(app!);
    const workflows = await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.workspaceId}/workflows`).set('Cookie', f.memberCookie).expect(200);
    expect(workflows.body.data[0].statuses[0].is_initial).toBe(true);
    const created = await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/tasks`).set('Cookie', f.memberCookie).send({ title: 'Fix pump', assignees: [{ user_id: f.memberId, is_primary: true }] }).expect(201);
    expect(created.body.data).toMatchObject({ title: 'Fix pump', task_key: 'TASK-1', assignees: [{ user_id: f.memberId, is_primary: true, full_name: 'Member' }] });
    const { sql: historyDb } = createDatabase(databaseUrl);
    const history = await historyDb`SELECT event_type, actor_user_id, metadata FROM task_history WHERE task_id=${created.body.data.id} ORDER BY created_at, id`;
    expect(history).toEqual([{ event_type: 'CREATED', actor_user_id: f.memberId, metadata: {} }]);
    await historyDb.end();
    await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.workspaceId}/tasks`).set('Cookie', f.memberCookie).query({ q: 'Fix', sort: '-created_at', limit: 10 }).expect(200).expect(({ body }) => expect(body.meta.pagination.has_more).toBe(false));
    const transitions = await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.workspaceId}/tasks/${created.body.data.id}/available-transitions`).set('Cookie', f.memberCookie).expect(200);
    expect(transitions.body.data.length).toBeGreaterThan(0);
    const moved = await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/tasks/${created.body.data.id}/transitions`).set('Cookie', f.memberCookie).send({ to_status_id: transitions.body.data[0].to_status_id, version: created.body.data.version }).expect(201);
    expect(moved.body.task.status.id).toBe(transitions.body.data[0].to_status_id);
    await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.workspaceId}/tasks/${created.body.data.id}/history`).set('Cookie', f.memberCookie).expect(200).expect(({ body }) => expect(body.data.length).toBeGreaterThan(0));
    await request(app!.getHttpServer()).delete(`/api/v1/workspaces/${f.workspaceId}/tasks/${created.body.data.id}`).set('Cookie', f.adminCookie).query({ version: moved.body.task.version }).expect(204);
  });
});
