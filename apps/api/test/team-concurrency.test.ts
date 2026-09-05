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

describe('team administration concurrency', () => {
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

  it('serializes archive and manager demotion so no active team has an invalid manager', async () => {
    const auth = app.get(AuthService).auth;
    const admin = await auth.api.signUpEmail({ body: { email: 'admin@example.com', password: 'password123', name: 'Admin' } });
    const manager = await auth.api.signUpEmail({ body: { email: 'manager@example.com', password: 'password123', name: 'Manager' } });
    const { sql } = createDatabase(databaseUrl);
    const roles = await sql`INSERT INTO roles(code,name) VALUES('ADMIN','Admin'),('MANAGER','Manager'),('MEMBER','Member') RETURNING id,code`;
    const adminRole = roles.find((role) => role.code === 'ADMIN')!.id;
    const managerRole = roles.find((role) => role.code === 'MANAGER')!.id;
    const workspace = await sql`INSERT INTO workspaces(name,slug,created_by) VALUES('Concurrent teams','concurrent-teams',${admin.user.id}) RETURNING id`;
    const workspaceId = String(workspace[0].id);
    await sql`INSERT INTO workspace_memberships(workspace_id,user_id,role_id,status) VALUES(${workspaceId},${admin.user.id},${adminRole},'ACTIVE'),(${workspaceId},${manager.user.id},${managerRole},'ACTIVE')`;
    const team = await sql`INSERT INTO teams(workspace_id,name,manager_user_id) VALUES(${workspaceId},'Managed',${manager.user.id}) RETURNING id`;
    await sql.end();
    const adminCookie = await login(app, 'admin@example.com');
    const teamId = String(team[0].id);
    const results = await Promise.all([
      request(app.getHttpServer()).patch(`/api/v1/workspaces/${workspaceId}/teams/${teamId}`).set('Cookie', adminCookie).send({ is_active: false }),
      request(app.getHttpServer()).patch(`/api/v1/workspaces/${workspaceId}/members/${manager.user.id}`).set('Cookie', adminCookie).send({ role: 'MEMBER' })
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 200]);
    const { sql: verify } = createDatabase(databaseUrl);
    const invalidActiveTeams = await verify`SELECT COUNT(*)::int AS count FROM teams t LEFT JOIN workspace_memberships wm ON wm.workspace_id=t.workspace_id AND wm.user_id=t.manager_user_id LEFT JOIN roles r ON r.id=wm.role_id WHERE t.workspace_id=${workspaceId} AND t.is_active=true AND t.manager_user_id IS NOT NULL AND (wm.status <> 'ACTIVE' OR r.code NOT IN ('ADMIN','MANAGER') OR wm.user_id IS NULL)`;
    expect(invalidActiveTeams[0].count).toBe(0);
    await verify.end();
  });
});
