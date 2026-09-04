import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { createDatabase } from '@floz/database';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/floz';
process.env.DATABASE_URL = databaseUrl;
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? 'test-secret-at-least-32-characters-long';

async function createApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

async function login(app: INestApplication, email: string) {
  const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'password123' }).expect(200);
  return res.headers['set-cookie'][0].split(';')[0];
}

describe('workspace membership concurrency', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const { sql } = createDatabase(databaseUrl);
    await sql`TRUNCATE team_memberships, teams, workspace_memberships, workspaces, roles, sessions, accounts, users, verifications RESTART IDENTITY CASCADE`;
    await sql.end();
    app = await createApp();
  });

  afterEach(async () => {
    await app.close();
    const { sql } = createDatabase(databaseUrl);
    await sql`TRUNCATE team_memberships, teams, workspace_memberships, workspaces, roles, sessions, accounts, users, verifications RESTART IDENTITY CASCADE`;
    await sql.end();
  });

  it('serializes simultaneous admin demotions so one ACTIVE ADMIN remains', async () => {
    const auth = app.get(AuthService).auth;
    const first = await auth.api.signUpEmail({ body: { email: 'first@example.com', password: 'password123', name: 'First' } });
    const second = await auth.api.signUpEmail({ body: { email: 'second@example.com', password: 'password123', name: 'Second' } });
    const { sql } = createDatabase(databaseUrl);
    const roles = await sql`INSERT INTO roles(code,name) VALUES('ADMIN','Admin'),('MEMBER','Member') RETURNING id,code`;
    const adminRole = roles.find((role) => role.code === 'ADMIN')!.id;
    const workspace = await sql`INSERT INTO workspaces(name,slug,created_by) VALUES('Concurrent','concurrent',${first.user.id}) RETURNING id`;
    const workspaceId = String(workspace[0].id);
    await sql`INSERT INTO workspace_memberships(workspace_id,user_id,role_id,status) VALUES(${workspaceId},${first.user.id},${adminRole},'ACTIVE'),(${workspaceId},${second.user.id},${adminRole},'ACTIVE')`;
    await sql.end();
    const firstCookie = await login(app, 'first@example.com');
    const secondCookie = await login(app, 'second@example.com');
    const results = await Promise.all([
      request(app.getHttpServer()).patch(`/api/v1/workspaces/${workspaceId}/members/${first.user.id}`).set('Cookie', firstCookie).send({ role: 'MEMBER' }),
      request(app.getHttpServer()).patch(`/api/v1/workspaces/${workspaceId}/members/${second.user.id}`).set('Cookie', secondCookie).send({ role: 'MEMBER' })
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const { sql: verify } = createDatabase(databaseUrl);
    const activeAdmins = await verify`SELECT COUNT(*)::int AS count FROM workspace_memberships wm JOIN roles r ON r.id=wm.role_id WHERE wm.workspace_id=${workspaceId} AND wm.status='ACTIVE' AND r.code='ADMIN'`;
    expect(activeAdmins[0].count).toBe(1);
    await verify.end();
  });
});
