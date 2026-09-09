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
  workflowId: string;
  status1Id: string;
  status2Id: string;
  status3Id: string;
  lockedStatusId: string;
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
  await client`INSERT INTO workspaces (id, name, slug, created_by) VALUES (${workspaceId}, 'Status WS', ${`ws-${workspaceId}`}, ${admin.user.id})`;
  await client`DELETE FROM workflow_transitions WHERE workflow_id IN (SELECT id FROM workflows WHERE workspace_id=${workspaceId})`;
  await client`DELETE FROM task_statuses WHERE workflow_id IN (SELECT id FROM workflows WHERE workspace_id=${workspaceId})`;
  await client`DELETE FROM workflows WHERE workspace_id=${workspaceId}`;

  await client`INSERT INTO workspace_memberships (workspace_id, user_id, role_id, status) VALUES (${workspaceId}, ${admin.user.id}, ${adminRoleId}, 'ACTIVE')`;

  const workflowId = randomUUID();
  await client`INSERT INTO workflows (id, workspace_id, code, name, is_default, is_active, version, created_by) VALUES (${workflowId}, ${workspaceId}, 'WF_STATUS', 'Status Workflow', false, true, 1, ${admin.user.id})`;

  const status1Id = randomUUID();
  const status2Id = randomUUID();
  const status3Id = randomUUID();
  const lockedStatusId = randomUUID();

  await client`INSERT INTO task_statuses (id, workflow_id, code, name, category, position, is_initial, is_terminal, is_active) VALUES (${status1Id}, ${workflowId}, 'S1', 'S1', 'TODO', 1, true, false, true)`;
  await client`INSERT INTO task_statuses (id, workflow_id, code, name, category, position, is_initial, is_terminal, is_active) VALUES (${status2Id}, ${workflowId}, 'S2', 'S2', 'IN_PROGRESS', 2, false, false, true)`;
  await client`INSERT INTO task_statuses (id, workflow_id, code, name, category, position, is_initial, is_terminal, is_active) VALUES (${status3Id}, ${workflowId}, 'S3', 'S3', 'DONE', 3, false, true, true)`;
  
  await client`INSERT INTO task_statuses (id, workflow_id, code, name, category, position, is_initial, is_terminal, is_active) VALUES (${lockedStatusId}, ${workflowId}, 'LOCKED', 'Locked', 'IN_PROGRESS', 4, false, false, true)`;
  
  // Create a task referencing lockedStatusId
  const taskId = randomUUID();
  await client`INSERT INTO tasks (id, workspace_id, task_key, title, workflow_id, status_id, priority, creator_id, version) VALUES (${taskId}, ${workspaceId}, 'TSK-1', 'Test', ${workflowId}, ${lockedStatusId}, 'MEDIUM', ${admin.user.id}, 1)`;

  // Add some transitions
  await client`INSERT INTO workflow_transitions (workflow_id, from_status_id, to_status_id, requires_permission) VALUES (${workflowId}, ${status1Id}, ${status2Id}, true)`;
  await client`INSERT INTO workflow_transitions (workflow_id, from_status_id, to_status_id, requires_permission) VALUES (${workflowId}, ${status2Id}, ${status3Id}, false)`;

  await client.end();

  return { app, adminCookie, workspaceId, workflowId, status1Id, status2Id, status3Id, lockedStatusId };
}

