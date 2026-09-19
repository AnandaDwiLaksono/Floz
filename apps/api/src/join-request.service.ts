import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuthService } from './auth';
import type { TransactionSql } from 'postgres';

export interface JoinRequestRow {
  id: string;
  workspaceId: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  status: string;
  requestedVia: string;
  requestedAt: Date;
  reviewedBy?: string | null;
  reviewedAt?: Date | null;
}

@Injectable()
export class JoinRequestService {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  private get sql() { return this.authService.database.sql; }

  async listWorkspaceRequests(workspaceId: string): Promise<JoinRequestRow[]> {
    return await this.sql<JoinRequestRow[]>`
      SELECT jr.id, jr.workspace_id AS "workspaceId", jr.user_id AS "userId", u.name AS "userName", u.email AS "userEmail",
             jr.status, jr.requested_via AS "requestedVia", jr.requested_at AS "requestedAt", jr.reviewed_by AS "reviewedBy", jr.reviewed_at AS "reviewedAt"
      FROM workspace_join_requests jr
      INNER JOIN users u ON u.id = jr.user_id
      WHERE jr.workspace_id = ${workspaceId} AND jr.status = 'PENDING'
      ORDER BY jr.requested_at DESC
    `;
  }

  async listUserRequests(userId: string): Promise<{ id: string; workspaceId: string; workspaceName: string; status: string; requestedAt: Date }[]> {
    return await this.sql<{ id: string; workspaceId: string; workspaceName: string; status: string; requestedAt: Date }[]>`
      SELECT jr.id, jr.workspace_id AS "workspaceId", w.name AS "workspaceName", jr.status, jr.requested_at AS "requestedAt"
      FROM workspace_join_requests jr
      INNER JOIN workspaces w ON w.id = jr.workspace_id
      WHERE jr.user_id = ${userId}
      ORDER BY jr.requested_at DESC
    `;
  }

  async submitRequest(workspaceId: string, userId: string, requestedVia = 'WORKSPACE_ID') {
    return await this.sql.begin(async (sql: TransactionSql) => {
      const user = (await sql<{ emailVerified: boolean }[]>`SELECT email_verified AS "emailVerified" FROM users WHERE id = ${userId}`)[0];
      if (!user?.emailVerified) throw new ForbiddenException('EMAIL_VERIFICATION_REQUIRED');

      const ws = (await sql<{ id: string; joinPolicy: string; isActive: boolean }[]>`
        SELECT id, join_policy AS "joinPolicy", is_active AS "isActive" FROM workspaces WHERE id = ${workspaceId}
      `)[0];
      if (!ws || !ws.isActive) throw new NotFoundException('WORKSPACE_NOT_FOUND');
      if (ws.joinPolicy !== 'APPROVAL_REQUIRED') throw new BadRequestException('JOIN_REQUEST_NOT_ALLOWED');

      const membership = (await sql`SELECT 1 FROM workspace_memberships WHERE workspace_id = ${workspaceId} AND user_id = ${userId} AND status = 'ACTIVE' LIMIT 1`)[0];
      if (membership) throw new ConflictException('ALREADY_MEMBER');

      const pending = (await sql<{ id: string }[]>`SELECT id FROM workspace_join_requests WHERE workspace_id = ${workspaceId} AND user_id = ${userId} AND status = 'PENDING' LIMIT 1`)[0];
      if (pending) throw new ConflictException('JOIN_REQUEST_PENDING');

      const req = (await sql<JoinRequestRow[]>`
        INSERT INTO workspace_join_requests (workspace_id, user_id, status, requested_via)
        VALUES (${workspaceId}, ${userId}, 'PENDING', ${requestedVia})
        RETURNING id, workspace_id AS "workspaceId", user_id AS "userId", status, requested_via AS "requestedVia", requested_at AS "requestedAt"
      `)[0];

      return req;
    });
  }

  async cancelRequest(requestId: string, userId: string) {
    const req = (await this.sql<{ id: string }[]>`SELECT id FROM workspace_join_requests WHERE id = ${requestId} AND user_id = ${userId} AND status = 'PENDING' LIMIT 1`)[0];
    if (!req) throw new NotFoundException('JOIN_REQUEST_NOT_FOUND');
    await this.sql`UPDATE workspace_join_requests SET status = 'CANCELLED', updated_at = NOW() WHERE id = ${requestId}`;
    return { success: true };
  }

  async approveRequest(workspaceId: string, requestId: string, adminUserId: string) {
    return await this.sql.begin(async (sql: TransactionSql) => {
      const req = (await sql<{ id: string; userId: string; status: string }[]>`
        SELECT id, user_id AS "userId", status FROM workspace_join_requests WHERE id = ${requestId} AND workspace_id = ${workspaceId} FOR UPDATE
      `)[0];
      if (!req) throw new NotFoundException('JOIN_REQUEST_NOT_FOUND');
      if (req.status !== 'PENDING') throw new BadRequestException('JOIN_REQUEST_NOT_PENDING');

      const memberRoleId = (await sql<{ id: string }[]>`SELECT id FROM roles WHERE code = 'MEMBER' LIMIT 1`)[0]?.id;
      if (!memberRoleId) throw new BadRequestException('MEMBER role not found');

      await sql`
        INSERT INTO workspace_memberships (workspace_id, user_id, role_id, status)
        VALUES (${workspaceId}, ${req.userId}, ${memberRoleId}, 'ACTIVE')
        ON CONFLICT (workspace_id, user_id)
        DO UPDATE SET role_id = ${memberRoleId}, status = 'ACTIVE', updated_at = NOW()
      `;

      await sql`
        UPDATE workspace_join_requests
        SET status = 'APPROVED', reviewed_by = ${adminUserId}, reviewed_at = NOW(), updated_at = NOW()
        WHERE id = ${requestId}
      `;

      return { success: true };
    });
  }

  async rejectRequest(workspaceId: string, requestId: string, adminUserId: string) {
    const req = (await this.sql<{ id: string; status: string }[]>`SELECT id, status FROM workspace_join_requests WHERE id = ${requestId} AND workspace_id = ${workspaceId} LIMIT 1`)[0];
    if (!req) throw new NotFoundException('JOIN_REQUEST_NOT_FOUND');
    if (req.status !== 'PENDING') throw new BadRequestException('JOIN_REQUEST_NOT_PENDING');

    await this.sql`
      UPDATE workspace_join_requests
      SET status = 'REJECTED', reviewed_by = ${adminUserId}, reviewed_at = NOW(), updated_at = NOW()
      WHERE id = ${requestId}
    `;
    return { success: true };
  }
}
