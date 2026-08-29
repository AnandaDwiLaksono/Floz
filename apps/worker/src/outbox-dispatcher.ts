import type { Sql, TransactionSql } from 'postgres';
import type { Queue } from 'bullmq';
import { buildWakeupJobId } from './queues.js';

type Db = Sql | TransactionSql;
type OutboxEvent = { id: string; workspace_id: string; aggregate_id: string; event_type: string; payload: Record<string, unknown>; available_at: Date; attempt_count: number; claimed_by: string; claimed_until: Date };
type Claim = (db: Db, input: { dispatcherId: string; now: Date; leaseMs: number; limit: number }) => Promise<OutboxEvent[]>;
type MarkDispatched = (db: Db, input: { id: string; dispatcherId: string; now: Date }) => Promise<boolean>;
type MarkRetry = (db: Db, input: { id: string; dispatcherId: string; availableAt: Date; now: Date }) => Promise<boolean>;

export async function dispatchOutboxBatch(input: {
  db: Db;
  queue: Pick<Queue, 'add'>;
  dispatcherId: string;
  now?: Date;
  leaseMs?: number;
  limit?: number;
  retryDelayMs?: number;
  claim: Claim;
  markDispatched: MarkDispatched;
  markRetry: MarkRetry;
}) {
  const now = input.now ?? new Date();
  const rows = await input.claim(input.db, { dispatcherId: input.dispatcherId, now, leaseMs: input.leaseMs ?? 30_000, limit: input.limit ?? 50 });
  let dispatched = 0;
  for (const row of rows) {
    try {
      const recurrenceRuleId = String(row.payload.recurrence_rule_id ?? row.aggregate_id);
      const scheduledFor = String(row.payload.scheduled_for ?? row.available_at.toISOString());
      await input.queue.add('wake', row.payload, { jobId: buildWakeupJobId({ recurrenceRuleId, scheduledFor }) });
      if (await input.markDispatched(input.db, { id: row.id, dispatcherId: input.dispatcherId, now: new Date() })) dispatched++;
    } catch {
      const retryNow = new Date();
      await input.markRetry(input.db, { id: row.id, dispatcherId: input.dispatcherId, now: retryNow, availableAt: new Date(retryNow.getTime() + (input.retryDelayMs ?? 5000)) });
    }
  }
  return dispatched;
}
