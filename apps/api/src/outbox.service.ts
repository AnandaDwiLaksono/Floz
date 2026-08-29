import type { TransactionSql } from 'postgres';
export { claimOutboxBatch, markOutboxDispatched, markOutboxRetry } from '@floz/database';

type WakeupIntent = {
  workspaceId: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  availableAt: Date;
};

export async function enqueueWakeupIntentTx(tx: TransactionSql, intent: WakeupIntent) {
  return (await tx<{ id: string }[]>`INSERT INTO outbox_events(workspace_id,aggregate_type,aggregate_id,event_type,payload,available_at) VALUES(${intent.workspaceId},'recurrence_rule',${intent.aggregateId},'RECURRENCE_WAKEUP',${JSON.stringify(intent.payload)}::jsonb,${intent.availableAt.toISOString()}) RETURNING id`)[0];
}
