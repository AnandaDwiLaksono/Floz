import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AuthService } from './auth';
import type { CreateCommentDto, CommentQueryDto } from './comment.dto';
import type { Sql, TransactionSql } from 'postgres';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CommentRow = {
  id: string;
  workspace_id: string;
  task_id: string;
  author_id: string;
  author_name: string;
  content: string;
  created_at: Date;
  created_at_raw?: string;
  updated_at: Date;
  deleted_at: Date | null;
};

export type MentionRow = {
  comment_id: string;
  user_id: string;
  full_name: string;
};

@Injectable()
export class CommentService {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  private get sql(): Sql {
    return this.authService.database.sql;
  }

  private encodeCursor(item: { created_at_raw?: string; created_at: Date; id: string }): string {
    const createdAt = item.created_at_raw ?? (item.created_at instanceof Date ? item.created_at.toISOString() : new Date(item.created_at).toISOString());
    return Buffer.from(JSON.stringify({ createdAt, id: item.id }), 'utf8').toString('base64url');
  }

  private decodeCursor(cursorStr: string): { createdAt: string; id: string } | null {
    try {
      const decoded = Buffer.from(cursorStr, 'base64url').toString('utf8');
      const parsed = JSON.parse(decoded);
      if (parsed && typeof parsed.createdAt === 'string' && parsed.id) {
        return { createdAt: String(parsed.createdAt), id: String(parsed.id) };
      }
    } catch {
      // Invalid cursor
    }
    return null;
  }

  private async checkTaskAccess(sqlClient: Sql | TransactionSql, workspaceId: string, taskId: string, userId: string): Promise<{ exists: boolean; hasAccess: boolean }> {
    const task = (await sqlClient<{ id: string; team_id: string | null }[]>`
      SELECT id, team_id FROM tasks WHERE id = ${taskId} AND workspace_id = ${workspaceId} AND deleted_at IS NULL
    `)[0];
    if (!task) return { exists: false, hasAccess: false };

    if (task.team_id) {
      const isMember = (await sqlClient<{ user_id: string }[]>`SELECT user_id FROM team_memberships WHERE team_id = ${task.team_id} AND user_id = ${userId}`)[0];
      const isManager = (await sqlClient<{ id: string }[]>`SELECT id FROM teams WHERE id = ${task.team_id} AND manager_user_id = ${userId} AND is_active = true`)[0];
      const isAdmin = (await sqlClient<{ user_id: string }[]>`SELECT m.user_id FROM workspace_memberships m JOIN roles r ON r.id = m.role_id WHERE m.workspace_id = ${workspaceId} AND m.user_id = ${userId} AND r.code = 'ADMIN'`)[0];
      if (!isMember && !isManager && !isAdmin) return { exists: true, hasAccess: false };
    }
    return { exists: true, hasAccess: true };
  }

  async create(workspaceId: string, actorId: string, taskId: string, input: CreateCommentDto) {
    if (!uuidPattern.test(taskId)) throw new BadRequestException('VALIDATION_ERROR');

    const trimmedContent = input.content?.trim();
    if (!trimmedContent || trimmedContent.length > 2000) {
      throw new BadRequestException('VALIDATION_ERROR');
    }

    const rawMentionIds = input.mentioned_user_ids || [];
    if (!Array.isArray(rawMentionIds)) throw new BadRequestException('VALIDATION_ERROR');
    for (const id of rawMentionIds) {
      if (!uuidPattern.test(id)) throw new BadRequestException('VALIDATION_ERROR');
    }
    const uniqueMentionIds = Array.from(new Set(rawMentionIds));

    return this.authService.database.sql.begin(async (sqlTx: TransactionSql) => {
      const taskCheck = await this.checkTaskAccess(sqlTx, workspaceId, taskId, actorId);
      if (!taskCheck.exists) throw new NotFoundException('NOT_FOUND');
      if (!taskCheck.hasAccess) throw new ForbiddenException('FORBIDDEN');

      for (const targetUserId of uniqueMentionIds) {
        const targetMembership = (await sqlTx<{ user_id: string; status: string; is_active: boolean }[]>`
          SELECT m.user_id, m.status, u.is_active
          FROM workspace_memberships m
          JOIN users u ON u.id = m.user_id
          WHERE m.workspace_id = ${workspaceId} AND m.user_id = ${targetUserId}
        `)[0];

        if (!targetMembership) {
          throw new UnprocessableEntityException('CROSS_WORKSPACE_REFERENCE');
        }
        if (targetMembership.status !== 'ACTIVE' || !targetMembership.is_active) {
          throw new UnprocessableEntityException('INVALID_MENTION_TARGET');
        }

        const targetTaskCheck = await this.checkTaskAccess(sqlTx, workspaceId, taskId, targetUserId);
        if (!targetTaskCheck.hasAccess) {
          throw new UnprocessableEntityException('INVALID_MENTION_TARGET');
        }
      }

      const commentRow = (await sqlTx<CommentRow[]>`
        INSERT INTO comments (workspace_id, task_id, author_id, content)
        VALUES (${workspaceId}, ${taskId}, ${actorId}, ${trimmedContent})
        RETURNING id, workspace_id, task_id, author_id, (SELECT name FROM users WHERE id = ${actorId}) AS author_name, content, created_at, updated_at, deleted_at
      `)[0];

      const mentionsList: MentionRow[] = [];
      for (const targetUserId of uniqueMentionIds) {
        const mentionRow = (await sqlTx<{ comment_id: string; user_id: string; full_name: string }[]>`
          INSERT INTO mentions (workspace_id, comment_id, mentioned_user_id)
          VALUES (${workspaceId}, ${commentRow.id}, ${targetUserId})
          RETURNING comment_id, mentioned_user_id AS user_id, (SELECT name FROM users WHERE id = ${targetUserId}) AS full_name
        `)[0];
        mentionsList.push(mentionRow);

        if (targetUserId !== actorId) {
          const payload = {
            comment_id: commentRow.id,
            task_id: taskId,
            mentioned_user_id: targetUserId,
            author_id: actorId,
          };
          await sqlTx`
            INSERT INTO outbox_events (workspace_id, aggregate_type, aggregate_id, event_type, payload)
            VALUES (${workspaceId}, 'comment', ${commentRow.id}, 'comment.mentioned', ${JSON.stringify(payload)}::jsonb)
          `;
        }
      }

      return this.formatComment(commentRow, mentionsList);
    });
  }

