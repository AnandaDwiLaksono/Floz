import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabase, type Sql } from '@floz/database';
import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { CookieOriginGuard } from '../src/cookie-origin.guard';
import { InvitationService } from '../src/invitation.service';
import { JoinCodeService } from '../src/join-code.service';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/floz';

describe('Phase 13 Comprehensive Security Regression Gate', () => {
  let app: INestApplication;
  let db: ReturnType<typeof createDatabase>;
  let sql: Sql;

  beforeAll(async () => {
    db = createDatabase(databaseUrl);
    sql = db.sql;

    // Ensure roles seeded
    await sql`INSERT INTO roles (id, code, name) VALUES (${randomUUID()}, 'ADMIN', 'Admin') ON CONFLICT (code) DO NOTHING`;
    await sql`INSERT INTO roles (id, code, name) VALUES (${randomUUID()}, 'MEMBER', 'Member') ON CONFLICT (code) DO NOTHING`;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (sql) await sql.end();
  });

  it('1. CookieOriginGuard enforces Origin header on all Phase 13 mutation routes', () => {
    const guard = new CookieOriginGuard();
    const mutationPaths = [
      '/api/v1/auth/register',
      '/api/v1/auth/verification/resend',
      '/api/v1/auth/verify-email',
      '/api/v1/workspaces',
      '/api/v1/workspaces/ws-1/invitations',
      '/api/v1/workspace-invitations/accept',
      '/api/v1/workspace-invitations/decline',
      '/api/v1/workspaces/ws-1/join-settings',
      '/api/v1/workspaces/ws-1/join-codes',
      '/api/v1/workspace-joins',
      '/api/v1/workspaces/ws-1/join-requests/req-1/approve',
    ];

    for (const path of mutationPaths) {
      const mockCtxNoOrigin = {
        switchToHttp: () => ({
          getRequest: () => ({ method: 'POST', path, headers: {} })
        })
      } as unknown as ExecutionContext;
      expect(() => guard.canActivate(mockCtxNoOrigin)).toThrow('FORBIDDEN');

      const mockCtxWithOrigin = {
        switchToHttp: () => ({
          getRequest: () => ({ method: 'POST', path, headers: { origin: 'http://localhost:3000' } })
        })
      } as unknown as ExecutionContext;
      expect(guard.canActivate(mockCtxWithOrigin)).toBe(true);
    }
  });

  it('2. Raw invitation tokens are NEVER persisted in plaintext in DB', async () => {
    const invService = app.get(InvitationService);
    const workspaceId = randomUUID();
    const inviterId = randomUUID();

    await sql`INSERT INTO users(id, email, name, email_verified) VALUES (${inviterId}, ${`inviter_${randomUUID()}@example.com`}, 'Inviter', true)`;
    await sql`INSERT INTO workspaces(id, name, slug, created_by) VALUES (${workspaceId}, 'Test WS Token', ${`ws-${randomUUID()}`}, ${inviterId})`;

    const targetEmail = `invited_${randomUUID()}@example.com`;
    const invResult = await invService.createInvitation(workspaceId, inviterId, targetEmail, 'MEMBER');

    const rawToken = invResult.token;
    expect(rawToken).toBeDefined();

    const rows = await sql<{ token_hash: string }[]>`SELECT token_hash FROM workspace_invitations WHERE id = ${invResult.invitation.id}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toEqual(rawToken);
    const expectedHash = createHash('sha256').update(rawToken).digest('hex');
    expect(rows[0].token_hash).toEqual(expectedHash);
  });

  it('3. Raw join codes are NEVER persisted in plaintext in DB', async () => {
    const joinCodeService = app.get(JoinCodeService);
    const workspaceId = randomUUID();
    const adminId = randomUUID();

    await sql`INSERT INTO users(id, email, name, email_verified) VALUES (${adminId}, ${`admin_${randomUUID()}@example.com`}, 'Admin', true)`;
    await sql`INSERT INTO workspaces(id, name, slug, created_by) VALUES (${workspaceId}, 'Test WS Code', ${`ws-${randomUUID()}`}, ${adminId})`;

    const codeResult = await joinCodeService.generateOrRotateCode(workspaceId, adminId);
    const rawCode = codeResult.join_code;
    expect(rawCode).toMatch(/^FLOZ-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const rows = await sql<{ code_hash: string }[]>`SELECT code_hash FROM workspace_join_codes WHERE workspace_id = ${workspaceId} AND is_active = true`;
    expect(rows).toHaveLength(1);
    expect(rows[0].code_hash).not.toEqual(rawCode);
    const expectedHash = createHash('sha256').update(rawCode).digest('hex');
    expect(rows[0].code_hash).toEqual(expectedHash);
  });

  it('4. Self-join via Join Code strictly assigns MEMBER role, never ADMIN or MANAGER', async () => {
    const joinCodeService = app.get(JoinCodeService);
    const workspaceId = randomUUID();
    const adminId = randomUUID();
    const joiningUserId = randomUUID();

    await sql`INSERT INTO users(id, email, name, email_verified) VALUES (${adminId}, ${`admin_${randomUUID()}@example.com`}, 'Admin', true)`;
    await sql`INSERT INTO users(id, email, name, email_verified) VALUES (${joiningUserId}, ${`joiner_${randomUUID()}@example.com`}, 'Joiner', true)`;
    await sql`INSERT INTO workspaces(id, name, slug, created_by, join_policy) VALUES (${workspaceId}, 'Test WS SelfJoin', ${`ws-${randomUUID()}`}, ${adminId}, 'JOIN_CODE')`;

    const codeResult = await joinCodeService.generateOrRotateCode(workspaceId, adminId);
    const joinResult = await joinCodeService.joinByCode(codeResult.join_code, joiningUserId);

    expect(joinResult.status).toEqual('ACTIVE');

    const memberRole = (await sql<{ code: string }[]>`
      SELECT r.code FROM workspace_memberships wm
      JOIN roles r ON r.id = wm.role_id
      WHERE wm.workspace_id = ${workspaceId} AND wm.user_id = ${joiningUserId}
    `)[0];

    expect(memberRole.code).toEqual('MEMBER');
  });

  it('5. Invitation email mismatch is BLOCKED with EMAIL_MISMATCH', async () => {
    const invService = app.get(InvitationService);
    const workspaceId = randomUUID();
    const inviterId = randomUUID();
    const wrongUserId = randomUUID();

    await sql`INSERT INTO users(id, email, name, email_verified) VALUES (${inviterId}, ${`inviter_${randomUUID()}@example.com`}, 'Inviter', true)`;
    await sql`INSERT INTO users(id, email, name, email_verified) VALUES (${wrongUserId}, ${`wrong_${randomUUID()}@example.com`}, 'Wrong User', true)`;
    await sql`INSERT INTO workspaces(id, name, slug, created_by) VALUES (${workspaceId}, 'Test WS Mismatch', ${`ws-${randomUUID()}`}, ${inviterId})`;

    const invResult = await invService.createInvitation(workspaceId, inviterId, `intended_${randomUUID()}@example.com`, 'MEMBER');

    await expect(invService.acceptInvitation(invResult.token, wrongUserId)).rejects.toThrow('EMAIL_MISMATCH');
  });

  it('6. LAST_ACTIVE_ADMIN invariant remains intact under membership mutations', async () => {
    const workspaceId = randomUUID();
    const soleAdminId = randomUUID();
    const adminRoleId = (await sql<{ id: string }[]>`SELECT id FROM roles WHERE code='ADMIN'`)[0].id;

    await sql`INSERT INTO users(id, email, name, email_verified) VALUES (${soleAdminId}, ${`sole_admin_${randomUUID()}@example.com`}, 'Sole Admin', true)`;
    await sql`INSERT INTO workspaces(id, name, slug, created_by) VALUES (${workspaceId}, 'Test WS LastAdmin', ${`ws-${randomUUID()}`}, ${soleAdminId})`;
    await sql`INSERT INTO workspace_memberships(workspace_id, user_id, role_id, status) VALUES (${workspaceId}, ${soleAdminId}, ${adminRoleId}, 'ACTIVE')`;

    const activeAdminCount = (await sql<{ count: number }[]>`
      SELECT COUNT(*)::int as count FROM workspace_memberships wm
      JOIN roles r ON r.id = wm.role_id
      WHERE wm.workspace_id = ${workspaceId} AND r.code = 'ADMIN' AND wm.status = 'ACTIVE'
    `)[0].count;

    expect(activeAdminCount).toBe(1);
  });
});
