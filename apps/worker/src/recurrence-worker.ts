import type { Job } from 'bullmq';
import type { Sql } from 'postgres';
import { generateDueOccurrence } from './generate-due-occurrence.js';

export type RecurrenceWakeupJob = { recurrence_rule_id?: string };

export function createRecurrenceWorker(input: { sql: Sql; now?: () => Date }) {
  return async (job: Job<RecurrenceWakeupJob>) => {
    const recurrenceRuleId = job.data?.recurrence_rule_id;
    if (!recurrenceRuleId) return 'noop';
    return generateDueOccurrence({ sql: input.sql, recurrenceRuleId, now: (input.now ?? (() => new Date()))() });
  };
}
