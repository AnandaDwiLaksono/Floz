import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuthService } from './auth';
import { FlozService } from './floz.service';
import { createEmailAdapter } from './email-adapter';
import type { TransactionSql } from 'postgres';

export interface WorkspaceInvitationRow {
  id: string;
  workspaceId: string;
  email: string;
  roleId: string;
  roleCode?: string;
  status: string;
  invitedBy: string;
  expiresAt: Date;
  acceptedAt?: Date | null;
  createdAt: Date;
}

@Injectable()
export class InvitationService {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(FlozService) private readonly floz: FlozService
  ) {}

  private get sql() { return this.authService.database.sql; }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async listInvitations(workspaceId: string): Promise<WorkspaceInvitationRow[]> {
    return await this.sql<WorkspaceInvitationRow[]>`
      SELECT i.id, i.workspace_id AS "workspaceId", i.email, i.role_id AS "roleId", r.code AS "roleCode",
             i.status, i.invited_by AS "invitedBy", i.expires_at AS "expiresAt", i.accepted_at AS "acceptedAt", i.created_at AS "createdAt"
      FROM workspace_invitations i
      INNER JOIN roles r ON r.id = i.role_id
      WHERE i.workspace_id = ${workspaceId}
      ORDER BY i.created_at DESC
    `;
  }

  async listPendingForEmail(email: string): Promise<{ id: string; workspaceName: string; role: string; expiresAt: Date }[]> {
    return await this.sql<{ id: string; workspaceName: string; role: string; expiresAt: Date }[]>`
      SELECT i.id, w.name AS "workspaceName", r.code AS role, i.expires_at AS "expiresAt"
      FROM workspace_invitations i
      INNER JOIN workspaces w ON w.id = i.workspace_id
      INNER JOIN roles r ON r.id = i.role_id
      WHERE lower(i.email) = lower(${email}) AND i.status = 'PENDING' AND i.expires_at > NOW() AND w.is_active = true
      ORDER BY i.created_at DESC
    `;
  }

  async createInvitation(workspaceId: string, inviterUserId: string, email: string, roleCode: string) {
    return await this.sql.begin(async (sql: TransactionSql) => {
      const normalizedEmail = email.toLowerCase().trim();
      const role = (await sql<{ id: string }[]>`SELECT id FROM roles WHERE code = ${roleCode} LIMIT 1`)[0];
      if (!role) throw new BadRequestException('VALIDATION_ERROR');

      // Check if already active member
      const existingUser = (await sql<{ id: string }[]>`SELECT id FROM users WHERE lower(email) = ${normalizedEmail} LIMIT 1`)[0];
      if (existingUser) {
        const membership = (await sql`SELECT 1 FROM workspace_memberships WHERE workspace_id = ${workspaceId} AND user_id = ${existingUser.id} AND status = 'ACTIVE' LIMIT 1`)[0];
        if (membership) throw new ConflictException('ALREADY_MEMBER');
      }

      // Check existing pending invitation
      const existingPending = (await sql<{ id: string }[]>`SELECT id FROM workspace_invitations WHERE workspace_id = ${workspaceId} AND email = ${normalizedEmail} AND status = 'PENDING' LIMIT 1`)[0];
      if (existingPending) throw new ConflictException('INVITATION_PENDING_EXISTS');

      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = this.hashToken(rawToken);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      const inv = (await sql<WorkspaceInvitationRow[]>`
        INSERT INTO workspace_invitations (workspace_id, email, role_id, token_hash, status, invited_by, expires_at)
        VALUES (${workspaceId}, ${normalizedEmail}, ${role.id}, ${tokenHash}, 'PENDING', ${inviterUserId}, ${expiresAt})
        RETURNING id, workspace_id AS "workspaceId", email, role_id AS "roleId", status, invited_by AS "invitedBy", expires_at AS "expiresAt", created_at AS "createdAt"
      `)[0];

      const ws = (await sql<{ name: string }[]>`SELECT name FROM workspaces WHERE id = ${workspaceId}`)[0];
      const inviteUrl = `${process.env.APP_URL || 'http://localhost:3000'}/invitations/accept?token=${rawToken}`;

      const emailAdapter = createEmailAdapter();
      await emailAdapter.sendEmail({
        to: normalizedEmail,
        subject: `You have been invited to join ${ws?.name || 'a workspace'} on Floz`,
        html: `<p>You have been invited to join <strong>${ws?.name}</strong> as ${roleCode}.</p><p><a href="${inviteUrl}">Accept Invitation</a></p>`,
        text: `You have been invited to join ${ws?.name} on Floz as ${roleCode}. Accept here: ${inviteUrl}`
      });

      return { invitation: inv, token: rawToken };
    });
  }

  async resendInvitation(workspaceId: string, invitationId: string) {
    return await this.sql.begin(async (sql: TransactionSql) => {
      const inv = (await sql<{ id: string; email: string; roleId: string; status: string }[]>`SELECT id, email, role_id AS "roleId", status FROM workspace_invitations WHERE id = ${invitationId} AND workspace_id = ${workspaceId} FOR UPDATE`)[0];
      if (!inv) throw new NotFoundException('INVITATION_NOT_FOUND');
      if (inv.status !== 'PENDING') throw new BadRequestException('INVITATION_NOT_PENDING');

      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = this.hashToken(rawToken);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await sql`UPDATE workspace_invitations SET token_hash = ${tokenHash}, expires_at = ${expiresAt}, updated_at = NOW() WHERE id = ${invitationId}`;
      const ws = (await sql<{ name: string }[]>`SELECT name FROM workspaces WHERE id = ${workspaceId}`)[0];
      const inviteUrl = `${process.env.APP_URL || 'http://localhost:3000'}/invitations/accept?token=${rawToken}`;

      const emailAdapter = createEmailAdapter();
      await emailAdapter.sendEmail({
        to: inv.email,
        subject: `Reminder: You have been invited to join ${ws?.name || 'a workspace'} on Floz`,
        html: `<p>Reminder: Click the link below to accept your invitation to <strong>${ws?.name}</strong>:</p><p><a href="${inviteUrl}">Accept Invitation</a></p>`,
        text: `Accept invitation to ${ws?.name}: ${inviteUrl}`
      });

      return { success: true };
    });
  }

  async revokeInvitation(workspaceId: string, invitationId: string) {
    return await this.sql.begin(async (sql: TransactionSql) => {
      const inv = (await sql<{ id: string }[]>`SELECT id FROM workspace_invitations WHERE id = ${invitationId} AND workspace_id = ${workspaceId} AND status = 'PENDING' FOR UPDATE`)[0];
      if (!inv) throw new NotFoundException('INVITATION_NOT_FOUND');
      await sql`UPDATE workspace_invitations SET status = 'REVOKED', revoked_at = NOW(), updated_at = NOW() WHERE id = ${invitationId}`;
      return { success: true };
    });
  }

  async previewInvitation(rawToken: string) {
    const tokenHash = this.hashToken(rawToken);
    const inv = (await this.sql<{ id: string; email: string; status: string; expiresAt: Date; workspaceName: string; roleCode: string }[]>`
      SELECT i.id, i.email, i.status, i.expires_at AS "expiresAt", w.name AS "workspaceName", r.code AS "roleCode"
      FROM workspace_invitations i
      INNER JOIN workspaces w ON w.id = i.workspace_id
      INNER JOIN roles r ON r.id = i.role_id
      WHERE i.token_hash = ${tokenHash}
      LIMIT 1
    `)[0];

    if (!inv) throw new NotFoundException('INVITATION_NOT_FOUND');
    if (inv.status === 'REVOKED') throw new BadRequestException('INVITATION_REVOKED');
    if (inv.status === 'ACCEPTED') throw new BadRequestException('INVITATION_ALREADY_USED');
    if (new Date(inv.expiresAt) < new Date()) throw new BadRequestException('INVITATION_EXPIRED');

    return {
      workspace_name: inv.workspaceName,
      invited_email: inv.email,
      role: inv.roleCode,
      expires_at: inv.expiresAt
    };
  }

  async acceptInvitation(rawToken: string, currentUserId: string) {
    return await this.sql.begin(async (sql: TransactionSql) => {
      const user = (await sql<{ id: string; email: string; emailVerified: boolean }[]>`SELECT id, email, email_verified AS "emailVerified" FROM users WHERE id = ${currentUserId}`)[0];
      if (!user) throw new NotFoundException('USER_NOT_FOUND');
      if (!user.emailVerified) throw new ForbiddenException('EMAIL_VERIFICATION_REQUIRED');

      const tokenHash = this.hashToken(rawToken);
      const inv = (await sql<{ id: string; workspaceId: string; email: string; roleId: string; status: string; expiresAt: Date }[]>`
        SELECT id, workspace_id AS "workspaceId", email, role_id AS "roleId", status, expires_at AS "expiresAt"
        FROM workspace_invitations
        WHERE token_hash = ${tokenHash}
        FOR UPDATE
      `)[0];

      if (!inv) throw new NotFoundException('INVITATION_NOT_FOUND');
      if (inv.status === 'REVOKED') throw new BadRequestException('INVITATION_REVOKED');
      if (inv.status === 'ACCEPTED') throw new BadRequestException('INVITATION_ALREADY_USED');
      if (new Date(inv.expiresAt) < new Date()) throw new BadRequestException('INVITATION_EXPIRED');
      if (inv.email.toLowerCase() !== user.email.toLowerCase()) throw new ForbiddenException('INVITATION_EMAIL_MISMATCH');

      // Add or update workspace membership
      await sql`
        INSERT INTO workspace_memberships (workspace_id, user_id, role_id, status)
        VALUES (${inv.workspaceId}, ${user.id}, ${inv.roleId}, 'ACTIVE')
        ON CONFLICT (workspace_id, user_id)
        DO UPDATE SET role_id = ${inv.roleId}, status = 'ACTIVE', updated_at = NOW()
      `;

      await sql`
        UPDATE workspace_invitations
        SET status = 'ACCEPTED', accepted_by = ${user.id}, accepted_at = NOW(), updated_at = NOW()
        WHERE id = ${inv.id}
      `;

      return { workspace_id: inv.workspaceId, status: 'ACCEPTED' };
    });
  }

  async declineInvitation(rawToken: string, currentUserId: string) {
    const tokenHash = this.hashToken(rawToken);
    const inv = (await this.sql<{ id: string }[]>`SELECT id FROM workspace_invitations WHERE token_hash = ${tokenHash} AND status = 'PENDING' LIMIT 1`)[0];
    if (!inv) throw new NotFoundException('INVITATION_NOT_FOUND');
    await this.sql`UPDATE workspace_invitations SET status = 'DECLINED', declined_at = NOW(), updated_at = NOW() WHERE id = ${inv.id}`;
    return { success: true };
  }
}
