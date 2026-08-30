import type { Sql } from 'postgres';
import { generateDueOccurrence } from './generate-due-occurrence.js';

export async function runReconciliationIteration(input: { sql: Sql; now: Date; batchSize: number }): Promise<number> {
  let generated = 0;
  for (let index = 0; index < input.batchSize; index += 1) {
    const rule = (await input.sql<{ id: string }[]>`SELECT r.id FROM recurrence_rules r WHERE r.is_active=true AND r.next_run_at <= ${input.now.toISOString()} AND NOT EXISTS (SELECT 1 FROM recurrence_occurrences o WHERE o.recurrence_rule_id=r.id AND o.scheduled_for=r.next_run_at) ORDER BY r.next_run_at LIMIT 1`)[0];
    if (!rule) break;
    if (await generateDueOccurrence({ sql: input.sql, recurrenceRuleId: rule.id, now: input.now }) !== 'generated') continue;
    generated += 1;
  }
  return generated;
}
