import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
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
  workspaceId: string;
  teamId: string;
  wsDefaultId: string;
  wsWorkflow2Id: string;
  wsWorkflow3Id: string;
  teamDefaultId: string;
  teamWorkflow2Id: string;
  recurrenceWfId: string;
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
  const app = await createApp();
  const auth = app.get(AuthService).auth;
  const admin = await auth.api.signUpEmail({ body: { email: 'admin@example.com', password: 'password123', name: 'Admin User' } });
  const adminCookie = await login(app, 'admin@example.com');

  const { sql: client } = createDatabase(databaseUrl);
  const roles = await client`INSERT INTO roles (code, name) VALUES ('ADMIN', 'Admin') ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id, code`;
  const adminRoleId = roles.find((r) => r.code === 'ADMIN')!.id;

  const workspaceId = randomUUID();
  const teamId = randomUUID();

  await client`INSERT INTO workspaces (id, name, slug, created_by) VALUES (${workspaceId}, 'Lifecycle WS', ${`ws-${workspaceId}`}, ${admin.user.id})`;
  await client`DELETE FROM workflow_transitions WHERE workflow_id IN (SELECT id FROM workflows WHERE workspace_id=${workspaceId})`;
  await client`DELETE FROM task_statuses WHERE workflow_id IN (SELECT id FROM workflows WHERE workspace_id=${workspaceId})`;
  await client`DELETE FROM workflows WHERE workspace_id=${workspaceId}`;

  await client`INSERT INTO workspace_memberships (workspace_id, user_id, role_id, status) VALUES (${workspaceId}, ${admin.user.id}, ${adminRoleId}, 'ACTIVE')`;
  await client`INSERT INTO teams (id, workspace_id, name, is_active) VALUES (${teamId}, ${workspaceId}, 'Lifecycle Team', true)`;

  const wsDefaultId = randomUUID();
  const wsWorkflow2Id = randomUUID();
  const wsWorkflow3Id = randomUUID();

  await client`INSERT INTO workflows (id, workspace_id, code, name, is_default, is_active, version, created_by) VALUES (${wsDefaultId}, ${workspaceId}, 'WS_DEF', 'WS Def', true, true, 1, ${admin.user.id})`;
  await client`INSERT INTO workflows (id, workspace_id, code, name, is_default, is_active, version, created_by) VALUES (${wsWorkflow2Id}, ${workspaceId}, 'WS_WF2', 'WS Wf2', false, true, 1, ${admin.user.id})`;
  await client`INSERT INTO workflows (id, workspace_id, code, name, is_default, is_active, version, created_by) VALUES (${wsWorkflow3Id}, ${workspaceId}, 'WS_WF3', 'WS Wf3', false, true, 1, ${admin.user.id})`;

  const teamDefaultId = randomUUID();
  const teamWorkflow2Id = randomUUID();
  await client`INSERT INTO workflows (id, workspace_id, team_id, code, name, is_default, is_active, version, created_by) VALUES (${teamDefaultId}, ${workspaceId}, ${teamId}, 'TM_DEF', 'Team Def', true, true, 1, ${admin.user.id})`;
  await client`INSERT INTO workflows (id, workspace_id, team_id, code, name, is_default, is_active, version, created_by) VALUES (${teamWorkflow2Id}, ${workspaceId}, ${teamId}, 'TM_WF2', 'Team Wf2', false, true, 1, ${admin.user.id})`;

  const recurrenceWfId = randomUUID();
  await client`INSERT INTO workflows (id, workspace_id, code, name, is_default, is_active, version, created_by) VALUES (${recurrenceWfId}, ${workspaceId}, 'REC_WF', 'Recurrence Wf', false, true, 1, ${admin.user.id})`;
  await client`INSERT INTO recurrence_rules (id, workspace_id, name, frequency, interval_value, start_at, timezone, is_active, template_snapshot, created_by) VALUES (${randomUUID()}, ${workspaceId}, 'Test Recurrence', 'DAILY', 1, NOW(), 'UTC', true, ${`{"workflow_id":"${recurrenceWfId}"}`}::jsonb, ${admin.user.id})`;

  await client.end();

  return { app, adminCookie, workspaceId, teamId, wsDefaultId, wsWorkflow2Id, wsWorkflow3Id, teamDefaultId, teamWorkflow2Id, recurrenceWfId };
}

