import type { Sql } from 'postgres';
import { createDatabase, createDueSoonNotifications, createOverdueNotifications } from '@floz/database';
import { generateDueOccurrence } from './generate-due-occurrence.js';

export async function runReconciliationIteration(input: { sql: Sql; claimSql: Sql; now: Date; batchSize: number; databaseUrl?: string }): Promise<number> {
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

    const databaseUrl = input.databaseUrl ?? process.env.DATABASE_URL;
    if (databaseUrl) {
      const { db, sql: clientSql } = createDatabase(databaseUrl);
      try {
        // Due Soon missed reminders recovery:
        // Query active tasks where deleted_at IS NULL, due_at > NOW(), due_at - interval '24 hours' <= NOW()
        const dueSoonTasks = await connection<{ id: string; workspace_id: string; due_version: number }[]>`
          SELECT t.id, t.workspace_id, t.due_version
          FROM tasks t
          LEFT JOIN task_statuses ts ON t.status_id = ts.id
          WHERE t.deleted_at IS NULL
            AND t.due_at > ${input.now.toISOString()}
            AND t.due_at - interval '24 hours' <= ${input.now.toISOString()}
            AND (ts.is_terminal IS NULL OR ts.is_terminal = false)
            AND (ts.category IS NULL OR (ts.category != 'COMPLETED' AND ts.category != 'CANCELLED'))
          LIMIT ${input.batchSize}
        `;

        for (const task of dueSoonTasks) {
          await db.transaction(async (tx) => {
            await createDueSoonNotifications(tx, {
              workspaceId: task.workspace_id,
              taskId: task.id,
              expectedDueVersion: task.due_version,
              now: input.now
            });
          });
        }

        // Overdue tasks reminders:
        // Query active tasks where deleted_at IS NULL, due_at < NOW()
        const overdueTasks = await connection<{ id: string; workspace_id: string; due_version: number }[]>`
          SELECT t.id, t.workspace_id, t.due_version
          FROM tasks t
          LEFT JOIN task_statuses ts ON t.status_id = ts.id
          WHERE t.deleted_at IS NULL
            AND t.due_at < ${input.now.toISOString()}
            AND (ts.is_terminal IS NULL OR ts.is_terminal = false)
            AND (ts.category IS NULL OR (ts.category != 'COMPLETED' AND ts.category != 'CANCELLED'))
          LIMIT ${input.batchSize}
        `;

        for (const task of overdueTasks) {
          await db.transaction(async (tx) => {
            await createOverdueNotifications(tx, {
              workspaceId: task.workspace_id,
              taskId: task.id,
              expectedDueVersion: task.due_version,
              now: input.now
            });
          });
        }
      } finally {
        await clientSql.end();
      }
    }

    return generated;
  } finally {
    await connection`SELECT pg_advisory_unlock(hashtextextended('floz:recurrence-reconciliation', 0))`;
    claimConnection.release();
  }
}

export function startReconciliationLoop(input: { sql: Sql; claimSql: Sql; intervalMs: number; batchSize: number; now?: () => Date; onError?: (error: unknown) => void; databaseUrl?: string }): () => Promise<void> {
  let running = false;
  let active: Promise<void> = Promise.resolve();
  const tick = () => {
    if (running) return;
    running = true;
    active = runReconciliationIteration({ sql: input.sql, claimSql: input.claimSql, now: (input.now ?? (() => new Date()))(), batchSize: input.batchSize, databaseUrl: input.databaseUrl }).then(() => undefined).catch(input.onError ?? (() => undefined)).finally(() => { running = false; });
  };
  tick();
  const timer = setInterval(tick, input.intervalMs);
  return async () => { clearInterval(timer); await active; };
}
