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
  adminCookie: string;
  memberCookie: string;
  outsiderCookie: string;
  adminId: string;
  memberId: string;
  outsiderId: string;
  workspaceId: string;
  teamId: string;
  archivedTeamId: string;
  defaultWorkflowId: string;
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

async function createFixture(app: INestApplication): Promise<Fixture> {
  const auth = app.get(AuthService).auth;
  const admin = await auth.api.signUpEmail({ body: { email: 'admin@example.com', password: 'password123', name: 'Admin User' } });
  const member = await auth.api.signUpEmail({ body: { email: 'member@example.com', password: 'password123', name: 'Member User' } });
  const outsider = await auth.api.signUpEmail({ body: { email: 'outsider@example.com', password: 'password123', name: 'Outsider User' } });

  const adminCookie = await login(app, 'admin@example.com');
  const memberCookie = await login(app, 'member@example.com');
  const outsiderCookie = await login(app, 'outsider@example.com');

  const { sql: client } = createDatabase(databaseUrl);
  const roles = await client`INSERT INTO roles (code, name) VALUES ('ADMIN', 'Admin'), ('MEMBER', 'Member') ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id, code`;
  const adminRoleId = roles.find((r) => r.code === 'ADMIN')!.id;
  const memberRoleId = roles.find((r) => r.code === 'MEMBER')!.id;

  const workspaceId = randomUUID();
  const teamId = randomUUID();
  const archivedTeamId = randomUUID();

  await client`INSERT INTO workspaces (id, name, slug, created_by) VALUES (${workspaceId}, 'Test Workspace', ${`ws-${workspaceId}`}, ${admin.user.id})`;
  await client`DELETE FROM workflow_transitions WHERE workflow_id IN (SELECT id FROM workflows WHERE workspace_id=${workspaceId})`;
  await client`DELETE FROM task_statuses WHERE workflow_id IN (SELECT id FROM workflows WHERE workspace_id=${workspaceId})`;
  await client`DELETE FROM workflows WHERE workspace_id=${workspaceId}`;
  
  await client`INSERT INTO workspace_memberships (workspace_id, user_id, role_id, status) VALUES (${workspaceId}, ${admin.user.id}, ${adminRoleId}, 'ACTIVE')`;
  await client`INSERT INTO workspace_memberships (workspace_id, user_id, role_id, status) VALUES (${workspaceId}, ${member.user.id}, ${memberRoleId}, 'ACTIVE')`;

  await client`INSERT INTO teams (id, workspace_id, name, is_active) VALUES (${teamId}, ${workspaceId}, 'Active Team', true)`;
  await client`INSERT INTO teams (id, workspace_id, name, is_active) VALUES (${archivedTeamId}, ${workspaceId}, 'Archived Team', false)`;

  const defaultWfId = randomUUID();
  await client`INSERT INTO workflows (id, workspace_id, code, name, description, is_default, is_active, version, created_by) VALUES (${defaultWfId}, ${workspaceId}, 'DEFAULT_WF', 'Default Workflow', 'Default', true, true, 1, ${admin.user.id})`;
  const status1Id = randomUUID();
  const status2Id = randomUUID();
  await client`INSERT INTO task_statuses (id, workflow_id, code, name, category, position, is_initial, is_terminal, is_active) VALUES (${status1Id}, ${defaultWfId}, 'TODO', 'To Do', 'TODO', 1, true, false, true)`;
  await client`INSERT INTO task_statuses (id, workflow_id, code, name, category, position, is_initial, is_terminal, is_active) VALUES (${status2Id}, ${defaultWfId}, 'DONE', 'Done', 'DONE', 2, false, true, true)`;
  await client`INSERT INTO workflow_transitions (workflow_id, from_status_id, to_status_id, requires_permission) VALUES (${defaultWfId}, ${status1Id}, ${status2Id}, false)`;

  await client.end();

  return {
    adminCookie,
    memberCookie,
    outsiderCookie,
    adminId: admin.user.id,
    memberId: member.user.id,
    outsiderId: outsider.user.id,
    workspaceId,
    teamId,
    archivedTeamId,
    defaultWorkflowId: defaultWfId
  };
}