describe('Task 4 — Workflow Set-Default & Archival Lifecycle Integration', () => {
  let fix: Fixture;

  beforeAll(async () => {
    await resetDatabase();
    fix = await createFixture();
  });

  afterAll(async () => {
    await fix.app.close();
  });

  describe('set-default no-op and stale version results', () => {
    it('returns 200 no-op without bumping version if already default and version matches', async () => {
      const res = await request(fix.app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.wsDefaultId}/set-default`)
        .set('Cookie', fix.adminCookie)
        .send({ version: 1 })
        .expect(200);

      expect(res.body.data.is_default).toBe(true);
      expect(res.body.data.version).toBe(1); // No bump
    });

    it('returns 409 VERSION_CONFLICT if already default but version is stale', async () => {
      const res = await request(fix.app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.wsDefaultId}/set-default`)
        .set('Cookie', fix.adminCookie)
        .send({ version: 999 })
        .expect(409);

      expect(res.body.error.code).toBe('VERSION_CONFLICT');
    });
  });

  describe('set-default concurrency races', () => {
    it('Case A: same-target race succeeds for winner and throws VERSION_CONFLICT for loser', async () => {
      // Both try to set wsWorkflow2Id to default using initial version 1
      const req1 = request(fix.app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.wsWorkflow2Id}/set-default`)
        .set('Cookie', fix.adminCookie)
        .send({ version: 1 });

      const req2 = request(fix.app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.wsWorkflow2Id}/set-default`)
        .set('Cookie', fix.adminCookie)
        .send({ version: 1 });

      const [res1, res2] = await Promise.all([req1, req2]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 409]);

      const successRes = res1.status === 200 ? res1 : res2;
      const conflictRes = res1.status === 409 ? res1 : res2;

      expect(successRes.body.data.is_default).toBe(true);
      expect(successRes.body.data.version).toBe(2);
      expect(conflictRes.body.error.code).toBe('VERSION_CONFLICT');
    });

    it('Case B: different-target race resolves sequentially leaving exactly one default', async () => {
      // Current default is now wsWorkflow2Id (version 2).
      // Let's set wsWorkflow2Id version to 2 and wsWorkflow3Id version to 1.
      // We will race setting wsWorkflow3Id (version 1) and wsWorkflow2Id (version 2) as default.
      
      const req1 = request(fix.app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.wsWorkflow3Id}/set-default`)
        .set('Cookie', fix.adminCookie)
        .send({ version: 1 });

      const req2 = request(fix.app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.wsWorkflow2Id}/set-default`)
        .set('Cookie', fix.adminCookie)
        .send({ version: 2 }); // Valid initial version for req2

      const [res1, res2] = await Promise.all([req1, req2]);
      
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      // Verify final state: exactly one workspace default exists.
      const { sql: client } = createDatabase(databaseUrl);
      const defaults = await client`SELECT id, version FROM workflows WHERE workspace_id = ${fix.workspaceId} AND team_id IS NULL AND is_default = true`;
      expect(defaults.length).toBe(1);
      
      const wf2 = await client`SELECT version FROM workflows WHERE id = ${fix.wsWorkflow2Id}`;
      const wf3 = await client`SELECT version FROM workflows WHERE id = ${fix.wsWorkflow3Id}`;
      // Versions are bumped deterministically based on execution order.
      expect(wf2[0].version).toBeGreaterThan(2);
      expect(wf3[0].version).toBeGreaterThan(1);
      
      await client.end();
    });
  });

  describe('Archive and Restore behavior', () => {
    it('rejects archiving workspace default workflow', async () => {
      // Find current workspace default
      const { sql: client } = createDatabase(databaseUrl);
      const curDef = await client`SELECT id, version FROM workflows WHERE workspace_id = ${fix.workspaceId} AND team_id IS NULL AND is_default = true`;
      await client.end();

      const res = await request(fix.app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/workflows/${curDef[0].id}/archive`)
        .set('Cookie', fix.adminCookie)
        .send({ version: curDef[0].version })
        .expect(409);

      expect(res.body.error.code).toBe('CANNOT_ARCHIVE_DEFAULT_WORKFLOW');
    });

    it('rejects archiving workflow with active recurrence dependency', async () => {
      const res = await request(fix.app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.recurrenceWfId}/archive`)
        .set('Cookie', fix.adminCookie)
        .send({ version: 1 })
        .expect(409);

      expect(res.body.error.code).toBe('RECURRENCE_DEPENDENCY_CONFLICT');
    });

    it('allows archiving team default workflow, unsetting its is_default flag', async () => {
      const res = await request(fix.app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.teamDefaultId}/archive`)
        .set('Cookie', fix.adminCookie)
        .send({ version: 1 })
        .expect(200);

      expect(res.body.data.is_active).toBe(false);
      expect(res.body.data.is_default).toBe(false);
      expect(res.body.data.version).toBe(2);
    });

    it('allows restoring archived workflow, ensuring is_default remains false', async () => {
      const res = await request(fix.app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.teamDefaultId}/restore`)
        .set('Cookie', fix.adminCookie)
        .send({ version: 2 })
        .expect(200);

      expect(res.body.data.is_active).toBe(true);
      expect(res.body.data.is_default).toBe(false);
      expect(res.body.data.version).toBe(3);
    });
  });
});