describe('Task 5 — Status Lifecycle, Reorder & Transition Preservation Integration', () => {
  let fix: Fixture;

  beforeAll(async () => {
    await resetDatabase();
    fix = await createFixture();
  });

  afterAll(async () => {
    await fix.app.close();
  });

  describe('Stale mutations', () => {
    it('returns 409 VERSION_CONFLICT on stale PATCH status with zero mutation', async () => {
      const res = await request(fix.app.getHttpServer())
        .patch(`/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.workflowId}/statuses/${fix.status1Id}`)
        .set('Cookie', fix.adminCookie)
        .send({ name: 'Hacked Name', version: 999 })
        .expect(409);

      expect(res.body.error.code).toBe('VERSION_CONFLICT');
      
      const { sql: client } = createDatabase(databaseUrl);
      const rows = await client`SELECT s.name, w.version FROM task_statuses s JOIN workflows w ON w.id=s.workflow_id WHERE s.id=${fix.status1Id}`;
      expect(rows[0].name).toBe('S1'); // Unchanged
      expect(rows[0].version).toBe(1);
      await client.end();
    });

    it('returns 409 VERSION_CONFLICT on stale PUT transitions with zero graph mutation', async () => {
      const res = await request(fix.app.getHttpServer())
        .put(`/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.workflowId}/transitions`)
        .set('Cookie', fix.adminCookie)
        .send({ transitions: [], version: 999 })
        .expect(409);

      expect(res.body.error.code).toBe('VERSION_CONFLICT');
    });
  });

  describe('Category Safety', () => {
    it('rejects category change if tasks exist in status with STATUS_CATEGORY_IN_USE', async () => {
      const res = await request(fix.app.getHttpServer())
        .patch(`/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.workflowId}/statuses/${fix.lockedStatusId}`)
        .set('Cookie', fix.adminCookie)
        .send({ category: 'TODO', version: 1 })
        .expect(409);

      expect(res.body.error.code).toBe('STATUS_CATEGORY_IN_USE');
    });

    it('allows category change if no tasks/recurrences exist', async () => {
      const res = await request(fix.app.getHttpServer())
        .patch(`/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.workflowId}/statuses/${fix.status3Id}`)
        .set('Cookie', fix.adminCookie)
        .send({ category: 'CANCELLED', version: 1 })
        .expect(200);
      
      const s3 = res.body.data.statuses.find((s: { id: string }) => s.id === fix.status3Id);
      expect(s3.category).toBe('CANCELLED');
      expect(s3.is_terminal).toBe(true);
      expect(res.body.data.version).toBe(2);
    });
  });

  describe('set-initial Race', () => {
    it('concurrent set-initial results in one winner and one VERSION_CONFLICT', async () => {
      // current version is 2
      const req1 = request(fix.app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.workflowId}/statuses/${fix.status2Id}/set-initial`)
        .set('Cookie', fix.adminCookie)
        .send({ version: 2 });

      const req2 = request(fix.app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.workflowId}/statuses/${fix.status2Id}/set-initial`)
        .set('Cookie', fix.adminCookie)
        .send({ version: 2 });

      const [res1, res2] = await Promise.all([req1, req2]);
      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 409]);

      const successRes = res1.status === 200 ? res1 : res2;
      const conflictRes = res1.status === 409 ? res1 : res2;
      
      expect(conflictRes.body.error.code).toBe('VERSION_CONFLICT');
      
      const initials = successRes.body.data.statuses.filter((s: { is_initial: boolean }) => s.is_initial);
      expect(initials.length).toBe(1);
      expect(initials[0].id).toBe(fix.status2Id);
      expect(successRes.body.data.version).toBe(3);
    });
  });

  describe('Dormant Transition & Compaction Lifecycle', () => {
    let s3ArchivedVersion: number;

    it('archives status, triggering position compaction and retaining dormant transitions', async () => {
      // current version is 3
      const res = await request(fix.app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.workflowId}/statuses/${fix.status3Id}/archive`)
        .set('Cookie', fix.adminCookie)
        .send({ version: 3 })
        .expect(200);

      s3ArchivedVersion = res.body.data.version;
      expect(s3ArchivedVersion).toBe(4);

      // Verify returned statuses compacted
      const statuses = res.body.data.statuses;
      const archivedS3 = statuses.find((s: { id: string }) => s.id === fix.status3Id);
      expect(archivedS3.is_active).toBe(false);
      expect(archivedS3.position).toBe(9999);
      expect(statuses.find((s: { id: string }) => s.id === fix.status1Id).position).toBe(1);
      expect(statuses.find((s: { id: string }) => s.id === fix.status2Id).position).toBe(2);
      expect(statuses.find((s: { id: string }) => s.id === fix.lockedStatusId).position).toBe(3);

      // Verify dormant transitions are retained in DB
      const { sql: client } = createDatabase(databaseUrl);
      const dormant = await client`SELECT * FROM workflow_transitions WHERE to_status_id = ${fix.status3Id}`;
      expect(dormant.length).toBe(1);
      await client.end();
    });

    it('preserves dormant edges when editing active transitions', async () => {
      // Edit active transitions, omitting dormant ones
      const res = await request(fix.app.getHttpServer())
        .put(`/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.workflowId}/transitions`)
        .set('Cookie', fix.adminCookie)
        .send({
          version: 4,
          transitions: [
            { from_status_id: fix.status1Id, to_status_id: fix.lockedStatusId, requires_permission: false }
          ]
        })
        .expect(200);

      expect(res.body.data.version).toBe(5);

      // Verify dormant transitions still present in DB
      const { sql: client } = createDatabase(databaseUrl);
      const dormant = await client`SELECT * FROM workflow_transitions WHERE to_status_id = ${fix.status3Id}`;
      expect(dormant.length).toBe(1);
      await client.end();
    });

    it('restoring the archived status revives the dormant transitions', async () => {
      const res = await request(fix.app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.workflowId}/statuses/${fix.status3Id}/restore`)
        .set('Cookie', fix.adminCookie)
        .send({ version: 5 })
        .expect(200);

      expect(res.body.data.version).toBe(6);
      
      const s3 = res.body.data.statuses.find((s: { id: string }) => s.id === fix.status3Id);
      expect(s3).toBeDefined();
      expect(s3.position).toBe(4); // activeCount + 1

      const edges = res.body.data.transitions;
      const revivedEdge = edges.find((e: { to_status_id: string }) => e.to_status_id === fix.status3Id);
      expect(revivedEdge).toBeDefined(); // returned by detail view since it's active again
      expect(revivedEdge.from_status_id).toBe(fix.status2Id);
    });
  });
});
