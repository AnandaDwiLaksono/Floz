import 'reflect-metadata';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

type Fixture = { adminCookie: string; memberCookie: string; outsiderCookie: string; adminId: string; memberId: string; outsiderId: string; workspaceId: string; otherWorkspaceId: string };

async function createApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

async function resetDatabase() {
  const { sql: client } = createDatabase(databaseUrl);
  await client`TRUNCATE notifications, workspace_memberships, workspaces, roles, sessions, accounts, users, verifications RESTART IDENTITY CASCADE`;
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
  
  await db2.end();

  return { 
    adminCookie: await login(app, 'admin@example.com'), 
    memberCookie: await login(app, 'member@example.com'), 
    outsiderCookie: await login(app, 'outsider@example.com'), 
    adminId, 
    memberId, 
    outsiderId, 
    workspaceId, 
    otherWorkspaceId 
  };
}

describe('Notification API', () => {
  let app: INestApplication | undefined;

  beforeAll(async () => { await resetDatabase(); });
  beforeEach(async () => { app = await createApp(); });
  afterEach(async () => { await app?.close(); app = undefined; await resetDatabase(); });

  it('handles basic notification lifecycle: list, counts, read, mark all read', async () => {
    const f = await fixture(app!);
    const { sql } = createDatabase(databaseUrl);
    
    // Seed notifications for admin in workspace 1
    const notifs = await sql`
      INSERT INTO notifications (workspace_id, user_id, type, title, body, is_read, created_at, entity_type, entity_id)
      VALUES 
      (${f.workspaceId}, ${f.adminId}, 'TASK_ASSIGNED', 'Assigned 1', 'body 1', false, NOW() - INTERVAL '1 hour', 'TASK', ${f.workspaceId}),
      (${f.workspaceId}, ${f.adminId}, 'TASK_ASSIGNED', 'Assigned 2', 'body 2', false, NOW() - INTERVAL '30 minutes', 'TASK', ${f.workspaceId}),
      (${f.workspaceId}, ${f.adminId}, 'TASK_ASSIGNED', 'Assigned 3', 'body 3', true, NOW() - INTERVAL '15 minutes', 'TASK', ${f.workspaceId}),
      (${f.otherWorkspaceId}, ${f.adminId}, 'TASK_ASSIGNED', 'Other WS', 'body other', false, NOW(), NULL, NULL),
      (${f.workspaceId}, ${f.memberId}, 'TASK_ASSIGNED', 'Member Notif', 'body member', false, NOW(), NULL, NULL)
      RETURNING id, is_read, created_at
    `;
    
    const unreadAdminId1 = notifs[0].id;
    const unreadAdminId2 = notifs[1].id;

    await sql.end();

    // 1. Unread count
    await request(app!.getHttpServer())
      .get(`/api/v1/workspaces/${f.workspaceId}/notifications/unread-count`)
      .set('Cookie', f.adminCookie)
      .expect(200)
      .expect(({ body }) => expect(body.data.count).toBe(2));

    // 2. List notifications (no filters)
    let res = await request(app!.getHttpServer())
      .get(`/api/v1/workspaces/${f.workspaceId}/notifications`)
      .set('Cookie', f.adminCookie)
      .expect(200);
    
    expect(res.body.data.length).toBe(3); // Only from workspace 1, adminId
    expect(res.body.data[0].context.route).toBe(`/workspaces/${f.workspaceId}/tasks?selected_task_id=${f.workspaceId}`);

    // 3. List with read=false filter
    res = await request(app!.getHttpServer())
      .get(`/api/v1/workspaces/${f.workspaceId}/notifications?read=false`)
      .set('Cookie', f.adminCookie)
      .expect(200);
    expect(res.body.data.length).toBe(2);

    // 4. Strict boolean validation
    await request(app!.getHttpServer())
      .get(`/api/v1/workspaces/${f.workspaceId}/notifications?read=abc`)
      .set('Cookie', f.adminCookie)
      .expect(400);

    // 5. Mark read (404 isolation test - trying to read member's notification)
    await request(app!.getHttpServer())
      .patch(`/api/v1/workspaces/${f.workspaceId}/notifications/${notifs[4].id}`)
      .set('Cookie', f.adminCookie)
      .send({ isRead: true })
      .expect(404);

    // 6. Strict validation on patch
    await request(app!.getHttpServer())
      .patch(`/api/v1/workspaces/${f.workspaceId}/notifications/${unreadAdminId1}`)
      .set('Cookie', f.adminCookie)
      .send({ isRead: false })
      .expect(400);

    // 7. Mark single notification read
    await request(app!.getHttpServer())
      .patch(`/api/v1/workspaces/${f.workspaceId}/notifications/${unreadAdminId1}`)
      .set('Cookie', f.adminCookie)
      .send({ isRead: true })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.is_read).toBe(true);
        expect(body.data.read_at).not.toBeNull();
      });

    // Check count decreased
    await request(app!.getHttpServer())
      .get(`/api/v1/workspaces/${f.workspaceId}/notifications/unread-count`)
      .set('Cookie', f.adminCookie)
      .expect(200)
      .expect(({ body }) => expect(body.data.count).toBe(1));

    // Idempotent markRead
    await request(app!.getHttpServer())
      .patch(`/api/v1/workspaces/${f.workspaceId}/notifications/${unreadAdminId1}`)
      .set('Cookie', f.adminCookie)
      .send({ isRead: true })
      .expect(200);

    // 8. Mark all read
    await request(app!.getHttpServer())
      .post(`/api/v1/workspaces/${f.workspaceId}/notifications/mark-all-read`)
      .set('Cookie', f.adminCookie)
      .expect(200)
      .expect(({ body }) => expect(body.data.updated_count).toBe(1)); // Only unreadAdminId2 was left

    // Check count is 0
    await request(app!.getHttpServer())
      .get(`/api/v1/workspaces/${f.workspaceId}/notifications/unread-count`)
      .set('Cookie', f.adminCookie)
      .expect(200)
      .expect(({ body }) => expect(body.data.count).toBe(0));
  }, 60000);
});
