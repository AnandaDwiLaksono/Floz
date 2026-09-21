import { test, expect, type APIRequestContext } from '@playwright/test';
import { createDatabase, accounts, sessions, users, verifications } from '@floz/database';
import type { Sql } from 'postgres';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { randomUUID } from 'node:crypto';

const databaseUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/floz';
const apiUrl = 'http://127.0.0.1:3001/api/v1';

const auth = betterAuth({
  database: drizzleAdapter(createDatabase(databaseUrl).db as never, {
    provider: 'pg',
    schema: { user: users, account: accounts, session: sessions, verification: verifications }
  }),
  secret: 'test-secret-at-least-32-characters-long',
  baseURL: 'http://127.0.0.1:3001',
  emailAndPassword: { enabled: true },
  advanced: { database: { generateId: 'uuid' } }
});

async function createVerifiedUser(request: APIRequestContext, sql: Sql, email: string, name: string) {
  const normEmail = email.toLowerCase().trim();
  const password = 'Password123!';
  const res = await auth.api.signUpEmail({
    body: { email: normEmail, password, name }
  });
  const userId = res.user.id;
  await sql`UPDATE users SET email_verified = true WHERE id = ${userId}`;

  const loginRes = await request.post(`${apiUrl}/auth/login`, {
    data: { email: normEmail, password },
    headers: { Origin: 'http://localhost:3005' }
  });
  expect(loginRes.status()).toBe(200);
  const cookie = loginRes.headers()['set-cookie'];

  return { id: userId, email: normEmail, cookie };
}

