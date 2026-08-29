import type { Sql, TransactionSql } from 'postgres';

type Db = Sql | TransactionSql;

type WakeupIntent = {
  workspaceId: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  availableAt: Date;
};

type ClaimOptions = { dispatcherId: string; now: Date; leaseMs: number; limit: number };
type OwnedEvent = { id: string; workspace_id: string; aggregate_id: string; event_type: string; payload: Record<string, unknown>; available_at: Date; attempt_count: number; claimed_by: string; claimed_until: Date };

export async function enqueueWakeupIntentTx(tx: TransactionSql, intent: WakeupIntent) {
  return (await tx<{ id: string }[]>`INSERT INTO outbox_events(workspace_id,aggregate_type,aggregate_id,event_type,payload,available_at) VALUES(${intent.workspaceId},'recurrence_rule',${intent.aggregateId},'RECURRENCE_WAKEUP',${JSON.stringify(intent.payload)}::jsonb,${intent.availableAt.toISOString()}) RETURNING id`)[0];
}

export async function claimOutboxBatch(db: Db, options: ClaimOptions): Promise<OwnedEvent[]> {
  return db<OwnedEvent[]>`WITH candidates AS (SELECT id FROM outbox_events WHERE status IN ('PENDING','FAILED') AND available_at <= ${options.now.toISOString()} AND (claimed_until IS NULL OR claimed_until <= ${options.now.toISOString()}) ORDER BY available_at,id LIMIT ${options.limit} FOR UPDATE SKIP LOCKED) UPDATE outbox_events AS event SET claimed_by=${options.dispatcherId},claimed_until=${new Date(options.now.getTime() + options.leaseMs).toISOString()},attempt_count=event.attempt_count+1 FROM candidates WHERE event.id=candidates.id RETURNING event.id,event.workspace_id,event.aggregate_id,event.event_type,event.payload,event.available_at,event.attempt_count,event.claimed_by,event.claimed_until`;
}

export async function markOutboxDispatched(db: Db, input: { id: string; dispatcherId: string; now: Date }) {
  const rows = await db<{ id: string }[]>`UPDATE outbox_events SET status='DISPATCHED',dispatched_at=${input.now.toISOString()},claimed_by=NULL,claimed_until=NULL WHERE id=${input.id} AND claimed_by=${input.dispatcherId} AND claimed_until > ${input.now.toISOString()} AND status IN ('PENDING','FAILED') RETURNING id`;
  return rows.length > 0;
}

export async function markOutboxRetry(db: Db, input: { id: string; dispatcherId: string; availableAt: Date }) {
  const rows = await db<{ id: string }[]>`UPDATE outbox_events SET status='FAILED',available_at=${input.availableAt.toISOString()},claimed_by=NULL,claimed_until=NULL WHERE id=${input.id} AND claimed_by=${input.dispatcherId} AND status IN ('PENDING','FAILED') RETURNING id`;
  return rows.length > 0;
}
