import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '@floz/database';
import { runReconciliationIteration } from '../src/reconciliation.js';
import { createNotificationDueSoonWorker } from '../src/recurrence-worker.js';

const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;
const reconciliationNow = new Date('2026-08-30T12:00:00.000Z');

describeIntegration('notification worker and reconciliation integration', () => {
  if (!databaseUrl) return;
  const { sql } = createDatabase(databaseUrl);
  const { sql: claimSql } = createDatabase(databaseUrl);

  const ids = {
    user: randomUUID(),
    assignee: randomUUID(),
    workspace: randomUUID(),
    role: randomUUID(),
    workflow: randomUUID(),
    openStatus: randomUUID(),
    completedStatus: randomUUID(),
    dueSoonTask: randomUUID(),
    overdueTask: randomUUID(),
    completedOverdueTask: randomUUID(),
    workerDueSoonTask: randomUUID()
  };

  beforeAll(async () => {
    await sql`TRUNCATE team_memberships, teams, workspace_memberships, workspaces, roles, sessions, accounts, users, verifications, task_history, task_assignees, tasks, workflow_transitions, task_statuses, workflows, outbox_events, recurrence_idempotency_keys, recurrence_occurrences, recurrence_rules, notification_dedup_ledger, notifications, notification_preferences RESTART IDENTITY CASCADE`;
    const roleCode = `NOTIF_${randomUUID().substring(0, 8)}`;
    await sql`INSERT INTO roles(id,code,name) VALUES(${ids.role},${roleCode},'Notification Role') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO users(id,email,name) VALUES(${ids.user},${`${ids.user}@notif.test`},'Notif User'),(${ids.assignee},${`${ids.assignee}@notif.test`},'Notif Assignee')`;
    await sql`INSERT INTO workspaces(id,name,slug,created_by) VALUES(${ids.workspace},'Notif Workspace',${`notif-${ids.workspace}`},${ids.user})`;
    await sql`INSERT INTO workspace_memberships(workspace_id,user_id,role_id) VALUES(${ids.workspace},${ids.user},${ids.role}),(${ids.workspace},${ids.assignee},${ids.role})`;
    await sql`INSERT INTO workflows(id,workspace_id,code,name,is_default,created_by) VALUES(${ids.workflow},${ids.workspace},'NOTIF','Notification Workflow',false,${ids.user})`;
    await sql`INSERT INTO task_statuses(id,workflow_id,code,name,category,position,is_initial,is_terminal) VALUES
      (${ids.openStatus},${ids.workflow},'TODO','To do','OPEN',1,true,false),
      (${ids.completedStatus},${ids.workflow},'DONE','Done','COMPLETED',2,false,true)`;

    const dueSoonAt = new Date(reconciliationNow.getTime() + 6 * 3600 * 1000);
    const overdueAt = new Date(reconciliationNow.getTime() - 6 * 3600 * 1000);

    // 1. Task due soon
    await sql`INSERT INTO tasks(id,workspace_id,task_key,title,workflow_id,status_id,creator_id,due_at,due_version)
      VALUES(${ids.dueSoonTask},${ids.workspace},'NOTIF-1','Task Due Soon',${ids.workflow},${ids.openStatus},${ids.user},${dueSoonAt.toISOString()},1)`;
    await sql`INSERT INTO task_assignees(task_id,user_id,assigned_by) VALUES(${ids.dueSoonTask},${ids.assignee},${ids.user})`;

    // 2. Task overdue
    await sql`INSERT INTO tasks(id,workspace_id,task_key,title,workflow_id,status_id,creator_id,due_at,due_version)
      VALUES(${ids.overdueTask},${ids.workspace},'NOTIF-2','Task Overdue',${ids.workflow},${ids.openStatus},${ids.user},${overdueAt.toISOString()},1)`;
    await sql`INSERT INTO task_assignees(task_id,user_id,assigned_by) VALUES(${ids.overdueTask},${ids.assignee},${ids.user})`;

    // 3. Completed task overdue (should be ignored)
    await sql`INSERT INTO tasks(id,workspace_id,task_key,title,workflow_id,status_id,creator_id,due_at,due_version)
      VALUES(${ids.completedOverdueTask},${ids.workspace},'NOTIF-3','Task Completed',${ids.workflow},${ids.completedStatus},${ids.user},${overdueAt.toISOString()},1)`;
    await sql`INSERT INTO task_assignees(task_id,user_id,assigned_by) VALUES(${ids.completedOverdueTask},${ids.assignee},${ids.user})`;

    // 4. Task for direct worker wake-up test
    await sql`INSERT INTO tasks(id,workspace_id,task_key,title,workflow_id,status_id,creator_id,due_at,due_version)
      VALUES(${ids.workerDueSoonTask},${ids.workspace},'NOTIF-4','Worker Due Soon',${ids.workflow},${ids.openStatus},${ids.user},${dueSoonAt.toISOString()},1)`;
    await sql`INSERT INTO task_assignees(task_id,user_id,assigned_by) VALUES(${ids.workerDueSoonTask},${ids.assignee},${ids.user})`;
  });

  afterAll(async () => {
    await sql`TRUNCATE team_memberships, teams, workspace_memberships, workspaces, roles, sessions, accounts, users, verifications, task_history, task_assignees, tasks, workflow_transitions, task_statuses, workflows, outbox_events, recurrence_idempotency_keys, recurrence_occurrences, recurrence_rules, notification_dedup_ledger, notifications, notification_preferences RESTART IDENTITY CASCADE`;
    await claimSql.end();
    await sql.end();
  });

  it('worker processes notification-due-soon job and dedups', async () => {
    const workerHandler = createNotificationDueSoonWorker({ sql, databaseUrl, now: () => reconciliationNow });
    const job = {
      data: {
        workspaceId: ids.workspace,
        taskId: ids.workerDueSoonTask,
        dueVersion: 1
      }
    };

    const res1 = await workerHandler(job as never);
    expect(res1).toBe('processed');

    const notifs1 = await sql<{ id: string; type: string; entity_id: string }[]>`
      SELECT id, type, entity_id FROM notifications WHERE entity_id = ${ids.workerDueSoonTask}
    `;
    expect(notifs1).toHaveLength(1);
    expect(notifs1[0].type).toBe('TASK_DUE_SOON');

    // Run again with same payload -> idempotent (no duplicate notification created)
    const res2 = await workerHandler(job as never);
    expect(res2).toBe('processed');

    const notifs2 = await sql<{ id: string }[]>`
      SELECT id FROM notifications WHERE entity_id = ${ids.workerDueSoonTask}
    `;
    expect(notifs2).toHaveLength(1);
  });

  it('reconciliation generates due soon and overdue notifications with ledger entries', async () => {
    const now = reconciliationNow;
    await runReconciliationIteration({
      sql,
      claimSql,
      now,
      batchSize: 50,
      databaseUrl
    });

    // Check due soon task notification
    const dueSoonNotifs = await sql<{ id: string; type: string; user_id: string }[]>`
      SELECT id, type, user_id FROM notifications WHERE entity_id = ${ids.dueSoonTask}
    `;
    expect(dueSoonNotifs).toHaveLength(1);
    expect(dueSoonNotifs[0].type).toBe('TASK_DUE_SOON');
    expect(dueSoonNotifs[0].user_id).toBe(ids.assignee);

    // Check overdue task notification
    const overdueNotifs = await sql<{ id: string; type: string; user_id: string }[]>`
      SELECT id, type, user_id FROM notifications WHERE entity_id = ${ids.overdueTask}
    `;
    expect(overdueNotifs).toHaveLength(1);
    expect(overdueNotifs[0].type).toBe('TASK_OVERDUE');
    expect(overdueNotifs[0].user_id).toBe(ids.assignee);

    // Check completed task has NO notifications
    const completedNotifs = await sql<{ id: string }[]>`
      SELECT id FROM notifications WHERE entity_id = ${ids.completedOverdueTask}
    `;
    expect(completedNotifs).toHaveLength(0);

    // Check notification_dedup_ledger rows
    const ledgers = await sql<{ dedup_key: string }[]>`
      SELECT dedup_key FROM notification_dedup_ledger WHERE workspace_id = ${ids.workspace}
    `;
    const dedupKeys = ledgers.map((l) => l.dedup_key);
    expect(dedupKeys).toContain(`due-soon:${ids.workspace}:${ids.dueSoonTask}:${ids.assignee}:1`);
    expect(dedupKeys).toContain(`overdue:${ids.workspace}:${ids.overdueTask}:${ids.assignee}:1`);

    // Run reconciliation again -> no duplicate notifications created
    await runReconciliationIteration({
      sql,
      claimSql,
      now,
      batchSize: 50,
      databaseUrl
    });

    const dueSoonNotifsAfter = await sql<{ id: string }[]>`
      SELECT id FROM notifications WHERE entity_id = ${ids.dueSoonTask}
    `;
    expect(dueSoonNotifsAfter).toHaveLength(1);

    const overdueNotifsAfter = await sql<{ id: string }[]>`
      SELECT id FROM notifications WHERE entity_id = ${ids.overdueTask}
    `;
    expect(overdueNotifsAfter).toHaveLength(1);
  });
});
