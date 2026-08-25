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
