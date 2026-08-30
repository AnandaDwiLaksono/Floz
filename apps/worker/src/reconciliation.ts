import type { Sql } from 'postgres';
import { generateDueOccurrence } from './generate-due-occurrence.js';

export async function runReconciliationIteration(input: { sql: Sql; claimSql: Sql; now: Date; batchSize: number }): Promise<number> {
  let generated = 0;
  const claimConnection = await input.claimSql.reserve();
  const connection = claimConnection;
  const claim = await connection<{ claimed: boolean }[]>`SELECT pg_try_advisory_lock(hashtextextended('floz:recurrence-reconciliation', 0)) AS claimed`;
  if (!claim[0]?.claimed) { claimConnection.release(); return 0; }
  try {
    for (let index = 0; index < input.batchSize; index += 1) {
      const rule = (await connection<{ id: string }[]>`SELECT r.id FROM recurrence_rules r WHERE r.is_active=true AND r.next_run_at <= ${input.now.toISOString()} AND NOT EXISTS (SELECT 1 FROM recurrence_occurrences o WHERE o.recurrence_rule_id=r.id AND o.scheduled_for=r.next_run_at) ORDER BY r.next_run_at LIMIT 1`)[0];
      if (!rule) break;
      if (await generateDueOccurrence({ sql: input.sql, recurrenceRuleId: rule.id, now: input.now }) !== 'generated') continue;
      generated += 1;
    }
    return generated;
  } finally {
    await connection`SELECT pg_advisory_unlock(hashtextextended('floz:recurrence-reconciliation', 0))`;
    claimConnection.release();
  }
}

export function startReconciliationLoop(input: { sql: Sql; claimSql: Sql; intervalMs: number; batchSize: number; now?: () => Date; onError?: (error: unknown) => void }): () => Promise<void> {
  let running = false;
  let active: Promise<void> = Promise.resolve();
  const tick = () => {
    if (running) return;
    running = true;
    active = runReconciliationIteration({ sql: input.sql, claimSql: input.claimSql, now: (input.now ?? (() => new Date()))(), batchSize: input.batchSize }).then(() => undefined).catch(input.onError ?? (() => undefined)).finally(() => { running = false; });
  };
  tick();
  const timer = setInterval(tick, input.intervalMs);
  return async () => { clearInterval(timer); await active; };
}
