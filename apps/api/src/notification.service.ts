import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuthService } from './auth';

export type NotificationRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  read_at: Date | null;
  created_at: Date;
};

export type DecodedCursor = {
  createdAt: Date;
  id: string;
};

@Injectable()
export class NotificationService {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  private get sql() {
    return this.authService.database.sql;
  }

  private toIsoString(date: Date | string | null | undefined): string | null {
    if (!date) return null;
    if (typeof date === 'string') return new Date(date).toISOString();
    return date.toISOString();
  }

  private getNotificationContext(workspaceId: string, entityType: string | null, entityId: string | null, type: string): { route: string } | null {
    if (entityType === 'TASK' && entityId) {
      return { route: `/workspaces/${workspaceId}/tasks?selected_task_id=${entityId}` };
    }
    if (entityType === 'APPROVAL_REQUEST' && entityId) {
      const view = (type === 'APPROVAL_REQUESTED' || type === 'APPROVAL_CANCELLED') ? 'inbox' : 'sent';
      return { route: `/workspaces/${workspaceId}/approvals?view=${view}&selected_approval_request_id=${entityId}` };
    }
    return null;
  }

  private encodeCursor(item: NotificationRow): string {
    const createdAt = item.created_at instanceof Date ? item.created_at.toISOString() : new Date(item.created_at).toISOString();
    const payload = JSON.stringify({
      createdAt,
      id: item.id,
    });
    return Buffer.from(payload, 'utf8').toString('base64');
  }

  private decodeCursor(cursorStr: string): DecodedCursor | null {
    try {
      const decoded = Buffer.from(cursorStr, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded);
      if (parsed && parsed.createdAt && parsed.id) {
        const createdAt = new Date(parsed.createdAt);
        if (!isNaN(createdAt.getTime())) {
          return { createdAt, id: String(parsed.id) };
        }
      }
    } catch {
      // Invalid cursor defaults to null or invalid format
    }
    return null;
  }

  async listNotifications(
    workspaceId: string,
    currentUserId: string,
    query: { read?: boolean; limit: number; cursor?: string }
  ) {
    const { read, limit, cursor: cursorStr } = query;
    const cursor = cursorStr ? this.decodeCursor(cursorStr) : null;

    let rows: NotificationRow[] = [];

    if (cursor) {
      rows = await this.sql<NotificationRow[]>`
        SELECT id, workspace_id, user_id, type, title, body, entity_type, entity_id, is_read, read_at, created_at
        FROM notifications
        WHERE workspace_id = ${workspaceId}
          AND user_id = ${currentUserId}
          ${read !== undefined ? this.sql`AND is_read = ${read}` : this.sql``}
          AND (
            created_at < ${cursor.createdAt}
            OR (created_at = ${cursor.createdAt} AND id < ${cursor.id})
          )
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit + 1}
      `;
    } else {
      rows = await this.sql<NotificationRow[]>`
        SELECT id, workspace_id, user_id, type, title, body, entity_type, entity_id, is_read, read_at, created_at
        FROM notifications
        WHERE workspace_id = ${workspaceId}
          AND user_id = ${currentUserId}
          ${read !== undefined ? this.sql`AND is_read = ${read}` : this.sql``}
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit + 1}
      `;
    }

    const hasMore = rows.length > limit;
    const dataRows = hasMore ? rows.slice(0, limit) : rows;

    const mappedData = dataRows.map((row) => {
      const context = this.getNotificationContext(workspaceId, row.entity_type, row.entity_id, row.type);

      return {
        id: row.id,
        workspace_id: row.workspace_id,
        user_id: row.user_id,
        type: row.type,
        title: row.title,
        body: row.body,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        is_read: row.is_read,
        read_at: this.toIsoString(row.read_at),
        created_at: this.toIsoString(row.created_at)!,
        context,
      };
    });

    const nextCursor =
      hasMore && dataRows.length > 0
        ? this.encodeCursor(dataRows[dataRows.length - 1])
        : null;

    return {
      data: mappedData,
      meta: {
        pagination: {
          limit,
          next_cursor: nextCursor,
          has_more: hasMore,
        },
      },
    };
  }

  async getUnreadCount(workspaceId: string, currentUserId: string) {
    const result = await this.sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM notifications
      WHERE workspace_id = ${workspaceId}
        AND user_id = ${currentUserId}
        AND is_read = false
    `;
    const count = parseInt(result[0]?.count ?? '0', 10);
    return { data: { count } };
  }

  async markRead(workspaceId: string, currentUserId: string, notificationId: string) {
    const existing = await this.sql<NotificationRow[]>`
      SELECT id, workspace_id, user_id, type, title, body, entity_type, entity_id, is_read, read_at, created_at
      FROM notifications
      WHERE id = ${notificationId}
        AND workspace_id = ${workspaceId}
        AND user_id = ${currentUserId}
      LIMIT 1
    `;

    if (existing.length === 0) {
      throw new NotFoundException('NOT_FOUND');
    }

    const item = existing[0];

    if (item.is_read) {
      const context = this.getNotificationContext(workspaceId, item.entity_type, item.entity_id, item.type);
      return {
        data: {
          id: item.id,
          workspace_id: item.workspace_id,
          user_id: item.user_id,
          type: item.type,
          title: item.title,
          body: item.body,
          entity_type: item.entity_type,
          entity_id: item.entity_id,
          is_read: item.is_read,
          read_at: this.toIsoString(item.read_at),
          created_at: this.toIsoString(item.created_at)!,
          context,
        },
      };
    }

    const updated = await this.sql<NotificationRow[]>`
      UPDATE notifications
      SET is_read = true, read_at = NOW()
      WHERE id = ${notificationId}
        AND workspace_id = ${workspaceId}
        AND user_id = ${currentUserId}
      RETURNING id, workspace_id, user_id, type, title, body, entity_type, entity_id, is_read, read_at, created_at
    `;

    const row = updated[0];
    const context = this.getNotificationContext(workspaceId, row.entity_type, row.entity_id, row.type);

    return {
      data: {
        id: row.id,
        workspace_id: row.workspace_id,
        user_id: row.user_id,
        type: row.type,
        title: row.title,
        body: row.body,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        is_read: row.is_read,
        read_at: this.toIsoString(row.read_at),
        created_at: this.toIsoString(row.created_at)!,
        context,
      },
    };
  }

  async markAllRead(workspaceId: string, currentUserId: string) {
    const updated = await this.sql<{ count: string }[]>`
      WITH updated AS (
        UPDATE notifications
        SET is_read = true, read_at = NOW()
        WHERE workspace_id = ${workspaceId}
          AND user_id = ${currentUserId}
          AND is_read = false
        RETURNING id
      )
      SELECT COUNT(*)::text AS count FROM updated
    `;

    const updatedCount = parseInt(updated[0]?.count ?? '0', 10);
    return { data: { updated_count: updatedCount } };
  }
}
