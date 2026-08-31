import { sql as drizzleSql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { tasks, taskStatuses, taskAssignees } from './schema.js';
import { and, eq } from 'drizzle-orm';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = PgTransaction<PostgresJsQueryResultHKT, any, ExtractTablesWithRelations<any>>;

export async function createAssignmentNotifications(
  tx: Tx,
  params: { workspaceId: string; taskId: string; addedAssigneeIds: string[]; eventId: string }
) {
  // Read canonical task
  const task = await tx.select({ 
    id: tasks.id, 
    deletedAt: tasks.deletedAt,
    title: tasks.title
  })
    .from(tasks)
    .where(and(eq(tasks.id, params.taskId), eq(tasks.workspaceId, params.workspaceId)))
    .limit(1)
    .then((res) => res[0]);

  if (!task || task.deletedAt !== null) return;

  // Fetch active assignees intersected with addedAssigneeIds
  const assignees = await tx.select({ userId: taskAssignees.userId })
    .from(taskAssignees)
    .where(eq(taskAssignees.taskId, params.taskId));
  
  const activeUserIds = assignees.map((a) => a.userId).filter((id: string) => params.addedAssigneeIds.includes(id));

  for (const userId of activeUserIds) {
    const notificationId = randomUUID();
    const ledgerId = randomUUID();
    const dedupKey = `assignment:${params.workspaceId}:${params.taskId}:${userId}:${params.eventId}`;
    const type = 'TASK_ASSIGNED';
    const title = 'New Task Assignment';
    const body = `You have been assigned to task: ${task.title}`;

    await tx.execute(drizzleSql`
      WITH inserted_dedup AS (
        INSERT INTO notification_dedup_ledger (id, workspace_id, dedup_key, notification_id, created_at)
        VALUES (${ledgerId}, ${params.workspaceId}, ${dedupKey}, ${notificationId}, NOW())
        ON CONFLICT (workspace_id, dedup_key) DO NOTHING
        RETURNING notification_id
      )
      INSERT INTO notifications (id, workspace_id, user_id, type, title, body, entity_type, entity_id, is_read, created_at)
      SELECT notification_id, ${params.workspaceId}, ${userId}, ${type}, ${title}, ${body}, 'TASK', ${params.taskId}, false, NOW()
      FROM inserted_dedup;
    `);
  }
}

export async function createDueSoonNotifications(
  tx: Tx,
  params: { workspaceId: string; taskId: string; expectedDueVersion: number; now?: Date }
) {
  const taskData = await tx.select({
    id: tasks.id,
    deletedAt: tasks.deletedAt,
    dueAt: tasks.dueAt,
    dueVersion: tasks.dueVersion,
    title: tasks.title,
    isTerminal: taskStatuses.isTerminal,
    category: taskStatuses.category
  })
  .from(tasks)
  .leftJoin(taskStatuses, eq(tasks.statusId, taskStatuses.id))
  .where(and(eq(tasks.id, params.taskId), eq(tasks.workspaceId, params.workspaceId)))
  .limit(1)
  .then((res) => res[0]);

  if (!taskData || taskData.deletedAt !== null || taskData.dueAt === null || taskData.dueVersion !== params.expectedDueVersion) return;
  if (taskData.isTerminal || taskData.category === 'COMPLETED' || taskData.category === 'CANCELLED') return;
  
  const now = params.now ?? new Date();
  if (now >= new Date(taskData.dueAt as Date)) return;

  const assignees = await tx.select({ userId: taskAssignees.userId })
    .from(taskAssignees)
    .where(eq(taskAssignees.taskId, params.taskId));

  for (const a of assignees) {
    const userId = a.userId;
    const notificationId = randomUUID();
    const ledgerId = randomUUID();
    const dedupKey = `due-soon:${params.workspaceId}:${params.taskId}:${userId}:${params.expectedDueVersion}`;
    const type = 'TASK_DUE_SOON';
    const title = 'Task Due Soon';
    const body = `Task is due soon: ${taskData.title}`;

    await tx.execute(drizzleSql`
      WITH inserted_dedup AS (
        INSERT INTO notification_dedup_ledger (id, workspace_id, dedup_key, notification_id, created_at)
        VALUES (${ledgerId}, ${params.workspaceId}, ${dedupKey}, ${notificationId}, NOW())
        ON CONFLICT (workspace_id, dedup_key) DO NOTHING
        RETURNING notification_id
      )
      INSERT INTO notifications (id, workspace_id, user_id, type, title, body, entity_type, entity_id, is_read, created_at)
      SELECT notification_id, ${params.workspaceId}, ${userId}, ${type}, ${title}, ${body}, 'TASK', ${params.taskId}, false, NOW()
      FROM inserted_dedup;
    `);
  }
}

export async function createOverdueNotifications(
  tx: Tx,
  params: { workspaceId: string; taskId: string; expectedDueVersion: number; now?: Date }
) {
  const taskData = await tx.select({
    id: tasks.id,
    deletedAt: tasks.deletedAt,
    dueAt: tasks.dueAt,
    dueVersion: tasks.dueVersion,
    title: tasks.title,
    isTerminal: taskStatuses.isTerminal,
    category: taskStatuses.category
  })
  .from(tasks)
  .leftJoin(taskStatuses, eq(tasks.statusId, taskStatuses.id))
  .where(and(eq(tasks.id, params.taskId), eq(tasks.workspaceId, params.workspaceId)))
  .limit(1)
  .then((res) => res[0]);

  if (!taskData || taskData.deletedAt !== null || taskData.dueAt === null || taskData.dueVersion !== params.expectedDueVersion) return;
  if (taskData.isTerminal || taskData.category === 'COMPLETED' || taskData.category === 'CANCELLED') return;
  
  const now = params.now ?? new Date();
  if (now <= new Date(taskData.dueAt as Date)) return;

  const assignees = await tx.select({ userId: taskAssignees.userId })
    .from(taskAssignees)
    .where(eq(taskAssignees.taskId, params.taskId));

  for (const a of assignees) {
    const userId = a.userId;
    const notificationId = randomUUID();
    const ledgerId = randomUUID();
    const dedupKey = `overdue:${params.workspaceId}:${params.taskId}:${userId}:${params.expectedDueVersion}`;
    const type = 'TASK_OVERDUE';
    const title = 'Task Overdue';
    const body = `Task is overdue: ${taskData.title}`;

    await tx.execute(drizzleSql`
      WITH inserted_dedup AS (
        INSERT INTO notification_dedup_ledger (id, workspace_id, dedup_key, notification_id, created_at)
        VALUES (${ledgerId}, ${params.workspaceId}, ${dedupKey}, ${notificationId}, NOW())
        ON CONFLICT (workspace_id, dedup_key) DO NOTHING
        RETURNING notification_id
      )
      INSERT INTO notifications (id, workspace_id, user_id, type, title, body, entity_type, entity_id, is_read, created_at)
      SELECT notification_id, ${params.workspaceId}, ${userId}, ${type}, ${title}, ${body}, 'TASK', ${params.taskId}, false, NOW()
      FROM inserted_dedup;
    `);
  }
}
