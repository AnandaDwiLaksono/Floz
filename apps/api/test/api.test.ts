import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ErrorFilter } from '../src/error.filter';
import cookieParser from 'cookie-parser';
import { createDatabase } from '@floz/database';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth';
import { createTaskAssigneesTx, createTaskRecordTx, validateTaskTemplateReferences, writeTaskHistoryTx } from '../src/task-core';
import { claimOutboxBatch, markOutboxDispatched, markOutboxRetry } from '../src/outbox.service';
import { ReportingClock } from '../src/reporting-clock';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/floz';
process.env.DATABASE_URL = databaseUrl;
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? 'test-secret-at-least-32-characters-long';

type Fixture = { adminCookie: string; memberCookie: string; outsiderCookie: string; adminId: string; memberId: string; outsiderId: string; workspaceId: string; otherWorkspaceId: string; workflowId: string; todoId: string; doingId: string; doneId: string };

async function createApp(canonicalErrors = false) {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  if (canonicalErrors) app.useGlobalFilters(new ErrorFilter());
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
  const role = await db2`INSERT INTO roles (code, name) VALUES ('ADMIN', 'Admin'), ('MANAGER', 'Manager'), ('MEMBER', 'Member'), ('FIELD_WORKER', 'Field Worker') ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id, code`;
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

  it('fails closed for invalid test-only reporting clocks and ignores them outside test mode', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousReportingNow = process.env.FLOZ_TEST_REPORTING_NOW;
    try {
      process.env.NODE_ENV = 'test';
      process.env.FLOZ_TEST_REPORTING_NOW = 'not-a-date';
      expect(() => app!.get(ReportingClock).now()).toThrow('FLOZ_TEST_REPORTING_NOW');
      process.env.NODE_ENV = 'production';
      expect(app!.get(ReportingClock).now()).toBeInstanceOf(Date);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
      if (previousReportingNow === undefined) delete process.env.FLOZ_TEST_REPORTING_NOW; else process.env.FLOZ_TEST_REPORTING_NOW = previousReportingNow;
    }
  });

  it('keeps /api/v1 health shape', async () => {
    await request(app!.getHttpServer()).get('/api/v1/health').expect(200).expect(({ body }) => expect(body).toEqual({ data: { status: 'ok', service: 'api' } }));
  });

  it('provisions an identity without membership, session, cookie forwarding, or admin session replacement', async () => {
    const f = await fixture(app!);
    const before = await request(app!.getHttpServer()).get('/api/v1/me').set('Cookie', f.adminCookie).expect(200);
    const provisioned = await request(app!.getHttpServer())
      .post(`/api/v1/workspaces/${f.workspaceId}/accounts`)
      .set('Cookie', f.adminCookie)
      .send({ email: 'worker@example.com', full_name: 'Worker User' })
      .expect(201);
    expect(provisioned.headers['set-cookie']).toBeUndefined();
    expect(provisioned.headers['cache-control']).toContain('no-store');
    expect(provisioned.body.data.user.email).toBe('worker@example.com');
    expect(typeof provisioned.body.data.temporary_password).toBe('string');
    expect(provisioned.body.data.temporary_password.length).toBeGreaterThanOrEqual(24);
    const after = await request(app!.getHttpServer()).get('/api/v1/me').set('Cookie', f.adminCookie).expect(200);
    expect(after.body.data.id).toBe(before.body.data.id);
    const { sql } = createDatabase(databaseUrl);
    const userId = String(provisioned.body.data.user.id);
    const memberships = await sql`SELECT COUNT(*)::int AS count FROM workspace_memberships WHERE user_id = ${userId}`;
    const workspaces = await sql`SELECT COUNT(*)::int AS count FROM workspaces WHERE created_by = ${userId}`;
    const userSessions = await sql`SELECT COUNT(*)::int AS count FROM sessions WHERE user_id = ${userId}`;
    expect(memberships[0].count).toBe(0);
    expect(workspaces[0].count).toBe(0);
    expect(userSessions[0].count).toBe(0);
    await sql.end();
  });

  it('rejects provisioning for public, non-admin, and duplicate email requests', async () => {
    const f = await fixture(app!);
    await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/accounts`).send({ email: 'anon@example.com', full_name: 'Anon' }).expect(401);
    await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/accounts`).set('Cookie', f.memberCookie).send({ email: 'denied@example.com', full_name: 'Denied' }).expect(403);
    await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/accounts`).set('Cookie', f.adminCookie).send({ email: 'admin@example.com', full_name: 'Duplicate' }).expect(409);
  });

  it('lets admins look up accounts by email without exposing credentials', async () => {
    const f = await fixture(app!);
    await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/accounts`).set('Cookie', f.adminCookie).send({ email: 'lookup@example.com', full_name: 'Lookup User' }).expect(201);
    await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.workspaceId}/users?email=lookup@example.com`).set('Cookie', f.adminCookie).expect(200).expect(({ body }) => {
      expect(body.data).toMatchObject({ email: 'lookup@example.com', full_name: 'Lookup User' });
      expect(body.data).not.toHaveProperty('temporary_password');
    });
    await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.workspaceId}/users?email=missing@example.com`).set('Cookie', f.adminCookie).expect(404);
    await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.workspaceId}/users`).set('Cookie', f.adminCookie).expect(400);
    await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.workspaceId}/users?email=lookup@example.com`).expect(401);
    await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.workspaceId}/users?email=lookup@example.com`).set('Cookie', f.memberCookie).expect(403);
  });

  it('updates the authenticated profile without changing email identity', async () => {
    const f = await fixture(app!);
    await request(app!.getHttpServer()).patch('/api/v1/me').set('Cookie', f.memberCookie).send({ full_name: 'Updated Member', timezone: 'UTC', locale: 'en-US', avatar_url: null, email: 'evil@example.com' }).expect(200).expect(({ body }) => {
      expect(body.data.full_name).toBe('Updated Member');
      expect(body.data.email).toBe('member@example.com');
      expect(body.data.timezone).toBe('UTC');
      expect(body.data.locale).toBe('en-US');
      expect(body.data.avatar_url).toBeNull();
    });
    await request(app!.getHttpServer()).patch('/api/v1/me').set('Cookie', f.memberCookie).send({ timezone: 'Not/AZone' }).expect(400);
  });

  it('shows no workspace access for provisioned users without memberships', async () => {
    const f = await fixture(app!);
    const provisioned = await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/accounts`).set('Cookie', f.adminCookie).send({ email: 'noworkspace@example.com', full_name: 'No Workspace' }).expect(201);
    const loginRes = await request(app!.getHttpServer()).post('/api/v1/auth/login').send({ email: 'noworkspace@example.com', password: provisioned.body.data.temporary_password }).expect(200);
    const cookie = loginRes.headers['set-cookie'][0].split(';')[0];
    await request(app!.getHttpServer()).get('/api/v1/me').set('Cookie', cookie).expect(200).expect(({ body }) => expect(body.data.workspaces).toEqual([]));
  });

  it('manages workspace members through canonical lifecycle states', async () => {
    const f = await fixture(app!);
    const provisioned = await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/accounts`).set('Cookie', f.adminCookie).send({ email: 'invited@example.com', full_name: 'Invited User' }).expect(201);
    const userId = provisioned.body.data.user.id;
    await request(app!.getHttpServer()).patch(`/api/v1/workspaces/${f.workspaceId}`).set('Cookie', f.adminCookie).send({ name: 'Renamed Floz', timezone: 'UTC' }).expect(200).expect(({ body }) => expect(body.data).toMatchObject({ id: f.workspaceId, name: 'Renamed Floz', timezone: 'UTC' }));
    await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/members`).set('Cookie', f.adminCookie).send({ user_id: userId, role: 'MEMBER' }).expect(201).expect(({ body }) => expect(body.data).toMatchObject({ user_id: userId, full_name: 'Invited User', email: 'invited@example.com', role: 'MEMBER', status: 'INVITED' }));
    await request(app!.getHttpServer()).patch(`/api/v1/workspaces/${f.workspaceId}/members/${userId}`).set('Cookie', f.adminCookie).send({ status: 'ACTIVE' }).expect(200);
    await request(app!.getHttpServer()).patch(`/api/v1/workspaces/${f.workspaceId}/members/${userId}`).set('Cookie', f.adminCookie).send({ status: 'SUSPENDED' }).expect(200);
    await request(app!.getHttpServer()).patch(`/api/v1/workspaces/${f.workspaceId}/members/${userId}`).set('Cookie', f.adminCookie).send({ status: 'REMOVED' }).expect(200);
    await request(app!.getHttpServer()).delete(`/api/v1/workspaces/${f.workspaceId}/members/${userId}`).set('Cookie', f.adminCookie).expect(404);
    await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.workspaceId}/members`).set('Cookie', f.adminCookie).expect(200).expect(({ body }) => expect(body.data.find((member: { user_id: string }) => member.user_id === userId)).toMatchObject({ user_id: userId, full_name: 'Invited User', email: 'invited@example.com', role: 'MEMBER', status: 'REMOVED' }));
  });

  it('rejects lifecycle changes that remove an active team manager', async () => {
    const f = await fixture(app!);
    const { sql } = createDatabase(databaseUrl);
    await sql`UPDATE workspace_memberships SET role_id=(SELECT id FROM roles WHERE code='MANAGER') WHERE workspace_id=${f.workspaceId} AND user_id=${f.memberId}`;
    await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/teams`).set('Cookie', f.adminCookie).send({ name: 'Managed', manager_user_id: f.memberId }).expect(201);
    await request(app!.getHttpServer()).patch(`/api/v1/workspaces/${f.workspaceId}/members/${f.memberId}`).set('Cookie', f.adminCookie).send({ role: 'MEMBER' }).expect(409);
    await request(app!.getHttpServer()).patch(`/api/v1/workspaces/${f.workspaceId}/members/${f.memberId}`).set('Cookie', f.adminCookie).send({ status: 'SUSPENDED' }).expect(409);
    await sql.end();
  });

  it('validates manager authority and supports explicit manager clearing', async () => {
    const f = await fixture(app!);
    const { sql } = createDatabase(databaseUrl);
    await sql`UPDATE workspace_memberships SET role_id = (SELECT id FROM roles WHERE code = 'MANAGER') WHERE workspace_id = ${f.workspaceId} AND user_id = ${f.memberId}`;
    const managerTeam = await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/teams`).set('Cookie', f.adminCookie).send({ name: 'Managed', manager_user_id: f.memberId }).expect(201);
    await request(app!.getHttpServer()).patch(`/api/v1/workspaces/${f.workspaceId}/teams/${managerTeam.body.data.id}`).set('Cookie', f.adminCookie).send({ manager_user_id: null }).expect(200).expect(({ body }) => expect(body.data.manager_user_id).toBeNull());
    const patchPath = `/api/v1/workspaces/${f.workspaceId}/teams/${managerTeam.body.data.id}`;
    await sql`UPDATE workspace_memberships SET role_id = (SELECT id FROM roles WHERE code = 'MEMBER') WHERE workspace_id = ${f.workspaceId} AND user_id = ${f.memberId}`;
    await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/teams`).set('Cookie', f.adminCookie).send({ name: 'Member Managed', manager_user_id: f.memberId }).expect(400);
    await request(app!.getHttpServer()).patch(patchPath).set('Cookie', f.adminCookie).send({ manager_user_id: f.memberId }).expect(400);
    await sql`UPDATE workspace_memberships SET role_id = (SELECT id FROM roles WHERE code = 'FIELD_WORKER') WHERE workspace_id = ${f.workspaceId} AND user_id = ${f.memberId}`;
    await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/teams`).set('Cookie', f.adminCookie).send({ name: 'Worker Managed', manager_user_id: f.memberId }).expect(400);
    await request(app!.getHttpServer()).patch(patchPath).set('Cookie', f.adminCookie).send({ manager_user_id: f.memberId }).expect(400);
    await sql`UPDATE workspace_memberships SET status = 'INACTIVE' WHERE workspace_id = ${f.workspaceId} AND user_id = ${f.memberId}`;
    await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/teams`).set('Cookie', f.adminCookie).send({ name: 'Inactive Managed', manager_user_id: f.memberId }).expect(400);
    await request(app!.getHttpServer()).patch(patchPath).set('Cookie', f.adminCookie).send({ manager_user_id: f.memberId }).expect(400);
    await request(app!.getHttpServer()).patch(patchPath).set('Cookie', f.adminCookie).send({ manager_user_id: f.outsiderId }).expect(400);
    await sql.end();
  });

  it('archives and restores teams without silently clearing managers', async () => {
    const canonicalApp = await createApp(true);
    const f = await fixture(canonicalApp);
    const { sql } = createDatabase(databaseUrl);
    await sql`UPDATE workspace_memberships SET role_id=(SELECT id FROM roles WHERE code='MANAGER') WHERE workspace_id=${f.workspaceId} AND user_id=${f.memberId}`;
    const validTeam = await request(canonicalApp.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/teams`).set('Cookie', f.adminCookie).send({ name: 'Valid manager lifecycle', manager_user_id: f.adminId }).expect(201);
    const validPath = `/api/v1/workspaces/${f.workspaceId}/teams/${validTeam.body.data.id}`;
    await request(canonicalApp.getHttpServer()).patch(validPath).set('Cookie', f.adminCookie).send({ is_active: false }).expect(200).expect(({ body }) => expect(body.data.manager_user_id).toBe(f.adminId));
    await request(canonicalApp.getHttpServer()).patch(validPath).set('Cookie', f.adminCookie).send({ is_active: true }).expect(200).expect(({ body }) => { expect(body.data.isActive).toBe(true); expect(body.data.manager_user_id).toBe(f.adminId); });
    const team = await request(canonicalApp.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/teams`).set('Cookie', f.adminCookie).send({ name: 'Lifecycle', manager_user_id: f.memberId }).expect(201);
    const path = `/api/v1/workspaces/${f.workspaceId}/teams/${team.body.data.id}`;
    const task = await request(canonicalApp.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/tasks`).set('Cookie', f.memberCookie).send({ title: 'Historical team task', team_id: team.body.data.id }).expect(201);
    await request(canonicalApp.getHttpServer()).patch(path).set('Cookie', f.adminCookie).send({ is_active: false }).expect(200).expect(({ body }) => { expect(body.data.isActive).toBe(false); expect(body.data.manager_user_id).toBe(f.memberId); });
    await request(canonicalApp.getHttpServer()).patch(`/api/v1/workspaces/${f.workspaceId}/members/${f.memberId}`).set('Cookie', f.adminCookie).send({ role: 'MEMBER' }).expect(200);
    await request(canonicalApp.getHttpServer()).get(path).set('Cookie', f.memberCookie).expect(200).expect(({ body }) => expect(body.data.manager_user_id).toBe(f.memberId));
    await request(canonicalApp.getHttpServer()).post(`${path}/members`).set('Cookie', f.adminCookie).send({ user_id: f.adminId }).expect(409);
    await request(canonicalApp.getHttpServer()).patch(path).set('Cookie', f.adminCookie).send({ is_active: true }).expect(409).expect(({ body }) => expect(body.error.code).toBe('INVALID_MANAGER'));
    await request(canonicalApp.getHttpServer()).get(`/api/v1/workspaces/${f.workspaceId}/tasks/${task.body.data.id}`).set('Cookie', f.memberCookie).expect(200).expect(({ body }) => expect(body.data.team_id).toBe(team.body.data.id));
    await request(canonicalApp.getHttpServer()).patch(path).set('Cookie', f.adminCookie).send({ manager_user_id: null, is_active: true }).expect(200).expect(({ body }) => { expect(body.data.isActive).toBe(true); expect(body.data.manager_user_id).toBeNull(); });
    await request(canonicalApp.getHttpServer()).patch(path).set('Cookie', f.adminCookie).send({ is_active: false }).expect(200);
    await request(canonicalApp.getHttpServer()).patch(path).set('Cookie', f.adminCookie).send({ manager_user_id: f.adminId, is_active: true }).expect(200).expect(({ body }) => { expect(body.data.isActive).toBe(true); expect(body.data.manager_user_id).toBe(f.adminId); });
    await request(canonicalApp.getHttpServer()).patch(path).set('Cookie', f.adminCookie).send({ is_active: false }).expect(200);
    await sql`UPDATE workspace_memberships SET status = 'SUSPENDED' WHERE workspace_id=${f.workspaceId} AND user_id=${f.memberId}`;
    await request(canonicalApp.getHttpServer()).patch(path).set('Cookie', f.adminCookie).send({ manager_user_id: f.memberId, is_active: true }).expect(400).expect(({ body }) => expect(body.error.code).toBe('INVALID_MANAGER'));
    await request(canonicalApp.getHttpServer()).patch(path).set('Cookie', f.adminCookie).send({ manager_user_id: null, is_active: true }).expect(200).expect(({ body }) => { expect(body.data.isActive).toBe(true); expect(body.data.manager_user_id).toBeNull(); });
    await request(canonicalApp.getHttpServer()).patch(`/api/v1/workspaces/${f.otherWorkspaceId}/teams/${team.body.data.id}`).set('Cookie', f.outsiderCookie).send({ is_active: false }).expect(404);
    await sql.end();
    await canonicalApp.close();
  });

  it('persists workspace and team relations with isolation and reference rejection', async () => {
    const f = await fixture(app!);
    await request(app!.getHttpServer()).get('/api/v1/workspaces').set('Cookie', f.memberCookie).expect(200).expect(({ body }) => expect(body.data.map((w: { id: string }) => w.id)).toEqual([f.workspaceId]));
    await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.otherWorkspaceId}`).set('Cookie', f.memberCookie).expect(404);
    await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/teams`).set('Cookie', f.memberCookie).send({ name: 'Ops' }).expect(403);
    await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/teams`).set('Cookie', f.adminCookie).send({ name: 'Ops', manager_user_id: f.outsiderId }).expect(400);
    const team = await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/teams`).set('Cookie', f.adminCookie).send({ name: 'Ops', manager_user_id: f.adminId }).expect(201);
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

  it('reuses canonical operational, completed, scoped, date, and priority filters', async () => {
    const f = await fixture(app!);
    const path = `/api/v1/workspaces/${f.workspaceId}/tasks`;
    const { sql } = createDatabase(databaseUrl);
    const cancelledId = randomUUID();
    const terminalId = randomUUID();
    await sql`INSERT INTO task_statuses(id,workflow_id,code,name,category,position,is_terminal) VALUES(${cancelledId},${f.workflowId},'FILTER_CANCELLED','Cancelled','CANCELLED',998,false),(${terminalId},${f.workflowId},'FILTER_TERMINAL','Terminal','IN_PROGRESS',999,true)`;
    const team = (await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/teams`).set('Cookie', f.adminCookie).send({ name: 'Filter Ops' }).expect(201)).body.data.id;
    const create = async (title: string, priority: string, due_at: string, assignee = f.memberId) => (await request(app!.getHttpServer()).post(path).set('Cookie', f.memberCookie).send({ title, priority, due_at, team_id: team, assignees: [{ user_id: assignee }] }).expect(201)).body.data;
    const urgent = await create('Urgent boundary', 'URGENT', '2026-09-01T00:00:00.000Z');
    await create('High inside', 'HIGH', '2026-09-01T12:00:00.000Z');
    await create('Low end excluded', 'LOW', '2026-09-02T00:00:00.000Z');
    const completed = await create('Completed task', 'MEDIUM', '2026-09-01T13:00:00.000Z');
    await sql`UPDATE tasks SET completed_at='2026-09-01T14:00:00Z',status_id=${f.todoId} WHERE id=${completed.id}`;
    const cancelled = await create('Cancelled task', 'URGENT', '2026-09-01T10:00:00.000Z');
    const terminal = await create('Terminal task', 'URGENT', '2026-09-01T11:00:00.000Z');
    await sql`UPDATE tasks SET status_id=${cancelledId} WHERE id=${cancelled.id}`;
    await sql`UPDATE tasks SET status_id=${terminalId} WHERE id=${terminal.id}`;
    await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.otherWorkspaceId}/tasks`).set('Cookie', f.outsiderCookie).send({ title: 'Other workspace', priority: 'URGENT', due_at: '2026-09-01T09:00:00.000Z' }).expect(201);
    const query = { bucket: 'active', due_from: '2026-09-01T00:00:00.000Z', due_to: '2026-09-02T00:00:00.000Z', team_id: team, assignee_id: f.memberId, sort: 'priority', limit: 1 };
    const first = await request(app!.getHttpServer()).get(path).set('Cookie', f.memberCookie).query(query).expect(200);
    const second = await request(app!.getHttpServer()).get(path).set('Cookie', f.memberCookie).query({ ...query, cursor: first.body.meta.pagination.next_cursor }).expect(200);
    expect([...first.body.data, ...second.body.data].map((task: { title: string }) => task.title)).toEqual(['Urgent boundary', 'High inside']);
    await request(app!.getHttpServer()).get(path).set('Cookie', f.memberCookie).query({ bucket: 'completed' }).expect(200).expect(({ body }) => expect(body.data.map((task: { id: string }) => task.id)).toEqual([completed.id]));
    expect(urgent.id).toBeTruthy();
    await sql.end();
  });

  it('rejects malformed task-list ranges and cross-workspace references before SQL', async () => {
    const f = await fixture(app!);
    const path = `/api/v1/workspaces/${f.workspaceId}/tasks`;
    for (const query of [
      { due_from: '2026-02-30T00:00:00.000Z' },
      { due_to: '2026-09-01' },
      { due_from: '2026-09-02T00:00:00.000Z', due_to: '2026-09-01T00:00:00.000Z' },
      { team_id: 'not-a-uuid' },
      { assignee_id: 'not-a-uuid' },
      { status_id: 'not-a-uuid' },
    ]) await request(app!.getHttpServer()).get(path).set('Cookie', f.memberCookie).query(query).expect(400).expect(({ body }) => expect(body.message).toBe('VALIDATION_ERROR'));
    await request(app!.getHttpServer()).get(path).set('Cookie', f.memberCookie).query({ team_id: randomUUID() }).expect(400).expect(({ body }) => expect(body.message).toBe('TEAM_SCOPE_MISMATCH'));
    await request(app!.getHttpServer()).get(path).set('Cookie', f.memberCookie).query({ assignee_id: f.outsiderId }).expect(400).expect(({ body }) => expect(body.message).toBe('CROSS_WORKSPACE_REFERENCE'));
    await request(app!.getHttpServer()).get(path).set('Cookie', f.memberCookie).query({ status_id: randomUUID() }).expect(400).expect(({ body }) => expect(body.message).toBe('STATUS_SCOPE_MISMATCH'));
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
    await request(app!.getHttpServer()).get(otherPath).set('Cookie', f.outsiderCookie).query({ sort: 'priority', limit: 2, cursor: first.body.meta.pagination.next_cursor }).expect(200).expect(({ body }) => expect(body.data).toEqual([]));
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

  it('implements recurrence API persistence and orchestration', async () => {
    const f = await fixture(app!);
    const { sql: db } = createDatabase(databaseUrl);
    const team = (await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/teams`).set('Cookie', f.adminCookie).send({ name: 'Ops', manager_user_id: f.adminId }).expect(201)).body.data;
    const otherTeam = (await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.otherWorkspaceId}/teams`).set('Cookie', f.outsiderCookie).send({ name: 'Alien' }).expect(201)).body.data;
    const otherWorkflowId = (await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.otherWorkspaceId}/tasks`).set('Cookie', f.outsiderCookie).send({ title: 'Alien workflow' }).expect(201)).body.data.workflow_id;
    const base = `/api/v1/workspaces/${f.workspaceId}`;
    const create = `${base}/recurring-tasks`;
    const valid = { name: 'Daily inspection', frequency: 'DAILY', interval_value: 1, timezone: 'Asia/Jakarta', start_at: '2026-08-27T09:00:00.000Z', title: 'Inspect pump', workflow_id: f.workflowId, team_id: team.id, assignee_ids: [f.memberId], primary_assignee_id: f.memberId };
    await request(app!.getHttpServer()).post(create).send(valid).expect(401);
    await request(app!.getHttpServer()).post(create).set('Cookie', f.memberCookie).send(valid).expect(400).expect(({ body }) => expect(body.message).toBe('IDEMPOTENCY_KEY_REQUIRED'));
    for (const body of [{ ...valid, frequency: 'CUSTOM' }, { ...valid, interval_value: 0 }, { ...valid, occurrence_limit: 0 }, { ...valid, end_at: '2026-09-01T09:00:00.000Z', occurrence_limit: 2 }, { ...valid, timezone: 'UTC' }, { ...valid, workflow_id: 'not-a-uuid' }]) await request(app!.getHttpServer()).post(create).set('Cookie', f.memberCookie).set('Idempotency-Key', randomUUID()).send(body).expect(400);
    await request(app!.getHttpServer()).post(create).set('Cookie', f.memberCookie).set('Idempotency-Key', randomUUID()).send({ ...valid, team_id: otherTeam.id }).expect(400).expect(({ body }) => expect(body.message).toBe('TEAM_SCOPE_MISMATCH'));
    await request(app!.getHttpServer()).post(create).set('Cookie', f.memberCookie).set('Idempotency-Key', randomUUID()).send({ ...valid, assignee_ids: [f.outsiderId], primary_assignee_id: f.outsiderId }).expect(400).expect(({ body }) => expect(body.message).toBe('CROSS_WORKSPACE_REFERENCE'));
    await request(app!.getHttpServer()).post(create).set('Cookie', f.memberCookie).set('Idempotency-Key', randomUUID()).send({ ...valid, end_at: '2026-08-26T09:00:00.000Z' }).expect(400).expect(({ body }) => expect(body.message).toBe('VALIDATION_ERROR'));
    const created = await request(app!.getHttpServer()).post(create).set('Cookie', f.memberCookie).set('Idempotency-Key', 'rk-1').send(valid).expect(201);
    expect(created.body.data.first_occurrence.recurrence_rule_id).toBe(created.body.data.id);
    expect(created.body.data.next_run_at > created.body.data.first_occurrence.start_at).toBe(true);
    const history = await db`SELECT event_type, metadata FROM task_history WHERE task_id=${created.body.data.first_occurrence.id} ORDER BY created_at, id`;
    expect(history).toEqual([{ event_type: 'RECURRING_GENERATED', metadata: { recurrence_rule_id: created.body.data.id, scheduled_for: created.body.data.first_occurrence.start_at } }]);
    const occurrence = await db`SELECT recurrence_rule_id, task_id, scheduled_for FROM recurrence_occurrences WHERE task_id=${created.body.data.first_occurrence.id}`;
    expect(occurrence[0]).toMatchObject({ recurrence_rule_id: created.body.data.id, task_id: created.body.data.first_occurrence.id });
    const outbox = await db`SELECT status, event_type, available_at FROM outbox_events WHERE aggregate_id=${created.body.data.id}`;
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ status: 'PENDING', event_type: 'RECURRENCE_WAKEUP' });
    const replay = await request(app!.getHttpServer()).post(create).set('Cookie', f.memberCookie).set('Idempotency-Key', 'rk-1').send(valid).expect(201);
    expect(replay.body).toEqual(created.body);
    await request(app!.getHttpServer()).post(create).set('Cookie', f.memberCookie).set('Idempotency-Key', 'rk-1').send({ ...valid, title: 'Changed' }).expect(409).expect(({ body }) => expect(body.message).toBe('IDEMPOTENCY_REUSE'));
    const limitOne = await request(app!.getHttpServer()).post(create).set('Cookie', f.memberCookie).set('Idempotency-Key', 'rk-2').send({ ...valid, name: 'One-shot', occurrence_limit: 1 }).expect(201);
    expect(limitOne.body.data.next_run_at).toBeNull();
    expect((await db`SELECT id FROM outbox_events WHERE aggregate_id=${limitOne.body.data.id}`)).toEqual([]);
    const endBoundary = await request(app!.getHttpServer()).post(create).set('Cookie', f.memberCookie).set('Idempotency-Key', 'rk-3').send({ ...valid, name: 'Ends once', end_at: valid.start_at }).expect(201);
    expect(endBoundary.body.data.next_run_at).toBeNull();
    const rules = await request(app!.getHttpServer()).get(`${base}/recurrence-rules`).set('Cookie', f.memberCookie).query({ active: true, team_id: team.id, assignee_id: f.memberId, limit: 10 }).expect(200);
    expect(rules.body.data.map((r: { id: string }) => r.id)).toContain(created.body.data.id);
    const firstPage = await request(app!.getHttpServer()).get(`${base}/recurrence-rules`).set('Cookie', f.memberCookie).query({ limit: 2 }).expect(200);
    const secondPage = await request(app!.getHttpServer()).get(`${base}/recurrence-rules`).set('Cookie', f.memberCookie).query({ limit: 2, cursor: firstPage.body.meta.pagination.next_cursor }).expect(200);
    expect(firstPage.body.meta.pagination).toMatchObject({ limit: 2, has_more: true });
    expect(firstPage.body.meta.pagination.next_cursor).toEqual(expect.any(String));
    expect(secondPage.body.data.map((r: { id: string }) => r.id)).not.toEqual(expect.arrayContaining(firstPage.body.data.map((r: { id: string }) => r.id)));
    expect(secondPage.body.meta.pagination).toEqual({ limit: 2, next_cursor: null, has_more: false });
    await request(app!.getHttpServer()).get(`${base}/recurrence-rules`).set('Cookie', f.memberCookie).query({ team_id: otherTeam.id }).expect(400).expect(({ body }) => expect(body.message).toBe('TEAM_SCOPE_MISMATCH'));
    await request(app!.getHttpServer()).get(`${base}/recurrence-rules`).set('Cookie', f.memberCookie).query({ assignee_id: f.outsiderId }).expect(400).expect(({ body }) => expect(body.message).toBe('CROSS_WORKSPACE_REFERENCE'));
    await request(app!.getHttpServer()).get(`/api/v1/workspaces/${f.otherWorkspaceId}/recurrence-rules/${created.body.data.id}`).set('Cookie', f.outsiderCookie).expect(404);
    await request(app!.getHttpServer()).get(`${base}/recurrence-rules/${created.body.data.id}`).set('Cookie', f.memberCookie).expect(200).expect(({ body }) => expect(body.data.id).toBe(created.body.data.id));
    await request(app!.getHttpServer()).patch(`${base}/recurrence-rules/${created.body.data.id}`).set('Cookie', f.memberCookie).send({ frequency: 'CUSTOM' }).expect(400);
    await request(app!.getHttpServer()).patch(`${base}/recurrence-rules/${created.body.data.id}`).set('Cookie', f.memberCookie).send({ end_at: '2026-09-01T09:00:00.000Z', occurrence_limit: 2 }).expect(400);
    await request(app!.getHttpServer()).patch(`${base}/recurrence-rules/${created.body.data.id}`).set('Cookie', f.memberCookie).send({ end_at: '2026-08-26T09:00:00.000Z' }).expect(400);
    await request(app!.getHttpServer()).patch(`${base}/recurrence-rules/${created.body.data.id}`).set('Cookie', f.memberCookie).send({ workflow_id: otherWorkflowId }).expect(400).expect(({ body }) => expect(body.message).toBe('WORKFLOW_SCOPE_MISMATCH'));
    await request(app!.getHttpServer()).patch(`${base}/recurrence-rules/${created.body.data.id}`).set('Cookie', f.memberCookie).send({ primary_assignee_id: f.outsiderId }).expect(400).expect(({ body }) => expect(body.message).toBe('CROSS_WORKSPACE_REFERENCE'));
    const beforePatch = await db`SELECT scheduled_for,task_id FROM recurrence_occurrences WHERE recurrence_rule_id=${created.body.data.id} ORDER BY scheduled_for`;
    const patched = await request(app!.getHttpServer()).patch(`${base}/recurrence-rules/${created.body.data.id}`).set('Cookie', f.memberCookie).send({ frequency: 'WEEKLY', interval_value: 2, start_at: '2026-08-28T09:00:00.000Z' }).expect(200);
    expect(new Date(patched.body.data.next_run_at).getTime()).toBeGreaterThan(Date.now());
    expect(await db`SELECT scheduled_for,task_id FROM recurrence_occurrences WHERE recurrence_rule_id=${created.body.data.id} ORDER BY scheduled_for`).toEqual(beforePatch);
    const patchedWakeups = await db`SELECT status,available_at FROM outbox_events WHERE aggregate_id=${created.body.data.id} AND event_type='RECURRENCE_WAKEUP'`;
    expect(patchedWakeups).toHaveLength(1);
    expect(patchedWakeups[0].status).toBe('PENDING');
    expect(new Date(patchedWakeups[0].available_at).toISOString()).toBe(patched.body.data.next_run_at);
    expect((await db`SELECT count(*)::int AS count FROM recurrence_occurrences WHERE recurrence_rule_id=${created.body.data.id}`)[0].count).toBe(1);
    const noFuture = await request(app!.getHttpServer()).patch(`${base}/recurrence-rules/${created.body.data.id}`).set('Cookie', f.memberCookie).send({ end_at: created.body.data.first_occurrence.start_at }).expect(200);
    expect(noFuture.body.data.next_run_at).toBeNull();
    expect(await db`SELECT id FROM outbox_events WHERE aggregate_id=${created.body.data.id} AND event_type='RECURRENCE_WAKEUP' AND status='PENDING'`).toEqual([]);
    await db`INSERT INTO outbox_events(workspace_id,aggregate_type,aggregate_id,event_type,payload,available_at) VALUES(${f.workspaceId},'recurrence_rule',${created.body.data.id},'RECURRENCE_WAKEUP','{}',NOW()+INTERVAL '1 day')`;
    const stopped = await request(app!.getHttpServer()).post(`${base}/recurrence-rules/${created.body.data.id}/stop`).set('Cookie', f.memberCookie).expect(200);
    expect(stopped.body.data).toMatchObject({ is_active: false, next_run_at: null });
    const stoppedAgain = await request(app!.getHttpServer()).post(`${base}/recurrence-rules/${created.body.data.id}/stop`).set('Cookie', f.memberCookie).expect(200);
    expect(stoppedAgain.body.data).toMatchObject({ is_active: false, next_run_at: null });
    expect(await db`SELECT id FROM outbox_events WHERE aggregate_id=${created.body.data.id} AND event_type='RECURRENCE_WAKEUP' AND status='PENDING'`).toEqual([]);
    expect((await db`SELECT id FROM tasks WHERE recurrence_rule_id=${created.body.data.id}`)).toHaveLength(1);
    await db.end();
  });

  it('claims, retries, reclaims, and ownership-guards outbox events', async () => {
    const f = await fixture(app!);
    const { sql: db } = createDatabase(databaseUrl);
    const now = new Date('2026-08-30T00:00:00.000Z');
    const ids = await db<{ id: string }[]>`INSERT INTO outbox_events(workspace_id,aggregate_type,aggregate_id,event_type,payload,status,available_at) VALUES (${f.workspaceId},'recurrence_rule',${randomUUID()},'RECURRENCE_WAKEUP','{}','PENDING',${now.toISOString()}),(${f.workspaceId},'recurrence_rule',${randomUUID()},'RECURRENCE_WAKEUP','{}','FAILED',${now.toISOString()}),(${f.workspaceId},'recurrence_rule',${randomUUID()},'RECURRENCE_WAKEUP','{}','PENDING',${new Date(now.getTime() + 60_000).toISOString()}),(${f.workspaceId},'recurrence_rule',${randomUUID()},'RECURRENCE_WAKEUP','{}','DISPATCHED',${now.toISOString()}) RETURNING id`;

    const first = await claimOutboxBatch(db, { claimToken: 'dispatcher-a', now, leaseMs: 1000, limit: 10 });
    expect(first.map((row) => row.id).sort()).toEqual(ids.slice(0, 2).map((row) => row.id).sort());
    expect(first.every((row) => row.attempt_count === 1)).toBe(true);
    expect(await claimOutboxBatch(db, { claimToken: 'dispatcher-b', now, leaseMs: 1000, limit: 10 })).toEqual([]);

    const reclaimed = await claimOutboxBatch(db, { claimToken: 'dispatcher-b', now: new Date(now.getTime() + 1001), leaseMs: 1000, limit: 1 });
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0].attempt_count).toBe(2);
    expect(await markOutboxDispatched(db, { id: reclaimed[0].id, claimToken: 'dispatcher-a', now: new Date(now.getTime() + 1002) })).toBe(false);
    expect(await markOutboxRetry(db, { id: reclaimed[0].id, claimToken: 'dispatcher-a', availableAt: new Date(now.getTime() + 2000), now: new Date(now.getTime() + 1002) })).toBe(false);

    const retryAt = new Date(now.getTime() + 3000);
    const expiredAt = new Date(now.getTime() + 2002);
    const beforeExpiredRetry = (await db`SELECT status,available_at,attempt_count,claimed_by,claimed_until FROM outbox_events WHERE id=${reclaimed[0].id}`)[0];
    expect(await markOutboxRetry(db, { id: reclaimed[0].id, claimToken: 'dispatcher-b', availableAt: retryAt, now: expiredAt })).toBe(false);
    expect((await db`SELECT status,available_at,attempt_count,claimed_by,claimed_until FROM outbox_events WHERE id=${reclaimed[0].id}`)[0]).toEqual(beforeExpiredRetry);
    const current = await claimOutboxBatch(db, { claimToken: 'dispatcher-c', now: expiredAt, leaseMs: 1000, limit: 10 });
    expect(current.some((row) => row.id === reclaimed[0].id)).toBe(true);
    expect(await markOutboxRetry(db, { id: reclaimed[0].id, claimToken: 'dispatcher-c', availableAt: retryAt, now: expiredAt })).toBe(true);
    const retried = (await db`SELECT status,available_at,attempt_count,claimed_by,claimed_until FROM outbox_events WHERE id=${reclaimed[0].id}`)[0];
    expect(retried).toMatchObject({ status: 'FAILED', attempt_count: 3, claimed_by: null, claimed_until: null });
    expect(new Date(retried.available_at).toISOString()).toBe(retryAt.toISOString());
    expect((await claimOutboxBatch(db, { claimToken: 'dispatcher-c', now: new Date(retryAt.getTime() - 1), leaseMs: 1000, limit: 10 })).some((row) => row.id === reclaimed[0].id)).toBe(false);
    const later = await claimOutboxBatch(db, { claimToken: 'dispatcher-c', now: retryAt, leaseMs: 1000, limit: 10 });
    expect(later.some((row) => row.id === reclaimed[0].id && row.attempt_count === 4)).toBe(true);
    expect(await markOutboxDispatched(db, { id: reclaimed[0].id, claimToken: 'dispatcher-c', now: retryAt })).toBe(true);
    expect((await db`SELECT status,dispatched_at,claimed_by,claimed_until FROM outbox_events WHERE id=${reclaimed[0].id}`)[0]).toMatchObject({ status: 'DISPATCHED', claimed_by: null, claimed_until: null });
    await db.end();
  });

  it('exposes Task 6 reporting endpoints with canonical envelopes and no fabricated approvals', async () => {
    const f = await fixture(app!);
    const path = `/api/v1/workspaces/${f.workspaceId}`;
    const myWork = await request(app!.getHttpServer()).get(`${path}/my-work`).set('Cookie', f.memberCookie).query({ date: '2026-08-31' }).expect(200);
    expect(myWork.body.data).toMatchObject({ today: [], upcoming: [], overdue: [], counts: { today: 0, upcoming: 0, overdue: 0 } });
    expect(myWork.body.meta).toMatchObject({ date: '2026-08-31', timezone: expect.any(String) });
    const member = await request(app!.getHttpServer()).get(`${path}/dashboard/member`).set('Cookie', f.memberCookie).expect(200);
    expect(member.body.data).not.toHaveProperty('pending_approvals');
    expect(member.body.data.kpis).toMatchObject({ completion_rate: expect.any(String), denominators: expect.any(Object) });
    const report = await request(app!.getHttpServer()).get(`${path}/reports/kpis`).set('Cookie', f.memberCookie).query({ from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' }).expect(200);
    expect(report.body.data.period).toMatchObject({ from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' });
    await request(app!.getHttpServer()).get(`${path}/reports/kpis`).set('Cookie', f.memberCookie).query({ from: 'bad', to: '2026-09-01T00:00:00.000Z' }).expect(400);
    for (const from of ['2026-02-30T00:00:00.000Z', '2026-08-01', 'August 1, 2026']) await request(app!.getHttpServer()).get(`${path}/reports/kpis`).set('Cookie', f.memberCookie).query({ from, to: '2026-09-01T00:00:00.000Z' }).expect(400);
    await request(app!.getHttpServer()).get(`${path}/my-work`).set('Cookie', f.memberCookie).query({ date: '2026-02-30' }).expect(400);
  });

  it('freezes reporting evaluation and enforces role scopes at endpoint boundaries', async () => {
    const f = await fixture(app!);
    const { sql } = createDatabase(databaseUrl);
    const base = `/api/v1/workspaces/${f.workspaceId}`;
    const cancelledId = randomUUID();
    await sql`INSERT INTO task_statuses(id,workflow_id,code,name,category,position,is_terminal) VALUES(${cancelledId},${f.workflowId},'REPORT_CANCELLED','Cancelled','CANCELLED',999,true)`;
    const add = async (key: string, due: string, completed: string | null, statusId = f.todoId, assignee: string | null = f.memberId) => {
      const id = randomUUID();
      await sql`INSERT INTO tasks(id,workspace_id,task_key,title,workflow_id,status_id,priority,creator_id,due_at,completed_at,created_at) VALUES(${id},${f.workspaceId},${key},${key},${f.workflowId},${statusId},'HIGH',${f.adminId},${due},${completed},'2026-09-01T00:00:00Z')`;
      if (assignee) await sql`INSERT INTO task_assignees(task_id,user_id,assigned_by) VALUES(${id},${assignee},${f.adminId})`;
    };
    await add('REPORT-DONE','2026-09-02T00:00:00Z','2026-09-01T01:30:00Z',f.doneId);
    await add('REPORT-OVERDUE','2026-09-01T00:00:00Z',null);
    await add('REPORT-EQUAL','2026-09-03T00:00:00Z',null);
    await add('REPORT-CANCELLED','2026-09-01T00:00:00Z',null,cancelledId);
    await add('REPORT-UNASSIGNED','2026-09-02T00:00:00Z',null,f.todoId,null);
    const previousNodeEnv = process.env.NODE_ENV;
    const previousReportingNow = process.env.FLOZ_TEST_REPORTING_NOW;
    const previousEvaluationAt = process.env.FLOZ_REPORTING_EVALUATION_AT;
    try {
      process.env.NODE_ENV = 'test';
      process.env.FLOZ_TEST_REPORTING_NOW = '2026-09-03T00:00:00.000Z';
      const query = { from: '2026-09-01T00:00:00.000Z', to: '2026-09-04T00:00:00.000Z', evaluationAt: '1999-01-01T00:00:00.000Z', now: '1999-01-01T00:00:00.000Z', clock: 'invalid' };
      const report = await request(app!.getHttpServer()).get(`${base}/reports/kpis`).set('Cookie', f.memberCookie).query(query).expect(200);
      expect(report.body.data).toMatchObject({ completion_rate: '0.500000', overdue_rate: '0.500000', on_time_completion_rate: '1.000000', average_completion_time_seconds: '5400', workload: 2, denominators: { due: 2, completed: 1, overdue: 1, onTime: 1 }, period: { evaluationAt: '2026-09-03T00:00:00.000Z' } });
      expect(report.body.data.period.evaluationAt).not.toBe('1999-01-01T00:00:00.000Z');
      await request(app!.getHttpServer()).get(`${base}/dashboard/manager`).set('Cookie', f.memberCookie).query(query).expect(403);
      await sql`UPDATE workspace_memberships SET role_id=(SELECT id FROM roles WHERE code='FIELD_WORKER') WHERE workspace_id=${f.workspaceId} AND user_id=${f.memberId}`;
      await request(app!.getHttpServer()).get(`${base}/dashboard/manager`).set('Cookie', f.memberCookie).query(query).expect(403);
      await sql`UPDATE workspace_memberships SET role_id=(SELECT id FROM roles WHERE code='MANAGER') WHERE workspace_id=${f.workspaceId} AND user_id=${f.memberId}`;
      await request(app!.getHttpServer()).get(`${base}/dashboard/manager`).set('Cookie', f.memberCookie).query(query).expect(200);
      await request(app!.getHttpServer()).get(`${base}/dashboard/manager`).set('Cookie', f.adminCookie).query(query).expect(200);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
      if (previousReportingNow === undefined) delete process.env.FLOZ_TEST_REPORTING_NOW; else process.env.FLOZ_TEST_REPORTING_NOW = previousReportingNow;
      if (previousEvaluationAt === undefined) delete process.env.FLOZ_REPORTING_EVALUATION_AT; else process.env.FLOZ_REPORTING_EVALUATION_AT = previousEvaluationAt;
      await sql.end();
    }
  });

  it('validates manager dashboard team filters without expanding scope', async () => {
    const f = await fixture(app!);
    const { sql } = createDatabase(databaseUrl);
    await sql`UPDATE workspace_memberships SET role_id=(SELECT id FROM roles WHERE code='MANAGER') WHERE workspace_id=${f.workspaceId} AND user_id=${f.memberId}`;
    const managed = (await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/teams`).set('Cookie', f.adminCookie).send({ name: 'Managed', manager_user_id: f.memberId }).expect(201)).body.data.id;
    const unmanaged = (await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/teams`).set('Cookie', f.adminCookie).send({ name: 'Unmanaged', manager_user_id: f.adminId }).expect(201)).body.data.id;
    const foreign = (await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.otherWorkspaceId}/teams`).set('Cookie', f.outsiderCookie).send({ name: 'Foreign' }).expect(201)).body.data.id;
    const query = { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' };
    const path = `/api/v1/workspaces/${f.workspaceId}/dashboard/manager`;
    await request(app!.getHttpServer()).get(path).set('Cookie', f.memberCookie).query({ ...query, team_id: managed }).expect(200);
    await request(app!.getHttpServer()).get(path).set('Cookie', f.memberCookie).query({ ...query, team_id: unmanaged }).expect(403);
    await request(app!.getHttpServer()).get(path).set('Cookie', f.memberCookie).query({ ...query, team_id: foreign }).expect(400);
    await request(app!.getHttpServer()).get(path).set('Cookie', f.adminCookie).query({ ...query, team_id: unmanaged }).expect(200);
    await request(app!.getHttpServer()).get(path).set('Cookie', f.adminCookie).query({ ...query, team_id: foreign }).expect(400);
    await request(app!.getHttpServer()).get(path).set('Cookie', f.adminCookie).query({ ...query, team_id: 'invalid' }).expect(400);
    await sql.end();
  });

  it('validates KPI team filters without expanding scope', async () => {
    const f = await fixture(app!);
    const { sql } = createDatabase(databaseUrl);
    await sql`UPDATE workspace_memberships SET role_id=(SELECT id FROM roles WHERE code='MANAGER') WHERE workspace_id=${f.workspaceId} AND user_id=${f.memberId}`;
    const managed = (await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/teams`).set('Cookie', f.adminCookie).send({ name: 'Managed', manager_user_id: f.memberId }).expect(201)).body.data.id;
    const unmanaged = (await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.workspaceId}/teams`).set('Cookie', f.adminCookie).send({ name: 'Unmanaged', manager_user_id: f.adminId }).expect(201)).body.data.id;
    const foreign = (await request(app!.getHttpServer()).post(`/api/v1/workspaces/${f.otherWorkspaceId}/teams`).set('Cookie', f.outsiderCookie).send({ name: 'Foreign' }).expect(201)).body.data.id;
    const query = { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' };
    const path = `/api/v1/workspaces/${f.workspaceId}/reports/kpis`;
    await request(app!.getHttpServer()).get(path).set('Cookie', f.memberCookie).query({ ...query, team_id: 'invalid' }).expect(400).expect(({ body }) => expect(body.message).toBe('VALIDATION_ERROR'));
    await request(app!.getHttpServer()).get(path).set('Cookie', f.memberCookie).query({ ...query, team_id: foreign }).expect(400).expect(({ body }) => expect(body.message).toBe('TEAM_SCOPE_MISMATCH'));
    await request(app!.getHttpServer()).get(path).set('Cookie', f.memberCookie).query({ ...query, team_id: unmanaged }).expect(403).expect(({ body }) => expect(body.message).toBe('FORBIDDEN'));
    await request(app!.getHttpServer()).get(path).set('Cookie', f.memberCookie).query({ ...query, team_id: managed }).expect(200);
    await request(app!.getHttpServer()).get(path).set('Cookie', f.adminCookie).query({ ...query, team_id: unmanaged }).expect(200);
    await request(app!.getHttpServer()).get(path).set('Cookie', f.adminCookie).query({ ...query, assignee_id: 'invalid' }).expect(400);
    await request(app!.getHttpServer()).get(path).set('Cookie', f.adminCookie).query({ ...query, assignee_id: f.outsiderId }).expect(400);
    await request(app!.getHttpServer()).get(path).set('Cookie', f.adminCookie).query({ ...query, assignee_id: f.memberId }).expect(200);
    await sql.end();
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
