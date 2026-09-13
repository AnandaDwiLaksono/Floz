import type { Job } from 'bullmq';
import type { Sql } from 'postgres';
import { createDatabase, createDueSoonNotifications } from '@floz/database';
import { generateDueOccurrence } from './generate-due-occurrence.js';

export type RecurrenceWakeupJob = { recurrence_rule_id?: string };
export type DueSoonWakeupJob = { workspaceId?: string; taskId?: string; dueVersion?: number };
type Progress = (active: boolean) => Promise<void> | void;

export function createRecurrenceWorker(input: { sql: Sql; now?: () => Date; progress?: Progress }) {
  return async (job: Job<RecurrenceWakeupJob>) => {
    const recurrenceRuleId = job.data?.recurrence_rule_id;
    if (!recurrenceRuleId) return 'noop';
    await input.progress?.(true);
    try { return await generateDueOccurrence({ sql: input.sql, recurrenceRuleId, now: (input.now ?? (() => new Date()))() }); }
    finally { await input.progress?.(false); }
  };
}

export function createNotificationDueSoonWorker(input: { sql: Sql; databaseUrl?: string; now?: () => Date; progress?: Progress }) {
  const databaseUrl = input.databaseUrl ?? process.env.DATABASE_URL;
  return async (job: Job<DueSoonWakeupJob>) => {
    const { workspaceId, taskId, dueVersion } = job.data ?? {};
    if (!workspaceId || !taskId || dueVersion === undefined) return 'noop';
    if (!databaseUrl) throw new Error('DATABASE_URL is required');
    await input.progress?.(true);
    const { db, sql: clientSql } = createDatabase(databaseUrl);
    try {
      await db.transaction(async (tx) => { await createDueSoonNotifications(tx, { workspaceId, taskId, expectedDueVersion: dueVersion, now: (input.now ?? (() => new Date()))() }); });
    } finally { await clientSql.end(); await input.progress?.(false); }
    return 'processed';
  };
}