test.describe('Phase 13 Real-Stack Playwright Scenarios A–G', () => {
  let sql: Sql;

  test.beforeAll(async () => {
    const db = createDatabase(databaseUrl);
    sql = db.sql;
  });

  test.afterAll(async () => {
    if (sql) await sql.end();
  });

  test('Scenario A: Register -> Verify -> Login -> Create Workspace', async ({ request }) => {
    const email = `user_a_${randomUUID().slice(0, 8)}@example.com`.toLowerCase();
    const password = 'Password123!';
    const fullName = 'User Alpha';

    // 1. Register
    const regRes = await request.post(`${apiUrl}/auth/register`, {
      data: { email, password, full_name: fullName },
      headers: { Origin: 'http://localhost:3005' }
    });
    expect([201, 202]).toContain(regRes.status());

    // 2. Extract verification token from DB
    const verif = (await sql<{ value: string }[]>`SELECT value FROM verifications WHERE lower(identifier) = ${email} ORDER BY expires_at DESC LIMIT 1`)[0];
    expect(verif).toBeDefined();

    // 3. Verify Email
    const verifyRes = await request.post(`${apiUrl}/auth/verify-email`, {
      data: { token: verif.value, email },
      headers: { Origin: 'http://localhost:3005' }
    });
    expect(verifyRes.status()).toBe(200);

    // 4. Verify user is email_verified in DB
    const userRow = (await sql<{ email_verified: boolean; id: string }[]>`SELECT email_verified, id FROM users WHERE lower(email) = ${email}`)[0];
    expect(userRow.email_verified).toBe(true);

    // 5. Login
    const loginRes = await request.post(`${apiUrl}/auth/login`, {
      data: { email, password },
      headers: { Origin: 'http://localhost:3005' }
    });
    expect(loginRes.status()).toBe(200);
    const cookieHeader = loginRes.headers()['set-cookie'];

    // 6. Create Workspace
    const createWsRes = await request.post(`${apiUrl}/workspaces`, {
      data: { name: 'Alpha Workspace' },
      headers: { Origin: 'http://localhost:3005', Cookie: cookieHeader }
    });
    expect(createWsRes.status()).toBe(201);
    const wsData = await createWsRes.json();
    const workspaceId = wsData.data.id;
    expect(workspaceId).toBeDefined();

    // 7. Verify creator is ADMIN and default workflow exists
    const membership = (await sql<{ code: string }[]>`
      SELECT r.code FROM workspace_memberships wm
      JOIN roles r ON r.id = wm.role_id
      WHERE wm.workspace_id = ${workspaceId} AND wm.user_id = ${userRow.id}
    `)[0];
    expect(membership.code).toBe('ADMIN');

    const defaultWorkflow = (await sql<{ count: number }[]>`SELECT COUNT(*)::int as count FROM workflows WHERE workspace_id = ${workspaceId}`)[0];
    expect(defaultWorkflow.count).toBeGreaterThan(0);
  });

  test('Scenario B: Create second workspace -> switch -> isolation', async ({ request }) => {
    const userB = await createVerifiedUser(request, sql, `user_b_${randomUUID().slice(0, 8)}@example.com`, 'User Beta');

    const ws1Res = await request.post(`${apiUrl}/workspaces`, {
      data: { name: 'Beta WS 1' },
      headers: { Origin: 'http://localhost:3005', Cookie: userB.cookie }
    });
    expect(ws1Res.status()).toBe(201);

    const ws2Res = await request.post(`${apiUrl}/workspaces`, {
      data: { name: 'Beta WS 2' },
      headers: { Origin: 'http://localhost:3005', Cookie: userB.cookie }
    });
    expect(ws2Res.status()).toBe(201);

    const ws1Id = (await ws1Res.json()).data.id;
    const ws2Id = (await ws2Res.json()).data.id;

    const meRes = await request.get(`${apiUrl}/me`, { headers: { Cookie: userB.cookie } });
    expect(meRes.status()).toBe(200);
    const meData = await meRes.json();
    const wsIds = meData.data.workspaces.map((w: { id: string }) => w.id);
    expect(wsIds).toContain(ws1Id);
    expect(wsIds).toContain(ws2Id);
  });

  test('Scenario C: Existing-user invitation', async ({ request }) => {
    const admin = await createVerifiedUser(request, sql, `admin_c_${randomUUID().slice(0, 8)}@example.com`, 'Admin C');
    const target = await createVerifiedUser(request, sql, `target_c_${randomUUID().slice(0, 8)}@example.com`, 'Target C');

    const wsRes = await request.post(`${apiUrl}/workspaces`, {
      data: { name: 'WS C' },
      headers: { Origin: 'http://localhost:3005', Cookie: admin.cookie }
    });
    expect(wsRes.status()).toBe(201);
    const wsId = (await wsRes.json()).data.id;

    const invRes = await request.post(`${apiUrl}/workspaces/${wsId}/invitations`, {
      data: { email: target.email, role: 'MEMBER' },
      headers: { Origin: 'http://localhost:3005', Cookie: admin.cookie }
    });
    expect(invRes.status()).toBe(201);
    const rawToken = (await invRes.json()).data.token;

    const acceptRes = await request.post(`${apiUrl}/workspace-invitations/accept`, {
      data: { token: rawToken },
      headers: { Origin: 'http://localhost:3005', Cookie: target.cookie }
    });
    expect([200, 201]).toContain(acceptRes.status());

    const mem = (await sql<{ status: string }[]>`SELECT status FROM workspace_memberships WHERE workspace_id = ${wsId} AND user_id = ${target.id}`)[0];
    expect(mem.status).toBe('ACTIVE');
  });

  test('Scenario D: New-user invitation -> register -> verify -> accept', async ({ request }) => {
    const admin = await createVerifiedUser(request, sql, `admin_d_${randomUUID().slice(0, 8)}@example.com`, 'Admin D');
    const newEmail = `newuser_d_${randomUUID().slice(0, 8)}@example.com`.toLowerCase();

    const wsRes = await request.post(`${apiUrl}/workspaces`, {
      data: { name: 'WS D' },
      headers: { Origin: 'http://localhost:3005', Cookie: admin.cookie }
    });
    expect(wsRes.status()).toBe(201);
    const wsId = (await wsRes.json()).data.id;

    const invRes = await request.post(`${apiUrl}/workspaces/${wsId}/invitations`, {
      data: { email: newEmail, role: 'MEMBER' },
      headers: { Origin: 'http://localhost:3005', Cookie: admin.cookie }
    });
    expect(invRes.status()).toBe(201);
    const rawToken = (await invRes.json()).data.token;

    const newUser = await createVerifiedUser(request, sql, newEmail, 'New D');

    const acceptRes = await request.post(`${apiUrl}/workspace-invitations/accept`, {
      data: { token: rawToken },
      headers: { Origin: 'http://localhost:3005', Cookie: newUser.cookie }
    });
    expect([200, 201]).toContain(acceptRes.status());
  });

  test('Scenario E: Join Code -> MEMBER -> rotate -> old code invalid', async ({ request }) => {
    const admin = await createVerifiedUser(request, sql, `admin_e_${randomUUID().slice(0, 8)}@example.com`, 'Admin E');
    const joiner = await createVerifiedUser(request, sql, `joiner_e_${randomUUID().slice(0, 8)}@example.com`, 'Joiner E');

    const wsRes = await request.post(`${apiUrl}/workspaces`, {
      data: { name: 'WS E' },
      headers: { Origin: 'http://localhost:3005', Cookie: admin.cookie }
    });
    expect(wsRes.status()).toBe(201);
    const wsId = (await wsRes.json()).data.id;

    // Set policy to JOIN_CODE
    const patchRes = await request.patch(`${apiUrl}/workspaces/${wsId}/join-settings`, {
      data: { join_policy: 'JOIN_CODE' },
      headers: { Origin: 'http://localhost:3005', Cookie: admin.cookie }
    });
    expect(patchRes.status()).toBe(200);

    // 1. Generate code (route: POST /workspaces/:wid/join-code)
    const codeRes1 = await request.post(`${apiUrl}/workspaces/${wsId}/join-code`, {
      headers: { Origin: 'http://localhost:3005', Cookie: admin.cookie }
    });
    expect([200, 201]).toContain(codeRes1.status());
    const code1 = (await codeRes1.json()).data.join_code;

    // 2. Rotate code
    const codeRes2 = await request.post(`${apiUrl}/workspaces/${wsId}/join-code`, {
      headers: { Origin: 'http://localhost:3005', Cookie: admin.cookie }
    });
    expect([200, 201]).toContain(codeRes2.status());
    const code2 = (await codeRes2.json()).data.join_code;
    expect(code2).not.toBe(code1);

    // 3. Attempt join with old code1 (must fail)
    const failJoin = await request.post(`${apiUrl}/workspace-joins`, {
      data: { join_code: code1 },
      headers: { Origin: 'http://localhost:3005', Cookie: joiner.cookie }
    });
    expect(failJoin.status()).toBeGreaterThanOrEqual(400);

    // 4. Join with new code2 (must succeed as MEMBER)
    const okJoin = await request.post(`${apiUrl}/workspace-joins`, {
      data: { join_code: code2 },
      headers: { Origin: 'http://localhost:3005', Cookie: joiner.cookie }
    });
    expect([200, 201]).toContain(okJoin.status());

    const roleCode = (await sql<{ code: string }[]>`
      SELECT r.code FROM workspace_memberships wm
      JOIN roles r ON r.id = wm.role_id
      WHERE wm.workspace_id = ${wsId} AND wm.user_id = ${joiner.id}
    `)[0].code;
    expect(roleCode).toBe('MEMBER');
  });

  test('Scenario F: Workspace ID -> approval request -> Admin approve', async ({ request }) => {
    const admin = await createVerifiedUser(request, sql, `admin_f_${randomUUID().slice(0, 8)}@example.com`, 'Admin F');
    const requester = await createVerifiedUser(request, sql, `req_f_${randomUUID().slice(0, 8)}@example.com`, 'Requester F');

    const wsRes = await request.post(`${apiUrl}/workspaces`, {
      data: { name: 'WS F' },
      headers: { Origin: 'http://localhost:3005', Cookie: admin.cookie }
    });
    expect(wsRes.status()).toBe(201);
    const wsId = (await wsRes.json()).data.id;

    // Set policy to APPROVAL_REQUIRED
    const patchRes = await request.patch(`${apiUrl}/workspaces/${wsId}/join-settings`, {
      data: { join_policy: 'APPROVAL_REQUIRED' },
      headers: { Origin: 'http://localhost:3005', Cookie: admin.cookie }
    });
    expect(patchRes.status()).toBe(200);

    const reqRes = await request.post(`${apiUrl}/workspace-joins`, {
      data: { workspace_id: wsId },
      headers: { Origin: 'http://localhost:3005', Cookie: requester.cookie }
    });
    expect(reqRes.status()).toBe(201);
    const reqId = (await reqRes.json()).data.id;

    const appRes = await request.post(`${apiUrl}/workspaces/${wsId}/join-requests/${reqId}/approve`, {
      headers: { Origin: 'http://localhost:3005', Cookie: admin.cookie }
    });
    expect([200, 201]).toContain(appRes.status());

    const status = (await sql<{ status: string }[]>`SELECT status FROM workspace_memberships WHERE workspace_id = ${wsId} AND user_id = ${requester.id}`)[0].status;
    expect(status).toBe('ACTIVE');
  });

  test('Scenario G: Provision Account fallback', async ({ request }) => {
    const admin = await createVerifiedUser(request, sql, `admin_g_${randomUUID().slice(0, 8)}@example.com`, 'Admin G');
    const provEmail = `prov_g_${randomUUID().slice(0, 8)}@example.com`.toLowerCase();

    const wsRes = await request.post(`${apiUrl}/workspaces`, {
      data: { name: 'WS G' },
      headers: { Origin: 'http://localhost:3005', Cookie: admin.cookie }
    });
    expect(wsRes.status()).toBe(201);
    const wsId = (await wsRes.json()).data.id;

    const provRes = await request.post(`${apiUrl}/workspaces/${wsId}/accounts`, {
      data: { email: provEmail, full_name: 'Provisioned User' },
      headers: { Origin: 'http://localhost:3005', Cookie: admin.cookie }
    });
    expect(provRes.status()).toBe(201);

    const provUser = (await sql<{ email_verified: boolean }[]>`SELECT email_verified FROM users WHERE lower(email) = ${provEmail}`)[0];
    expect(provUser.email_verified).toBe(false);
  });
});
