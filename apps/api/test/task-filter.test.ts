import 'reflect-metadata';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ErrorFilter } from '../src/error.filter';
import cookieParser from 'cookie-parser';
import { createDatabase } from '@floz/database';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth';
import { ReportingClock } from '../src/reporting-clock';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/floz';
process.env.DATABASE_URL = databaseUrl;
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? 'test-secret-at-least-32-characters-long';

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

async function resetDatabase() {
  const { sql } = createDatabase(databaseUrl);
  await sql`TRUNCATE team_memberships, teams, workspace_memberships, workspaces, roles, sessions, accounts, users, verifications RESTART IDENTITY CASCADE`;
  await sql.end();
}

async function login(app: INestApplication, email: string) {
  const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'password123' }).expect(200);
  return res.headers['set-cookie'][0].split(';')[0];
}

async function setup(app: INestApplication) {
  const auth = app.get(AuthService).auth;
  const admin = await auth.api.signUpEmail({ body: { email: 'admin@task4.com', password: 'password123', name: 'Admin' } });
  const adminId = String(admin.user.id);
  const { sql } = createDatabase(databaseUrl);
  const roles = await sql`INSERT INTO roles(code,name) VALUES('ADMIN','Admin'),('MEMBER','Member') ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name RETURNING id,code`;
  const adminRole = String(roles.find((r) => r.code === 'ADMIN')!.id);
  const ws = await sql`INSERT INTO workspaces(name,slug,created_by) VALUES('T4','t4',${adminId}) RETURNING id`;
  const workspaceId = String(ws[0].id);
  await sql`INSERT INTO workspace_memberships(workspace_id,user_id,role_id,status) VALUES(${workspaceId},${adminId},${adminRole},'ACTIVE')`;
  const workflow = await sql<{ id: string; status_id: string; code: string }[]>`SELECT w.id, s.id AS status_id, s.code FROM workflows w JOIN task_statuses s ON s.workflow_id=w.id WHERE w.workspace_id=${workspaceId}`;
  await sql.end();
  const workflowId = String(workflow[0].id);
  const statusId = (code: string) => String(workflow.find((r) => r.code === code)!.status_id);
  const todoId = statusId('TODO');
  const doneId = statusId('DONE');
  const cancelledStatus = workflow.find((r) => r.code === 'CANCELLED');
  const cancelledId = cancelledStatus ? String(cancelledStatus.status_id) : null;
  const cookie = await login(app, 'admin@task4.com');
  return { adminId, workspaceId, workflowId, todoId, doneId, cancelledId, cookie };
}