describe('Task 3 — Workflow CRUD & Atomic Creation Integration', () => {
  let app: INestApplication;
  let fix: Fixture;

  beforeAll(async () => {
    await resetDatabase();
    app = await createApp();
    fix = await createFixture(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/v1/workspaces/:workspaceId/workflows', () => {
    it('allows active workspace members to list active workflows', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${fix.workspaceId}/workflows`)
        .set('Cookie', fix.memberCookie)
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].id).toBe(fix.defaultWorkflowId);
      expect(res.body.data[0].statuses.length).toBe(2);
    });

    it('denies outsiders from listing workflows', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${fix.workspaceId}/workflows`)
        .set('Cookie', fix.outsiderCookie)
        .expect(404);
    });
  });

  describe('GET /api/v1/workspaces/:workspaceId/workflows/:workflowId', () => {
    it('returns detailed workflow tree including statuses and transitions', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.defaultWorkflowId}`)
        .set('Cookie', fix.memberCookie)
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(res.body.data.id).toBe(fix.defaultWorkflowId);
      expect(res.body.data.statuses.length).toBe(2);
      expect(res.body.data.transitions.length).toBe(1);
    });
  });

  describe('POST /api/v1/workspaces/:workspaceId/workflows', () => {
    const validPayload = {
      name: 'Custom Workflow',
      code: 'custom_wf',
      description: 'Test creation',
      statuses: [
        { name: 'Backlog', code: 'BACKLOG', category: 'TODO', is_initial: true },
        { name: 'Completed', code: 'FINISHED', category: 'DONE', is_initial: false }
      ],
      transitions: [{ from_status_code: 'BACKLOG', to_status_code: 'FINISHED' }]
    };

    it('forbids MEMBER role from creating workflows', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/workflows`)
        .set('Cookie', fix.memberCookie)
        .send(validPayload)
        .expect(403);
    });

    it('allows ADMIN to create workflow atomically and returns normalized canonical state', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/workflows`)
        .set('Cookie', fix.adminCookie)
        .send(validPayload)
        .expect(201);

      const wf = res.body.data;
      expect(wf.id).toBeDefined();
      expect(wf.code).toBe('CUSTOM_WF');
      expect(wf.name).toBe('Custom Workflow');
      expect(wf.is_active).toBe(true);
      expect(wf.is_default).toBe(false);
      expect(wf.version).toBe(1);
      expect(wf.statuses.length).toBe(2);
      expect(wf.transitions.length).toBe(1);
      expect(wf.transitions[0].requires_permission).toBe(false);
    });

    it('rejects passing is_default in creation body', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/workflows`)
        .set('Cookie', fix.adminCookie)
        .send({ ...validPayload, code: 'NEW_CODE_1', is_default: true })
        .expect(400);
    });

    it('rejects duplicate workflow code in workspace', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/workflows`)
        .set('Cookie', fix.adminCookie)
        .send({ ...validPayload, name: 'Different Name', code: 'CUSTOM_WF' })
        .expect(409);

      expect(res.body.error.code).toBe('DUPLICATE_WORKFLOW_CODE');
    });

    it('rejects duplicate workflow name in workspace', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/workflows`)
        .set('Cookie', fix.adminCookie)
        .send({ ...validPayload, name: 'custom workflow', code: 'UNIQUE_CODE_X' })
        .expect(409);

      expect(res.body.error.code).toBe('DUPLICATE_WORKFLOW_NAME');
    });

    it('rejects cross-workspace team_id with 422 CROSS_WORKSPACE_REFERENCE', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/workflows`)
        .set('Cookie', fix.adminCookie)
        .send({ ...validPayload, name: 'Team WF 1', code: 'TEAM_WF_1', team_id: randomUUID() })
        .expect(422);

      expect(res.body.error.code).toBe('CROSS_WORKSPACE_REFERENCE');
    });

    it('rejects archived team_id with 409 TEAM_ARCHIVED', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/workflows`)
        .set('Cookie', fix.adminCookie)
        .send({ ...validPayload, name: 'Team WF 2', code: 'TEAM_WF_2', team_id: fix.archivedTeamId })
        .expect(409);

      expect(res.body.error.code).toBe('TEAM_ARCHIVED');
    });

    it('rejects creation when initial status category is DONE or CANCELLED', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/workflows`)
        .set('Cookie', fix.adminCookie)
        .send({
          ...validPayload,
          name: 'Invalid Init DONE WF',
          code: 'INVALID_INIT_DONE',
          statuses: [
            { name: 'Finished', code: 'FIN', category: 'DONE', is_initial: true },
            { name: 'Closed', code: 'CLS', category: 'CANCELLED', is_initial: false }
          ],
          transitions: [{ from_status_code: 'FIN', to_status_code: 'CLS' }]
        })
        .expect(400);

      await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/workflows`)
        .set('Cookie', fix.adminCookie)
        .send({
          ...validPayload,
          name: 'Invalid Init CANCELLED WF',
          code: 'INVALID_INIT_CANCELLED',
          statuses: [
            { name: 'Canceled', code: 'CNC', category: 'CANCELLED', is_initial: true },
            { name: 'Completed', code: 'CMP', category: 'DONE', is_initial: false }
          ],
          transitions: [{ from_status_code: 'CNC', to_status_code: 'CMP' }]
        })
        .expect(400);

      const { sql: client } = createDatabase(databaseUrl);
      const wfRows = await client`SELECT COUNT(*)::int as count FROM workflows WHERE code IN ('INVALID_INIT_DONE', 'INVALID_INIT_CANCELLED')`;
      expect(wfRows[0].count).toBe(0);
      const statusRows = await client`SELECT COUNT(*)::int as count FROM task_statuses WHERE code IN ('FIN', 'CLS', 'CNC', 'CMP')`;
      expect(statusRows[0].count).toBe(0);
      await client.end();
    });

    it('rejects self-loop transition with 422 SELF_LOOP_NOT_ALLOWED', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/workflows`)
        .set('Cookie', fix.adminCookie)
        .send({
          ...validPayload,
          name: 'Self Loop WF',
          code: 'SELF_LOOP_WF',
          transitions: [{ from_status_code: 'BACKLOG', to_status_code: 'BACKLOG' }]
        })
        .expect(422);

      expect(res.body.error.code).toBe('SELF_LOOP_NOT_ALLOWED');
    });

    it('proves atomic transaction rollback on failure leaving zero partial rows', async () => {
      const invalidPayload = {
        name: 'Rollback WF',
        code: 'ROLLBACK_WF',
        statuses: [
          { name: 'Open', code: 'OPEN', category: 'TODO', is_initial: true },
          { name: 'Done', code: 'DONE', category: 'DONE', is_initial: false }
        ],
        transitions: [{ from_status_code: 'OPEN', to_status_code: 'NON_EXISTENT' }]
      };

      await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${fix.workspaceId}/workflows`)
        .set('Cookie', fix.adminCookie)
        .send(invalidPayload)
        .expect(400);

      const { sql: client } = createDatabase(databaseUrl);
      const wfRows = await client`SELECT COUNT(*)::int as count FROM workflows WHERE code = 'ROLLBACK_WF'`;
      expect(wfRows[0].count).toBe(0);
      const statusRows = await client`SELECT COUNT(*)::int as count FROM task_statuses WHERE code IN ('OPEN')`;
      expect(statusRows[0].count).toBe(0);
      await client.end();
    });
  });

  describe('PATCH /api/v1/workspaces/:workspaceId/workflows/:workflowId', () => {
    it('forbids MEMBER role from patching workflows', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.defaultWorkflowId}`)
        .set('Cookie', fix.memberCookie)
        .send({ name: 'Member Patch', version: 1 })
        .expect(403);
    });

    it('rejects attempt to edit immutable code or default fields', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.defaultWorkflowId}`)
        .set('Cookie', fix.adminCookie)
        .send({ code: 'MUTATED_CODE', version: 1 })
        .expect(400);
    });

    it('rejects patch with stale version with 409 VERSION_CONFLICT', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.defaultWorkflowId}`)
        .set('Cookie', fix.adminCookie)
        .send({ name: 'Stale Patch', version: 999 })
        .expect(409);

      expect(res.body.error.code).toBe('VERSION_CONFLICT');
    });

    it('allows ADMIN to update name and description, incrementing version to 2', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.defaultWorkflowId}`)
        .set('Cookie', fix.adminCookie)
        .send({ name: 'Updated Default Workflow', description: 'New description', version: 1 })
        .expect(200);

      expect(res.body.data.name).toBe('Updated Default Workflow');
      expect(res.body.data.description).toBe('New description');
      expect(res.body.data.version).toBe(2);
    });
  });

  describe('ADMIN-only Authorization & Cross-Workspace Visibility on All Mutation Families', () => {
    const validPayload = {
      name: 'Custom Workflow',
      code: 'custom_wf',
      description: 'Test creation',
      statuses: [
        { name: 'Backlog', code: 'BACKLOG', category: 'TODO', is_initial: true },
        { name: 'Completed', code: 'FINISHED', category: 'DONE', is_initial: false }
      ],
      transitions: [{ from_status_code: 'BACKLOG', to_status_code: 'FINISHED' }]
    };

    it('proves non-ADMIN receives 403 and outsider receives 404 for all mutation endpoints', async () => {
      const mutations = [
        // Workflow mutations
        { method: 'post', path: `/api/v1/workspaces/${fix.workspaceId}/workflows`, body: validPayload },
        { method: 'patch', path: `/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.defaultWorkflowId}`, body: { name: 'Patch Wf', version: 2 } },
        { method: 'post', path: `/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.defaultWorkflowId}/set-default`, body: { version: 2 } },
        { method: 'post', path: `/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.defaultWorkflowId}/archive`, body: { version: 2 } },
        { method: 'post', path: `/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.defaultWorkflowId}/restore`, body: { version: 2 } },

        // Status & Transition mutations
        { method: 'post', path: `/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.defaultWorkflowId}/statuses`, body: { name: 'S_New', code: 'S_NEW', category: 'TODO', version: 2 } },
        { method: 'patch', path: `/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.defaultWorkflowId}/statuses/${randomUUID()}`, body: { name: 'S_Patch', version: 2 } },
        { method: 'post', path: `/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.defaultWorkflowId}/statuses/${randomUUID()}/set-initial`, body: { version: 2 } },
        { method: 'post', path: `/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.defaultWorkflowId}/statuses/${randomUUID()}/archive`, body: { version: 2 } },
        { method: 'post', path: `/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.defaultWorkflowId}/statuses/${randomUUID()}/restore`, body: { version: 2 } },
        { method: 'put', path: `/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.defaultWorkflowId}/statuses/reorder`, body: { status_ids: [], version: 2 } },
        { method: 'put', path: `/api/v1/workspaces/${fix.workspaceId}/workflows/${fix.defaultWorkflowId}/transitions`, body: { transitions: [], version: 2 } }
      ];

      for (const m of mutations) {
        // Non-ADMIN member -> 403 FORBIDDEN
        const reqMember = request(app.getHttpServer());
        const callerMember = (reqMember as unknown as Record<string, (url: string) => request.Test>)[m.method];
        const resMember = await callerMember.call(reqMember, m.path)
          .set('Cookie', fix.memberCookie)
          .send(m.body);
        expect(resMember.status).toBe(403);
        expect(resMember.body.error.code).toBe('FORBIDDEN');

        // Outsider -> 404 NOT_FOUND
        const reqOutsider = request(app.getHttpServer());
        const callerOutsider = (reqOutsider as unknown as Record<string, (url: string) => request.Test>)[m.method];
        const resOutsider = await callerOutsider.call(reqOutsider, m.path)
          .set('Cookie', fix.outsiderCookie)
          .send(m.body);
        expect(resOutsider.status).toBe(404);
        expect(resOutsider.body.error.code).toBe('NOT_FOUND');
      }
    });
  });
});
