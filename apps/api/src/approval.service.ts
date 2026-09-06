import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AuthService } from './auth';
import type { CreateApprovalRequestDto, ApprovalQueryDto } from './approval.dto';
import type { Sql, TransactionSql } from 'postgres';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ApprovalRequestDetailRow = {
  id: string;
  workspace_id: string;
  task_id: string | null;
  requester_id: string;
  requester_name: string;
  cancelled_by_user_id: string | null;
  cancelled_by_name: string | null;
  title: string;
  description: string | null;
  cancel_reason: string | null;
  status: string;
  submitted_at: Date;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  step_id: string;
  step_order: number;
  approver_user_id: string;
  approver_name: string;
  decided_by_user_id: string | null;
  decided_by_name: string | null;
  step_status: string;
  decision: string | null;
  reason: string | null;
  decided_at: Date | null;
  task_title?: string | null;
  task_key?: string | null;
};

@Injectable()
export class ApprovalService {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  private get sql(): Sql {
    return this.authService.database.sql;
  }

  private encodeCursor(item: { submitted_at: Date; id: string }): string {
    const submittedAt = item.submitted_at instanceof Date ? item.submitted_at.toISOString() : new Date(item.submitted_at).toISOString();
    return Buffer.from(JSON.stringify({ submittedAt, id: item.id }), 'utf8').toString('base64');
  }

  private decodeCursor(cursorStr: string): { submittedAt: Date; id: string } | null {
    try {
      const decoded = Buffer.from(cursorStr, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded);
      if (parsed && parsed.submittedAt && parsed.id) {
        const submittedAt = new Date(parsed.submittedAt);
        if (!isNaN(submittedAt.getTime())) {
          return { submittedAt, id: String(parsed.id) };
        }
      }
    } catch {
      // Invalid cursor
    }
    return null;
  }

  private async validateTaskAccess(sqlClient: Sql | TransactionSql, workspaceId: string, taskId: string, userId: string): Promise<boolean> {
    const task = (await sqlClient<{ id: string; team_id: string | null }[]>`SELECT id, team_id FROM tasks WHERE id=${taskId} AND workspace_id=${workspaceId} AND deleted_at IS NULL`)[0];
    if (!task) return false;
    if (task.team_id) {
      const isMember = (await sqlClient<{ user_id: string }[]>`SELECT user_id FROM team_memberships WHERE team_id=${task.team_id} AND user_id=${userId}`)[0];
      const isManager = (await sqlClient<{ id: string }[]>`SELECT id FROM teams WHERE id=${task.team_id} AND manager_user_id=${userId} AND is_active=true`)[0];
      const isAdmin = (await sqlClient<{ user_id: string }[]>`SELECT m.user_id FROM workspace_memberships m JOIN roles r ON r.id=m.role_id WHERE m.workspace_id=${workspaceId} AND m.user_id=${userId} AND r.code='ADMIN'`)[0];
      if (!isMember && !isManager && !isAdmin) return false;
    }
    return true;
  }

