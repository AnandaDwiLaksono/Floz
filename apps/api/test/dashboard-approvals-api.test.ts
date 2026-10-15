import 'reflect-metadata';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from './test-request.js';
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

  it('excludes former team approvers consistently from managed and team-filtered approval counts', async () => {
    const { sql: client } = createDatabase(databaseUrl);
    await client`UPDATE team_memberships SET left_at = NOW() WHERE team_id = ${team1Id} AND user_id = ${memberId}`;
    await client.end();
    const base = `/api/v1/workspaces/${workspaceId}`;
    const dashboard = 'dashboard/manager?from=2026-09-01T00:00:00.000Z&to=2026-09-30T23:59:59.999Z';
    const manager = await request(app.getHttpServer()).get(`${base}/${dashboard}`).set('Cookie', managerCookie).expect(200);
    const managed = await request(app.getHttpServer()).get(`${base}/approval-requests?view=managed&status=PENDING`).set('Cookie', managerCookie).expect(200);
    expect(manager.body.data.pending_approvals).toBe(1);
    expect(managed.body.data).toHaveLength(manager.body.data.pending_approvals);
    const managedFiltered = await request(app.getHttpServer()).get(`${base}/approval-requests?view=managed&status=PENDING&team_id=${team1Id}`).set('Cookie', managerCookie).expect(200);
    const managerFiltered = await request(app.getHttpServer()).get(`${base}/${dashboard}&team_id=${team1Id}`).set('Cookie', managerCookie).expect(200);
    expect(managedFiltered.body.data).toHaveLength(managerFiltered.body.data.pending_approvals);
    const adminFiltered = await request(app.getHttpServer()).get(`${base}/${dashboard}&team_id=${team1Id}`).set('Cookie', adminCookie).expect(200);
    const allFiltered = await request(app.getHttpServer()).get(`${base}/approval-requests?view=all&status=PENDING&team_id=${team1Id}`).set('Cookie', adminCookie).expect(200);
    expect(adminFiltered.body.data.pending_approvals).toBe(0);
    expect(allFiltered.body.data).toHaveLength(adminFiltered.body.data.pending_approvals);
    const { sql: otherTeamClient } = createDatabase(databaseUrl);
    const otherTeamId = (await otherTeamClient<{ id: string }[]>`INSERT INTO teams (workspace_id, name, manager_user_id) VALUES (${workspaceId}, 'Other Managed Team', ${managerId}) RETURNING id`)[0].id;
    await otherTeamClient`INSERT INTO team_memberships (team_id, user_id) VALUES (${otherTeamId}, ${memberId})`;
    await otherTeamClient.end();
    const managedAcrossTeams = await request(app.getHttpServer()).get(`${base}/approval-requests?view=managed&status=PENDING`).set('Cookie', managerCookie).expect(200);
    const managerAcrossTeams = await request(app.getHttpServer()).get(`${base}/${dashboard}`).set('Cookie', managerCookie).expect(200);
    expect(managerAcrossTeams.body.data.pending_approvals).toBe(2);
    expect(managedAcrossTeams.body.data).toHaveLength(managerAcrossTeams.body.data.pending_approvals);
    const formerlyManagedTeam = await request(app.getHttpServer()).get(`${base}/${dashboard}&team_id=${team1Id}`).set('Cookie', managerCookie).expect(200);
    expect(formerlyManagedTeam.body.data.pending_approvals).toBe(1);
  });

  it('intersects KPI team and assignee filters without widening manager access', async () => {
    const { sql: client } = createDatabase(databaseUrl);
    const team2Id = randomUUID(), task1 = randomUUID(), task2 = randomUUID();
    const workflow = (await client<{ id: string }[]>`SELECT id FROM workflows WHERE workspace_id=${workspaceId} LIMIT 1`)[0].id;
    const status = (await client<{ id: string }[]>`SELECT id FROM task_statuses WHERE workflow_id=${workflow} AND is_terminal=false LIMIT 1`)[0].id;
    await client`INSERT INTO teams(id,workspace_id,name,manager_user_id) VALUES(${team2Id},${workspaceId},'Other Team',${managerId})`;
    await client`INSERT INTO tasks(id,workspace_id,task_key,title,workflow_id,status_id,creator_id,team_id,due_at) VALUES
      (${task1},${workspaceId},'DASH-TEAM-A','Team A',${workflow},${status},${adminId},${team1Id},'2026-09-09T00:00:00Z'),
      (${task2},${workspaceId},'DASH-TEAM-B','Team B',${workflow},${status},${adminId},${team2Id},'2026-09-09T00:00:00Z')`;
    await client`INSERT INTO task_assignees(task_id,user_id,assigned_by) VALUES(${task1},${memberId},${adminId}),(${task2},${memberId},${adminId})`;
    await client.end();
    const query = `from=2026-09-01T00:00:00.000Z&to=2026-09-30T00:00:00.000Z&team_id=${team1Id}&assignee_id=${memberId}`;
    const admin = await request(app.getHttpServer()).get(`/api/v1/workspaces/${workspaceId}/reports/kpis?${query}`).set('Cookie', adminCookie).expect(200);
    expect(admin.body.data.denominators.due).toBe(1);
    expect(admin.body.data.workload).toBe(1);
    await request(app.getHttpServer()).get(`/api/v1/workspaces/${workspaceId}/reports/kpis?${query}`).set('Cookie', managerCookie).expect(403);
    await request(app.getHttpServer()).get(`/api/v1/workspaces/${workspaceId}/reports/kpis?${query}`).set('Cookie', memberCookie).expect(200);
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
