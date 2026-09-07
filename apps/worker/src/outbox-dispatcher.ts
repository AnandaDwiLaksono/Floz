import { randomUUID } from 'node:crypto';
import type { Sql, TransactionSql } from 'postgres';
import type { Queue } from 'bullmq';
import { createPhase10Notification } from '@floz/database';
import { buildWakeupJobId } from './queues.js';

type Db = Sql | TransactionSql;
type OutboxEvent = { id: string; workspace_id: string; aggregate_id: string; event_type: string; payload: Record<string, unknown>; available_at: Date; attempt_count: number; claimed_by: string; claimed_until: Date };
type Claim = (db: Db, input: { claimToken: string; now: Date; leaseMs: number; limit: number }) => Promise<OutboxEvent[]>;
type MarkDispatched = (db: Db, input: { id: string; claimToken: string; now: Date }) => Promise<boolean>;
type MarkRetry = (db: Db, input: { id: string; claimToken: string; availableAt: Date; now: Date }) => Promise<boolean>;

export async function dispatchOutboxBatch(input: {
  db: Db;
  queue: Pick<Queue, 'add'>;
  notificationQueue?: Pick<Queue, 'add'>;
  claimToken?: string;
  now?: Date;
  leaseMs?: number;
  limit?: number;
  retryDelayMs?: number;
  claim: Claim;
  markDispatched: MarkDispatched;
  markRetry: MarkRetry;
  createAssignmentNotifications?: (tx: Db, payload: Record<string, unknown>) => Promise<void>;
}) {
  const now = input.now ?? new Date();
  const claimToken = input.claimToken ?? randomUUID();
  const rows = await input.claim(input.db, { claimToken, now, leaseMs: input.leaseMs ?? 30_000, limit: input.limit ?? 50 });
  let dispatched = 0;
  for (const row of rows) {
    try {
      if (row.event_type === 'task.assigned') {
        if (input.createAssignmentNotifications) {
          // ponytail: assuming pg transaction provided in handler or db supports transaction
          if ('transaction' in input.db && typeof input.db.transaction === 'function') {
            await input.db.transaction(async (tx: Db) => {
              await input.createAssignmentNotifications!(tx, row.payload);
            });
          } else {
             await input.createAssignmentNotifications(input.db, row.payload);
          }
        }
      } else if (row.event_type === 'task.due_changed') {
        if (input.notificationQueue && row.payload.dueAt) {
          const dueTime = new Date(row.payload.dueAt as string).getTime();
          const targetTime = dueTime - 24 * 60 * 60 * 1000;
          const nowMs = now.getTime();
          
          if (dueTime > nowMs) {
             const { buildDueSoonWakeupJobId } = await import('./queues.js');
             const jobId = buildDueSoonWakeupJobId(row.payload.taskId as string, row.payload.dueVersion as number);
             if (targetTime <= nowMs) {
               await input.notificationQueue.add('due-soon', row.payload, { jobId });
             } else {
               await input.notificationQueue.add('due-soon', row.payload, { jobId, delay: targetTime - nowMs });
             }
          }
        }
      } else if (row.event_type === 'approval.requested') {
        const payload = row.payload as { approval_request_id: string; approver_user_id: string; title: string };
        const dedupKey = `approval-requested-${payload.approval_request_id}`;
        await createPhase10Notification(input.db, {
          workspaceId: row.workspace_id,
          userId: payload.approver_user_id,
          type: 'APPROVAL_REQUESTED',
          title: 'Approval Requested',
          body: `Approval requested: ${payload.title}`,
          entityType: 'APPROVAL_REQUEST',
          entityId: payload.approval_request_id,
          dedupKey,
        });
      } else if (row.event_type === 'approval.decided') {
        const payload = row.payload as { approval_request_id: string; decision: 'APPROVED' | 'REJECTED'; requester_id: string; decided_by_user_id: string; reason?: string | null };
        if (payload.decision === 'APPROVED') {
          const dedupKey = `approval-approved-${payload.approval_request_id}`;
          await createPhase10Notification(input.db, {
            workspaceId: row.workspace_id,
            userId: payload.requester_id,
            type: 'APPROVAL_APPROVED',
            title: 'Approval Approved',
            body: payload.reason ? `Your approval request was approved: ${payload.reason}` : 'Your approval request was approved.',
            entityType: 'APPROVAL_REQUEST',
            entityId: payload.approval_request_id,
            dedupKey,
          });
        } else if (payload.decision === 'REJECTED') {
          const dedupKey = `approval-rejected-${payload.approval_request_id}`;
          await createPhase10Notification(input.db, {
            workspaceId: row.workspace_id,
            userId: payload.requester_id,
            type: 'APPROVAL_REJECTED',
            title: 'Approval Rejected',
            body: payload.reason ? `Your approval request was rejected: ${payload.reason}` : 'Your approval request was rejected.',
            entityType: 'APPROVAL_REQUEST',
            entityId: payload.approval_request_id,
            dedupKey,
          });
        }
      } else if (row.event_type === 'approval.cancelled') {
        const payload = row.payload as { approval_request_id: string; approver_user_id: string; cancelled_by_user_id: string; cancel_reason?: string | null };
        const dedupKey = `approval-cancelled-${payload.approval_request_id}`;
        await createPhase10Notification(input.db, {
          workspaceId: row.workspace_id,
          userId: payload.approver_user_id,
          type: 'APPROVAL_CANCELLED',
          title: 'Approval Cancelled',
          body: payload.cancel_reason ? `Approval request was cancelled: ${payload.cancel_reason}` : 'Approval request was cancelled.',
          entityType: 'APPROVAL_REQUEST',
          entityId: payload.approval_request_id,
          dedupKey,
        });
      } else if (row.event_type === 'comment.mentioned') {
        const payload = row.payload as { comment_id: string; task_id: string; mentioned_user_id: string; author_id: string };
        const dedupKey = `comment-mention-${payload.comment_id}-${payload.mentioned_user_id}`;
        await createPhase10Notification(input.db, {
          workspaceId: row.workspace_id,
          userId: payload.mentioned_user_id,
          type: 'COMMENT_MENTIONED',
          title: 'You were mentioned',
          body: 'You were mentioned in a comment.',
          entityType: 'TASK',
          entityId: payload.task_id,
          dedupKey,
        });
      } else {
        const recurrenceRuleId = String(row.payload.recurrence_rule_id ?? row.aggregate_id);
        const scheduledFor = String(row.payload.scheduled_for ?? row.available_at.toISOString());
        await input.queue.add('wake', row.payload, { jobId: buildWakeupJobId({ recurrenceRuleId, scheduledFor }) });
      }
      
      if (await input.markDispatched(input.db, { id: row.id, claimToken, now })) dispatched++;
    } catch {
      await input.markRetry(input.db, { id: row.id, claimToken, now, availableAt: new Date(now.getTime() + (input.retryDelayMs ?? 5000)) });
    }
  }
  return dispatched;
}