  async create(workspaceId: string, actorId: string, input: CreateApprovalRequestDto) {
    if (!input.title?.trim() || input.title.trim().length > 255 || !input.approver_user_id || !uuidPattern.test(input.approver_user_id)) {
      throw new BadRequestException('VALIDATION_ERROR');
    }
    if (input.approver_user_id === actorId) {
      throw new UnprocessableEntityException('SELF_APPROVAL_NOT_ALLOWED');
    }

    const approverMembership = (await this.sql<{ user_id: string; status: string; is_active: boolean }[]>`
      SELECT m.user_id, m.status, u.is_active
      FROM workspace_memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = ${workspaceId} AND m.user_id = ${input.approver_user_id}
    `)[0];

    if (!approverMembership) {
      throw new UnprocessableEntityException('CROSS_WORKSPACE_REFERENCE');
    }
    if (approverMembership.status !== 'ACTIVE' || !approverMembership.is_active) {
      throw new UnprocessableEntityException('INACTIVE_APPROVER');
    }

    if (input.task_id) {
      if (!uuidPattern.test(input.task_id)) throw new BadRequestException('VALIDATION_ERROR');
      const task = (await this.sql<{ id: string }[]>`SELECT id FROM tasks WHERE id=${input.task_id} AND workspace_id=${workspaceId} AND deleted_at IS NULL`)[0];
      if (!task) throw new UnprocessableEntityException('CROSS_WORKSPACE_REFERENCE');

      const requesterHasAccess = await this.validateTaskAccess(this.sql, workspaceId, input.task_id, actorId);
      if (!requesterHasAccess) throw new ForbiddenException('FORBIDDEN');

      const approverHasAccess = await this.validateTaskAccess(this.sql, workspaceId, input.task_id, input.approver_user_id);
      if (!approverHasAccess) throw new UnprocessableEntityException('INVALID_APPROVER_TARGET');
    }

    return this.authService.database.sql.begin(async (sqlTx: TransactionSql) => {
      const request = (await sqlTx<{ id: string; submitted_at: Date }[]>`
        INSERT INTO approval_requests(workspace_id, task_id, requester_id, title, description, status)
        VALUES(${workspaceId}, ${input.task_id ?? null}, ${actorId}, ${input.title!.trim()}, ${input.description?.trim() ?? null}, 'PENDING')
        RETURNING id, submitted_at
      `)[0];

      const step = (await sqlTx<{ id: string }[]>`
        INSERT INTO approval_steps(workspace_id, approval_request_id, step_order, approver_user_id, status)
        VALUES(${workspaceId}, ${request.id}, 1, ${input.approver_user_id!}, 'PENDING')
        RETURNING id
      `)[0];

      const payload = {
        approval_request_id: request.id,
        step_id: step.id,
        approver_user_id: input.approver_user_id,
        requester_id: actorId,
        title: input.title!.trim(),
        task_id: input.task_id ?? null,
      };

      await sqlTx`
        INSERT INTO outbox_events(workspace_id, aggregate_type, aggregate_id, event_type, payload)
        VALUES(${workspaceId}, 'approval_request', ${request.id}, 'approval.requested', ${JSON.stringify(payload)}::jsonb)
      `;

      if (input.task_id) {
        const metadata = {
          approval_request_id: request.id,
          step_id: step.id,
          assigned_approver_id: input.approver_user_id,
        };
        await sqlTx`
          INSERT INTO task_history(task_id, actor_user_id, event_type, metadata)
          VALUES(${input.task_id}, ${actorId}, 'APPROVAL_REQUESTED', ${JSON.stringify(metadata)}::jsonb)
        `;
      }

      return this.detailTx(sqlTx, workspaceId, actorId, 'ADMIN', request.id);
    });
  }

  private async managedUserIds(workspaceId: string, managerUserId: string): Promise<string[]> {
    const rows = await this.sql<{ user_id: string }[]>`
      SELECT DISTINCT tm.user_id
      FROM team_memberships tm
      JOIN teams t ON t.id = tm.team_id
      WHERE t.workspace_id = ${workspaceId} AND t.manager_user_id = ${managerUserId} AND t.is_active = true
      UNION
      SELECT ${managerUserId} AS user_id
    `;
    return rows.map((r) => r.user_id);
  }