  async list(workspaceId: string, actorId: string, taskId: string, query: CommentQueryDto) {
    if (!uuidPattern.test(taskId)) throw new BadRequestException('VALIDATION_ERROR');

    const taskCheck = await this.checkTaskAccess(this.sql, workspaceId, taskId, actorId);
    if (!taskCheck.exists) throw new NotFoundException('NOT_FOUND');
    if (!taskCheck.hasAccess) throw new ForbiddenException('FORBIDDEN');

    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : null;

    const cursorPredicate = cursor
      ? this.sql`AND (c.created_at > ${cursor.createdAt}::timestamptz OR (c.created_at = ${cursor.createdAt}::timestamptz AND c.id > ${cursor.id}))`
      : this.sql``;

    const rows = await this.sql<CommentRow[]>`
      SELECT c.id, c.workspace_id, c.task_id, c.author_id, u.name AS author_name, c.content, c.created_at, to_json(c.created_at)#>>'{}' AS created_at_raw, c.updated_at, c.deleted_at
      FROM comments c
      JOIN users u ON u.id = c.author_id
      WHERE c.workspace_id = ${workspaceId} AND c.task_id = ${taskId} AND c.deleted_at IS NULL
        ${cursorPredicate}
      ORDER BY c.created_at ASC, c.id ASC
      LIMIT ${limit + 1}
    `;

    const hasMore = rows.length > limit;
    const dataRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && dataRows.length ? this.encodeCursor(dataRows[dataRows.length - 1]) : null;

    const commentIds = dataRows.map((r) => r.id);
    let mentionsMap = new Map<string, MentionRow[]>();
    if (commentIds.length > 0) {
      const mentionRows = await this.sql<MentionRow[]>`
        SELECT m.comment_id, m.mentioned_user_id AS user_id, u.name AS full_name
        FROM mentions m
        JOIN users u ON u.id = m.mentioned_user_id
        WHERE m.comment_id IN ${this.sql(commentIds)}
        ORDER BY u.name ASC
      `;
      for (const m of mentionRows) {
        const list = mentionsMap.get(m.comment_id) || [];
        list.push(m);
        mentionsMap.set(m.comment_id, list);
      }
    }

    return {
      data: dataRows.map((r) => this.formatComment(r, mentionsMap.get(r.id) || [])),
      meta: {
        pagination: {
          limit,
          next_cursor: nextCursor,
          has_more: hasMore,
        },
      },
    };
  }

  async delete(workspaceId: string, actorId: string, role: string, taskId: string, commentId: string) {
    if (!uuidPattern.test(taskId) || !uuidPattern.test(commentId)) throw new BadRequestException('VALIDATION_ERROR');

    const taskCheck = await this.checkTaskAccess(this.sql, workspaceId, taskId, actorId);
    if (!taskCheck.exists) throw new NotFoundException('NOT_FOUND');
    if (!taskCheck.hasAccess) throw new ForbiddenException('FORBIDDEN');

    const comment = (await this.sql<{ id: string; author_id: string; deleted_at: Date | null }[]>`
      SELECT id, author_id, deleted_at FROM comments WHERE id = ${commentId} AND workspace_id = ${workspaceId} AND task_id = ${taskId}
    `)[0];

    if (!comment) throw new NotFoundException('NOT_FOUND');

    const isAuthor = comment.author_id === actorId;
    const isAdmin = role === 'ADMIN';
    if (!isAuthor && !isAdmin) throw new ForbiddenException('FORBIDDEN');

    if (comment.deleted_at === null) {
      await this.sql`
        UPDATE comments SET deleted_at = NOW(), updated_at = NOW() WHERE id = ${commentId}
      `;
    }
  }

  public formatComment(row: CommentRow, mentions: MentionRow[]) {
    return {
      id: row.id,
      workspace_id: row.workspace_id,
      task_id: row.task_id,
      author: { id: row.author_id, full_name: row.author_name },
      content: row.content,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
      updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
      mentions: mentions.map((m) => ({ user_id: m.user_id, full_name: m.full_name })),
    };
  }
}
