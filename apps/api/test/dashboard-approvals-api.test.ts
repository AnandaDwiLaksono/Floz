import 'reflect-metadata';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ErrorFilter } from '../src/error.filter';
import cookieParser from 'cookie-parser';
import { createDatabase } from '@floz/database';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth';
import { randomUUID } from 'node:crypto';

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

async function login(app: INestApplication, email: string, password = 'password123') {
  const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password }).expect(200);
  return res.headers['set-cookie'][0].split(';')[0];
}

describe('Phase 10 Task 6 — Dashboard pending_approvals API & Drilldown URLs', () => {
  let app: INestApplication;
  let adminCookie: string;
  let managerCookie: string;
  let memberCookie: string;
  let workspaceId: string;
  let team1Id: string;
  let adminId: string;
  let managerId: string;
  let memberId: string;

  beforeAll(async () => {
    app = await createApp();
  });

  beforeEach(async () => {
    const { sql: client } = createDatabase(databaseUrl);
    await client`TRUNCATE approval_steps, approval_requests, task_history, task_assignees, tasks, team_memberships, teams, workspace_memberships, workspaces, roles, sessions, accounts, users RESTART IDENTITY CASCADE`;

    const auth = app.get(AuthService).auth;
    const admin = await auth.api.signUpEmail({ body: { email: 'admin-dash@example.com', password: 'password123', name: 'Admin User' } });
    const manager = await auth.api.signUpEmail({ body: { email: 'manager-dash@example.com', password: 'password123', name: 'Manager User' } });
    const member = await auth.api.signUpEmail({ body: { email: 'member-dash@example.com', password: 'password123', name: 'Member User' } });

    adminId = String(admin.user.id);
    managerId = String(manager.user.id);
    memberId = String(member.user.id);

    await client`INSERT INTO roles (code, name) VALUES ('ADMIN', 'Admin'), ('MANAGER', 'Manager'), ('MEMBER', 'Member') ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`;
    const roles = await client<{ id: string; code: string }[]>`SELECT id, code FROM roles`;
    const adminRole = String(roles.find((r) => r.code === 'ADMIN')!.id);
    const managerRole = String(roles.find((r) => r.code === 'MANAGER')!.id);
    const memberRole = String(roles.find((r) => r.code === 'MEMBER')!.id);

    const ws = await client`INSERT INTO workspaces (name, slug, created_by) VALUES ('Dash WS', 'dash-ws', ${adminId}) RETURNING id`;
    workspaceId = String(ws[0].id);

    await client`INSERT INTO workspace_memberships (workspace_id, user_id, role_id, status) VALUES
      (${workspaceId}, ${adminId}, ${adminRole}, 'ACTIVE'),
      (${workspaceId}, ${managerId}, ${managerRole}, 'ACTIVE'),
      (${workspaceId}, ${memberId}, ${memberRole}, 'ACTIVE')`;

    const t1 = await client`INSERT INTO teams (workspace_id, name, manager_user_id, is_active) VALUES (${workspaceId}, 'Managed Team', ${managerId}, true) RETURNING id`;
    team1Id = String(t1[0].id);

    await client`INSERT INTO team_memberships (team_id, user_id) VALUES (${team1Id}, ${memberId})`;

    // Insert pending approvals: 1 for manager, 1 for member in team1
    const req1 = randomUUID();
    await client`INSERT INTO approval_requests(id, workspace_id, requester_id, status, title) VALUES (${req1}, ${workspaceId}, ${adminId}, 'PENDING', 'Req 1')`;
    await client`INSERT INTO approval_steps(id, approval_request_id, workspace_id, step_order, approver_user_id, status) VALUES (${randomUUID()}, ${req1}, ${workspaceId}, 1, ${managerId}, 'PENDING')`;

    const req2 = randomUUID();
    await client`INSERT INTO approval_requests(id, workspace_id, requester_id, status, title) VALUES (${req2}, ${workspaceId}, ${adminId}, 'PENDING', 'Req 2')`;
    await client`INSERT INTO approval_steps(id, approval_request_id, workspace_id, step_order, approver_user_id, status) VALUES (${randomUUID()}, ${req2}, ${workspaceId}, 1, ${memberId}, 'PENDING')`;

    await client.end();

    adminCookie = await login(app, 'admin-dash@example.com');
    managerCookie = await login(app, 'manager-dash@example.com');
    memberCookie = await login(app, 'member-dash@example.com');
  });

  it('exposes pending_approvals and drilldown_url on Manager Dashboard for MANAGER', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceId}/dashboard/manager?from=2026-09-01T00:00:00.000Z&to=2026-09-30T23:59:59.999Z`)
      .set('Cookie', managerCookie)
      .expect(200);

    expect(res.body.data.pending_approvals).toBe(2);
    expect(res.body.data.drilldown_url).toBe(`/workspaces/${workspaceId}/approvals?view=managed&status=PENDING`);
  });

  it('exposes pending_approvals and drilldown_url on Manager Dashboard for ADMIN', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceId}/dashboard/manager?from=2026-09-01T00:00:00.000Z&to=2026-09-30T23:59:59.999Z`)
      .set('Cookie', adminCookie)
      .expect(200);

    expect(res.body.data.pending_approvals).toBe(2);
    expect(res.body.data.drilldown_url).toBe(`/workspaces/${workspaceId}/approvals?view=all&status=PENDING`);
  });

  it('preserves team_id in drilldown_url when team filter is supplied', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceId}/dashboard/manager?from=2026-09-01T00:00:00.000Z&to=2026-09-30T23:59:59.999Z&team_id=${team1Id}`)
      .set('Cookie', managerCookie)
      .expect(200);

    expect(res.body.data.drilldown_url).toBe(`/workspaces/${workspaceId}/approvals?view=managed&status=PENDING&team_id=${team1Id}`);
  });

  it('leaves Member Dashboard contract unchanged without pending_approvals', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceId}/dashboard/member`)
      .set('Cookie', memberCookie)
      .expect(200);

    expect(res.body.data).not.toHaveProperty('pending_approvals');
    expect(res.body.data).not.toHaveProperty('drilldown_url');
  });
});