  async list(workspaceId: string, actorId: string, role: string, query: ApprovalQueryDto) {
    const view = query.view ?? 'inbox';
    if (!['inbox', 'sent', 'managed', 'all'].includes(view)) throw new BadRequestException('VALIDATION_ERROR');
    if (view === 'all' && role !== 'ADMIN') throw new ForbiddenException('FORBIDDEN');
    if (view === 'managed' && role !== 'MANAGER') throw new ForbiddenException('FORBIDDEN');

    if (query.team_id) {
      if (!uuidPattern.test(query.team_id)) throw new BadRequestException('VALIDATION_ERROR');
      const team = (await this.sql<{ id: string; manager_user_id: string | null; is_active: boolean }[]>`
        SELECT id, manager_user_id, is_active FROM teams WHERE id=${query.team_id} AND workspace_id=${workspaceId}
      `)[0];
      if (!team || !team.is_active) throw new BadRequestException('VALIDATION_ERROR');
      if (role === 'MANAGER' && team.manager_user_id !== actorId) throw new ForbiddenException('FORBIDDEN');
    }

    if (query.status && !['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(query.status)) {
      throw new BadRequestException('VALIDATION_ERROR');
    }

    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : null;

    let viewPredicate = this.sql`TRUE`;
    if (view === 'inbox') {
      viewPredicate = this.sql`st.approver_user_id = ${actorId}`;
    } else if (view === 'sent') {
      viewPredicate = this.sql`ar.requester_id = ${actorId}`;
    } else if (view === 'managed') {
      const managedIds = await this.managedUserIds(workspaceId, actorId);
      if (query.team_id) {
        const teamMembers = (await this.sql<{ user_id: string }[]>`
          SELECT user_id FROM team_memberships WHERE team_id = ${query.team_id}
        `).map((r) => r.user_id);
        const filtered = managedIds.filter((id) => teamMembers.includes(id) || id === actorId);
        viewPredicate = filtered.length ? this.sql`st.approver_user_id IN ${this.sql(filtered)}` : this.sql`FALSE`;
      } else {
        viewPredicate = managedIds.length ? this.sql`st.approver_user_id IN ${this.sql(managedIds)}` : this.sql`FALSE`;
      }
    } else if (view === 'all') {
      if (query.team_id) {
        const teamMembers = (await this.sql<{ user_id: string }[]>`
          SELECT user_id FROM team_memberships WHERE team_id = ${query.team_id}
        `).map((r) => r.user_id);
        viewPredicate = teamMembers.length ? this.sql`st.approver_user_id IN ${this.sql(teamMembers)}` : this.sql`FALSE`;
      }
    }

    const cursorPredicate = cursor
      ? this.sql`AND (ar.submitted_at < ${cursor.submittedAt.toISOString()} OR (ar.submitted_at = ${cursor.submittedAt.toISOString()} AND ar.id < ${cursor.id}))`
      : this.sql``;

    const rows = await this.sql<ApprovalRequestDetailRow[]>`
      SELECT
        ar.id, ar.workspace_id, ar.task_id, ar.requester_id, u_req.name AS requester_name,
        ar.cancelled_by_user_id, u_can.name AS cancelled_by_name, ar.title, ar.description,
        ar.cancel_reason, ar.status, ar.submitted_at, ar.completed_at, ar.created_at, ar.updated_at,
        st.id AS step_id, st.step_order, st.approver_user_id, u_app.name AS approver_name,
        st.decided_by_user_id, u_dec.name AS decided_by_name, st.status AS step_status,
        st.decision, st.reason, st.decided_at,
        t.title AS task_title, t.task_key
      FROM approval_requests ar
      JOIN approval_steps st ON st.approval_request_id = ar.id AND st.step_order = 1
      JOIN users u_req ON u_req.id = ar.requester_id
      JOIN users u_app ON u_app.id = st.approver_user_id
      LEFT JOIN users u_dec ON u_dec.id = st.decided_by_user_id
      LEFT JOIN users u_can ON u_can.id = ar.cancelled_by_user_id
      LEFT JOIN tasks t ON t.id = ar.task_id
      WHERE ar.workspace_id = ${workspaceId}
        AND ${viewPredicate}
        ${query.status ? this.sql`AND ar.status = ${query.status}` : this.sql``}
        ${cursorPredicate}
      ORDER BY ar.submitted_at DESC, ar.id DESC
      LIMIT ${limit + 1}
    `;

    const hasMore = rows.length > limit;
    const dataRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && dataRows.length ? this.encodeCursor(dataRows[dataRows.length - 1]) : null;

    return {
      data: dataRows.map(this.formatDetail),
      meta: {
        pagination: {
          limit,
          next_cursor: nextCursor,
          has_more: hasMore,
        },
      },
    };
  }

  private async detailTx(sqlClient: Sql | TransactionSql, workspaceId: string, actorId: string, role: string, approvalRequestId: string) {
    if (!uuidPattern.test(approvalRequestId)) throw new BadRequestException('VALIDATION_ERROR');

    const row = (await sqlClient<ApprovalRequestDetailRow[]>`
      SELECT
        ar.id, ar.workspace_id, ar.task_id, ar.requester_id, u_req.name AS requester_name,
        ar.cancelled_by_user_id, u_can.name AS cancelled_by_name, ar.title, ar.description,
        ar.cancel_reason, ar.status, ar.submitted_at, ar.completed_at, ar.created_at, ar.updated_at,
        st.id AS step_id, st.step_order, st.approver_user_id, u_app.name AS approver_name,
        st.decided_by_user_id, u_dec.name AS decided_by_name, st.status AS step_status,
        st.decision, st.reason, st.decided_at,
        t.title AS task_title, t.task_key
      FROM approval_requests ar
      JOIN approval_steps st ON st.approval_request_id = ar.id AND st.step_order = 1
      JOIN users u_req ON u_req.id = ar.requester_id
      JOIN users u_app ON u_app.id = st.approver_user_id
      LEFT JOIN users u_dec ON u_dec.id = st.decided_by_user_id
      LEFT JOIN users u_can ON u_can.id = ar.cancelled_by_user_id
      LEFT JOIN tasks t ON t.id = ar.task_id
      WHERE ar.id = ${approvalRequestId} AND ar.workspace_id = ${workspaceId}
    `)[0];

    if (!row) throw new NotFoundException('NOT_FOUND');

    let isAuthorized = row.requester_id === actorId || row.approver_user_id === actorId || role === 'ADMIN';
    if (!isAuthorized && role === 'MANAGER') {
      const managedIds = await this.managedUserIds(workspaceId, actorId);
      if (managedIds.includes(row.approver_user_id) || managedIds.includes(row.requester_id)) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) throw new ForbiddenException('FORBIDDEN');

    return this.formatDetail(row);
  }

  async detail(workspaceId: string, actorId: string, role: string, approvalRequestId: string) {
    return this.detailTx(this.sql, workspaceId, actorId, role, approvalRequestId);
  }

  private formatDetail(row: ApprovalRequestDetailRow) {
    return {
      id: row.id,
      workspace_id: row.workspace_id,
      task_id: row.task_id,
      task: row.task_id ? { id: row.task_id, task_key: row.task_key, title: row.task_title } : null,
      requester: { id: row.requester_id, full_name: row.requester_name },
      title: row.title,
      description: row.description,
      status: row.status,
      submitted_at: row.submitted_at instanceof Date ? row.submitted_at.toISOString() : new Date(row.submitted_at).toISOString(),
      completed_at: row.completed_at ? (row.completed_at instanceof Date ? row.completed_at.toISOString() : new Date(row.completed_at).toISOString()) : null,
      cancelled_by: row.cancelled_by_user_id ? { id: row.cancelled_by_user_id, full_name: row.cancelled_by_name } : null,
      cancel_reason: row.cancel_reason,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
      updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
      step: {
        id: row.step_id,
        step_order: row.step_order,
        approver: { id: row.approver_user_id, full_name: row.approver_name },
        decided_by: row.decided_by_user_id ? { id: row.decided_by_user_id, full_name: row.decided_by_name } : null,
        status: row.step_status,
        decision: row.decision,
        reason: row.reason,
        decided_at: row.decided_at ? (row.decided_at instanceof Date ? row.decided_at.toISOString() : new Date(row.decided_at).toISOString()) : null,
      },
    };
  }
}
