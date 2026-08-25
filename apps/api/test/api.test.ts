import 'reflect-metadata';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { createDatabase } from '@floz/database';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/floz';
process.env.DATABASE_URL = databaseUrl;
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? 'test-secret-at-least-32-characters-long';

type Fixture = { adminCookie: string; memberCookie: string; adminId: string; memberId: string; outsiderId: string; workspaceId: string; otherWorkspaceId: string };

async function createApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
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

  return { adminCookie: await login(app, 'admin@example.com'), memberCookie: await login(app, 'member@example.com'), adminId, memberId, outsiderId, workspaceId, otherWorkspaceId };
}

describe('API', () => {
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
});