describe('Task 4 — overdue filter and schedule validation', () => {
  let app: INestApplication;

  beforeAll(async () => { await resetDatabase(); });
  beforeEach(async () => { app = await createApp(); });
  afterEach(async () => { await app?.close(); await resetDatabase(); });

  describe('schedule validation: start_at <= due_at', () => {
    it('rejects task creation when start_at > due_at', async () => {
      const { workspaceId, cookie } = await setup(app);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceId}/tasks`)
        .set('Cookie', cookie)
        .send({ title: 'Bad schedule', start_at: '2030-01-10T00:00:00Z', due_at: '2030-01-01T00:00:00Z' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('accepts task creation when start_at === due_at (equality is valid)', async () => {
      const { workspaceId, cookie } = await setup(app);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceId}/tasks`)
        .set('Cookie', cookie)
        .send({ title: 'Equal schedule', start_at: '2030-01-10T00:00:00Z', due_at: '2030-01-10T00:00:00Z' });
      expect(res.status).toBe(201);
    });

    it('accepts task creation when start_at < due_at', async () => {
      const { workspaceId, cookie } = await setup(app);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceId}/tasks`)
        .set('Cookie', cookie)
        .send({ title: 'Valid schedule', start_at: '2030-01-01T00:00:00Z', due_at: '2030-01-10T00:00:00Z' });
      expect(res.status).toBe(201);
    });

    it('rejects task update when start_at > due_at', async () => {
      const { workspaceId, cookie } = await setup(app);
      const createRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceId}/tasks`)
        .set('Cookie', cookie)
        .send({ title: 'Task to update' })
        .expect(201);
      const taskId = createRes.body.data.id;
      const version = createRes.body.data.version;
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceId}/tasks/${taskId}`)
        .set('Cookie', cookie)
        .send({ version, start_at: '2030-01-10T00:00:00Z', due_at: '2030-01-01T00:00:00Z' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('overdue=true filter', () => {
    it('rejects overdue=false as invalid', async () => {
      const { workspaceId, cookie } = await setup(app);
      const res = await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${workspaceId}/tasks?overdue=false`)
        .set('Cookie', cookie);
      expect(res.status).toBe(400);
    });

    it('returns overdue active tasks with deterministic test clock', async () => {
      const { workspaceId, cookie } = await setup(app);

      const fixedNow = '2030-06-01T12:00:00Z';
      const previousNow = process.env.FLOZ_TEST_REPORTING_NOW;
      process.env.FLOZ_TEST_REPORTING_NOW = fixedNow;

      try {
        const overdueRes = await request(app.getHttpServer())
          .post(`/api/v1/workspaces/${workspaceId}/tasks`)
          .set('Cookie', cookie)
          .send({ title: 'Overdue task', due_at: '2030-01-01T00:00:00Z' })
          .expect(201);
        const overdueId = overdueRes.body.data.id;

        const futureRes = await request(app.getHttpServer())
          .post(`/api/v1/workspaces/${workspaceId}/tasks`)
          .set('Cookie', cookie)
          .send({ title: 'Future task', due_at: '2030-12-31T00:00:00Z' })
          .expect(201);

        const res = await request(app.getHttpServer())
          .get(`/api/v1/workspaces/${workspaceId}/tasks?overdue=true`)
          .set('Cookie', cookie)
          .expect(200);

        const ids = res.body.data.map((t: { id: string }) => t.id);
        expect(ids).toContain(overdueId);
        expect(ids).not.toContain(futureRes.body.data.id);
      } finally {
        if (previousNow === undefined) delete process.env.FLOZ_TEST_REPORTING_NOW;
        else process.env.FLOZ_TEST_REPORTING_NOW = previousNow;
      }
    });

    it('equality (due_at === evaluationAt) is NOT overdue', async () => {
      const { workspaceId, cookie } = await setup(app);
      const fixedNow = '2030-06-01T12:00:00.000Z';
      const previousNow = process.env.FLOZ_TEST_REPORTING_NOW;
      process.env.FLOZ_TEST_REPORTING_NOW = fixedNow;

      try {
        const res1 = await request(app.getHttpServer())
          .post(`/api/v1/workspaces/${workspaceId}/tasks`)
          .set('Cookie', cookie)
          .send({ title: 'Equal task', due_at: fixedNow })
          .expect(201);
        const equalId = res1.body.data.id;

        const list = await request(app.getHttpServer())
          .get(`/api/v1/workspaces/${workspaceId}/tasks?overdue=true`)
          .set('Cookie', cookie)
          .expect(200);

        const ids = list.body.data.map((t: { id: string }) => t.id);
        expect(ids).not.toContain(equalId);
      } finally {
        if (previousNow === undefined) delete process.env.FLOZ_TEST_REPORTING_NOW;
        else process.env.FLOZ_TEST_REPORTING_NOW = previousNow;
      }
    });

    it('CANCELLED task is NOT overdue even if past due', async () => {
      const { workspaceId, cookie, workflowId } = await setup(app);

      const fixedNow = '2030-06-01T12:00:00Z';
      const previousNow = process.env.FLOZ_TEST_REPORTING_NOW;
      process.env.FLOZ_TEST_REPORTING_NOW = fixedNow;

      try {
        const { sql } = createDatabase(databaseUrl);
        const cancelledStatus = await sql<{ id: string }[]>`SELECT s.id FROM task_statuses s JOIN workflows w ON w.id=s.workflow_id WHERE w.id=${workflowId} AND s.category='CANCELLED' LIMIT 1`;
        await sql.end();

        if (!cancelledStatus[0]) return;
        const cancelledStatusId = cancelledStatus[0].id;

        const taskRes = await request(app.getHttpServer())
          .post(`/api/v1/workspaces/${workspaceId}/tasks`)
          .set('Cookie', cookie)
          .send({ title: 'Cancelled past due', due_at: '2030-01-01T00:00:00Z', status_id: cancelledStatusId })
          .expect(201);
        const taskId = taskRes.body.data.id;

        const list = await request(app.getHttpServer())
          .get(`/api/v1/workspaces/${workspaceId}/tasks?overdue=true`)
          .set('Cookie', cookie)
          .expect(200);

        const ids = list.body.data.map((t: { id: string }) => t.id);
        expect(ids).not.toContain(taskId);
      } finally {
        if (previousNow === undefined) delete process.env.FLOZ_TEST_REPORTING_NOW;
        else process.env.FLOZ_TEST_REPORTING_NOW = previousNow;
      }
    });

    it('terminal non-DONE (DONE) task is NOT overdue', async () => {
      const { workspaceId, cookie, workflowId } = await setup(app);

      const fixedNow = '2030-06-01T12:00:00Z';
      const previousNow = process.env.FLOZ_TEST_REPORTING_NOW;
      process.env.FLOZ_TEST_REPORTING_NOW = fixedNow;

      try {
        const { sql } = createDatabase(databaseUrl);
        const doneStatus = await sql<{ id: string }[]>`SELECT s.id FROM task_statuses s JOIN workflows w ON w.id=s.workflow_id WHERE w.id=${workflowId} AND s.is_terminal=true LIMIT 1`;
        await sql.end();
        if (!doneStatus[0]) return;
        const doneId = doneStatus[0].id;

        const taskRes = await request(app.getHttpServer())
          .post(`/api/v1/workspaces/${workspaceId}/tasks`)
          .set('Cookie', cookie)
          .send({ title: 'Done task past due', due_at: '2030-01-01T00:00:00Z', status_id: doneId })
          .expect(201);
        const taskId = taskRes.body.data.id;

        const list = await request(app.getHttpServer())
          .get(`/api/v1/workspaces/${workspaceId}/tasks?overdue=true`)
          .set('Cookie', cookie)
          .expect(200);

        const ids = list.body.data.map((t: { id: string }) => t.id);
        expect(ids).not.toContain(taskId);
      } finally {
        if (previousNow === undefined) delete process.env.FLOZ_TEST_REPORTING_NOW;
        else process.env.FLOZ_TEST_REPORTING_NOW = previousNow;
      }
    });

    it('clock is resolved exactly once per request (same evaluationAt for all rows)', async () => {
      const { workspaceId, cookie } = await setup(app);
      const fixedNow = '2030-06-01T12:00:00Z';
      const clock = app.get(ReportingClock);
      let callCount = 0;
      const original = clock.now.bind(clock);
      clock.now = () => { callCount++; return original(); };

      const previousNow = process.env.FLOZ_TEST_REPORTING_NOW;
      process.env.FLOZ_TEST_REPORTING_NOW = fixedNow;

      try {
        await request(app.getHttpServer())
          .get(`/api/v1/workspaces/${workspaceId}/tasks?overdue=true`)
          .set('Cookie', cookie)
          .expect(200);
        expect(callCount).toBe(1);
      } finally {
        if (previousNow === undefined) delete process.env.FLOZ_TEST_REPORTING_NOW;
        else process.env.FLOZ_TEST_REPORTING_NOW = previousNow;
      }
    });
  });
});
