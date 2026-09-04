import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth';
import { createDatabase } from '@floz/database';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/floz';
process.env.DATABASE_URL = databaseUrl;
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? 'test-secret-at-least-32-characters-long';

async function createApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  await app.init();
  return app;
}

async function resetDatabase() { const { sql: client } = createDatabase(databaseUrl); await client`TRUNCATE team_memberships, teams, workspace_memberships, workspaces, roles, sessions, accounts, users, verifications RESTART IDENTITY CASCADE`; await client.end(); }

describe('Auth persistence', () => {
  let app: INestApplication | undefined;

  beforeEach(async () => { await resetDatabase(); app = await createApp(); const auth = app.get(AuthService).auth; const admin = await auth.api.signUpEmail({ body: { email: 'admin@example.com', password: 'password123', name: 'Admin' } }); const { sql } = createDatabase(databaseUrl); const role = await sql`INSERT INTO roles (code, name) VALUES ('ADMIN', 'Admin') ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`; await sql`INSERT INTO workspaces (name, slug, created_by) VALUES ('Floz', 'floz', ${String(admin.user.id)})`; await sql`INSERT INTO workspace_memberships (workspace_id, user_id, role_id) SELECT w.id, ${String(admin.user.id)}, ${String(role[0].id)} FROM workspaces w WHERE w.slug = 'floz'`; await sql.end(); });
  afterEach(async () => { await app?.close(); app = undefined; await resetDatabase(); });

  it('signUpEmail creates no session when autoSignIn is disabled and login still creates one', async () => {
    const auth = app!.get(AuthService).auth;
    const signup = await auth.api.signUpEmail({ body: { email: 'worker@example.com', password: 'password123', name: 'Worker' } });
    expect(signup.token).toBeNull();
    const { sql } = createDatabase(databaseUrl);
    const createdUserId = String(signup.user.id);
    const before = await sql`SELECT COUNT(*)::int AS count FROM sessions WHERE user_id = ${createdUserId}`;
    expect(before[0].count).toBe(0);
    const login = await request(app!.getHttpServer()).post('/api/v1/auth/login').send({ email: 'worker@example.com', password: 'password123' }).expect(200);
    expect(login.headers['set-cookie'][0]).toContain('floz_session=');
    const after = await sql`SELECT COUNT(*)::int AS count FROM sessions WHERE user_id = ${createdUserId}`;
    expect(after[0].count).toBe(1);
    await sql.end();
  });

  it('keeps the current session and revokes other sessions after password change', async () => {
    const auth = app!.get(AuthService).auth;
    await auth.api.signUpEmail({ body: { email: 'member@example.com', password: 'password123', name: 'Member' } });
    const first = await request(app!.getHttpServer()).post('/api/v1/auth/login').send({ email: 'member@example.com', password: 'password123' }).expect(200);
    const second = await request(app!.getHttpServer()).post('/api/v1/auth/login').send({ email: 'member@example.com', password: 'password123' }).expect(200);
    const keepCookie = first.headers['set-cookie'][0].split(';')[0];
    const revokeCookie = second.headers['set-cookie'][0].split(';')[0];
    await request(app!.getHttpServer()).patch('/api/v1/me/password').set('Cookie', keepCookie).send({ current_password: 'wrong-password', new_password: 'new-password-123' }).expect(401);
    await request(app!.getHttpServer()).patch('/api/v1/me/password').set('Cookie', keepCookie).send({ current_password: 'password123', new_password: 'new-password-123' }).expect(204);
    await request(app!.getHttpServer()).get('/api/v1/me').set('Cookie', keepCookie).expect(200);
    await request(app!.getHttpServer()).get('/api/v1/me').set('Cookie', revokeCookie).expect(401);
    await request(app!.getHttpServer()).post('/api/v1/auth/login').send({ email: 'member@example.com', password: 'password123' }).expect(401);
    await request(app!.getHttpServer()).post('/api/v1/auth/login').send({ email: 'member@example.com', password: 'new-password-123' }).expect(200);
  });

  it('rejects public signup HTTP routes', async () => {
    await request(app!.getHttpServer()).post('/api/v1/auth/sign-up/email').send({ email: 'x@example.com', password: 'password123', name: 'X' }).expect(404);
  });

  it('persists login session across application instances', async () => {
    const res = await request(app!.getHttpServer()).post('/api/v1/auth/login').send({ email: 'admin@example.com', password: 'password123' }).expect(200);
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('floz_session=');
    await app!.close();
    app = await createApp();
    await request(app!.getHttpServer()).get('/api/v1/me').set('Cookie', cookie.split(';')[0]).expect(200).expect(({ body }) => {
      expect(body.data.email).toBe('admin@example.com');
      expect(body.data.workspaces).toHaveLength(1);
    });
  });

  it('invalidates persisted session on logout', async () => {
    const res = await request(app!.getHttpServer()).post('/api/v1/auth/login').send({ email: 'admin@example.com', password: 'password123' }).expect(200);
    const cookie = res.headers['set-cookie'][0].split(';')[0];
    await request(app!.getHttpServer()).post('/api/v1/auth/logout').set('Cookie', cookie).expect(204);
    await request(app!.getHttpServer()).get('/api/v1/me').set('Cookie', cookie).expect(401);
  });
});
