import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuthService } from './auth';
import type { TransactionSql } from 'postgres';

export interface JoinSettingsDto {
  join_policy: 'INVITE_ONLY' | 'JOIN_CODE' | 'APPROVAL_REQUIRED';
}

@Injectable()
export class JoinCodeService {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  private get sql() { return this.authService.database.sql; }

  private hashCode(code: string): string {
    return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
  }

  private generateHumanCode(): string {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    const segment = (len: number) => {
      let res = '';
      const bytes = randomBytes(len);
      for (let i = 0; i < len; i++) res += chars[bytes[i] % chars.length];
      return res;
    };
    return `FLOZ-${segment(4)}-${segment(4)}-${segment(4)}`;
  }

  async getJoinSettings(workspaceId: string) {
    const ws = (await this.sql<{ id: string; joinPolicy: string }[]>`SELECT id, join_policy AS "joinPolicy" FROM workspaces WHERE id = ${workspaceId}`)[0];
    if (!ws) throw new NotFoundException('WORKSPACE_NOT_FOUND');

    const activeCode = (await this.sql<{ id: string; expiresAt: Date; createdAt: Date }[]>`
      SELECT id, expires_at AS "expiresAt", created_at AS "createdAt"
      FROM workspace_join_codes
      WHERE workspace_id = ${workspaceId} AND is_active = true
      LIMIT 1
    `)[0];

    return {
      join_policy: ws.joinPolicy,
      has_active_code: Boolean(activeCode),
      code_expires_at: activeCode?.expiresAt ?? null
    };
  }

  async updateJoinSettings(workspaceId: string, policy: string) {
    const valid = ['INVITE_ONLY', 'JOIN_CODE', 'APPROVAL_REQUIRED'];
    if (!valid.includes(policy)) throw new BadRequestException('VALIDATION_ERROR');

    await this.sql`UPDATE workspaces SET join_policy = ${policy}, updated_at = NOW() WHERE id = ${workspaceId}`;
    return { join_policy: policy };
  }

  async generateOrRotateCode(workspaceId: string, userId: string) {
    return await this.sql.begin(async (sql: TransactionSql) => {
      // Revoke old codes
      await sql`UPDATE workspace_join_codes SET is_active = false, revoked_at = NOW() WHERE workspace_id = ${workspaceId} AND is_active = true`;

      const rawCode = this.generateHumanCode();
      const codeHash = this.hashCode(rawCode);
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      await sql`
        INSERT INTO workspace_join_codes (workspace_id, code_hash, created_by, expires_at, is_active)
        VALUES (${workspaceId}, ${codeHash}, ${userId}, ${expiresAt}, true)
      `;

      return {
        join_code: rawCode,
        expires_at: expiresAt
      };
    });
  }

  async revokeCode(workspaceId: string) {
    await this.sql`UPDATE workspace_join_codes SET is_active = false, revoked_at = NOW() WHERE workspace_id = ${workspaceId} AND is_active = true`;
    return { success: true };
  }

  async previewByCode(code: string) {
    const codeHash = this.hashCode(code);
    const codeRow = (await this.sql<{ workspaceId: string; expiresAt: Date; is_active: boolean; wsName: string; joinPolicy: string }[]>`
      SELECT c.workspace_id AS "workspaceId", c.expires_at AS "expiresAt", c.is_active, w.name AS "wsName", w.join_policy AS "joinPolicy"
      FROM workspace_join_codes c
      INNER JOIN workspaces w ON w.id = c.workspace_id
      WHERE c.code_hash = ${codeHash} AND c.is_active = true AND w.is_active = true
      LIMIT 1
    `)[0];

    if (!codeRow || (codeRow.expiresAt && new Date(codeRow.expiresAt) < new Date())) {
      throw new NotFoundException('JOIN_CODE_INVALID');
    }
    if (codeRow.joinPolicy !== 'JOIN_CODE') {
      throw new BadRequestException('JOIN_CODE_DISABLED');
    }

    return {
      workspace_id: codeRow.workspaceId,
      workspace_name: codeRow.wsName,
      action: 'JOIN'
    };
  }

  async joinByCode(code: string, userId: string) {
    return await this.sql.begin(async (sql: TransactionSql) => {
      const user = (await sql<{ emailVerified: boolean }[]>`SELECT email_verified AS "emailVerified" FROM users WHERE id = ${userId}`)[0];
      if (!user?.emailVerified) throw new ForbiddenException('EMAIL_VERIFICATION_REQUIRED');

      const codeHash = this.hashCode(code);
      const codeRow = (await sql<{ workspaceId: string; expiresAt: Date; joinPolicy: string }[]>`
        SELECT c.workspace_id AS "workspaceId", c.expires_at AS "expiresAt", w.join_policy AS "joinPolicy"
        FROM workspace_join_codes c
        INNER JOIN workspaces w ON w.id = c.workspace_id
        WHERE c.code_hash = ${codeHash} AND c.is_active = true AND w.is_active = true
        FOR UPDATE
      `)[0];

      if (!codeRow || (codeRow.expiresAt && new Date(codeRow.expiresAt) < new Date())) {
        throw new NotFoundException('JOIN_CODE_INVALID');
      }
      if (codeRow.joinPolicy !== 'JOIN_CODE') {
        throw new BadRequestException('JOIN_CODE_DISABLED');
      }

      const memberRoleId = (await sql<{ id: string }[]>`SELECT id FROM roles WHERE code = 'MEMBER' LIMIT 1`)[0]?.id;
      if (!memberRoleId) throw new BadRequestException('MEMBER role not found');

      await sql`
        INSERT INTO workspace_memberships (workspace_id, user_id, role_id, status)
        VALUES (${codeRow.workspaceId}, ${userId}, ${memberRoleId}, 'ACTIVE')
        ON CONFLICT (workspace_id, user_id)
        DO UPDATE SET role_id = ${memberRoleId}, status = 'ACTIVE', updated_at = NOW()
      `;

      return {
        workspace_id: codeRow.workspaceId,
        role: 'MEMBER',
        status: 'ACTIVE'
      };
    });
  }
}
