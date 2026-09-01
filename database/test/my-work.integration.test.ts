import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/index.js';
import { getMyWorkSummary } from '../src/my-work.js';

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)('my work integration', () => {
  const { db, sql } = databaseUrl ? createDatabase(databaseUrl) : ({} as any);
  const workspaceId = randomUUID();
  const otherWorkspaceId = randomUUID();
  const userId = randomUUID();
  const otherUserId = randomUUID();
  let workflowId: string;
  let otherWorkflowId: string;
  let activeStatusId: string;
  let cancelledStatusId: string;
  let terminalStatusId: string;
  let otherActiveStatusId: string;

  const cleanup = async () => {
    for (const id of [workspaceId, otherWorkspaceId]) {
      await sql`DELETE FROM task_assignees WHERE task_id IN (SELECT id FROM tasks WHERE workspace_id=${id})`;
      await sql`DELETE FROM tasks WHERE workspace_id=${id}`;
      await sql`DELETE FROM workflow_transitions WHERE workflow_id IN (SELECT id FROM workflows WHERE workspace_id=${id})`;
      await sql`DELETE FROM task_statuses WHERE workflow_id IN (SELECT id FROM workflows WHERE workspace_id=${id})`;
      await sql`DELETE FROM workflows WHERE workspace_id=${id}`;
      await sql`DELETE FROM workspace_memberships WHERE workspace_id=${id}`;
      await sql`DELETE FROM workspaces WHERE id=${id}`;
    }
    await sql`DELETE FROM users WHERE id IN (${userId},${otherUserId})`;
  };

  beforeAll(async () => {
    try {
      await sql`INSERT INTO roles(id,code,name) VALUES(${randomUUID()},'ADMIN','Admin') ON CONFLICT (code) DO NOTHING`;
      const roleId = (await sql<{ id: string }[]>`SELECT id FROM roles WHERE code='ADMIN'`)[0].id;
      await sql`INSERT INTO users(id,email,name) VALUES(${userId},${`my-work-${userId}@test.com`},'My Work'),(${otherUserId},${`other-${otherUserId}@test.com`},'Other')`;
      await sql`INSERT INTO workspaces(id,name,slug,created_by) VALUES(${workspaceId},'My Work',${`my-work-${workspaceId}`},${userId}),(${otherWorkspaceId},'Other',${`other-${otherWorkspaceId}`},${userId})`;
      await sql`INSERT INTO workspace_memberships(workspace_id,user_id,role_id,status) VALUES(${workspaceId},${userId},${roleId},'ACTIVE'),(${workspaceId},${otherUserId},${roleId},'ACTIVE'),(${otherWorkspaceId},${userId},${roleId},'ACTIVE')`;
      workflowId = (await sql<{ id: string }[]>`SELECT id FROM workflows WHERE workspace_id=${workspaceId} LIMIT 1`)[0].id;
      otherWorkflowId = (await sql<{ id: string }[]>`SELECT id FROM workflows WHERE workspace_id=${otherWorkspaceId} LIMIT 1`)[0].id;
      const statuses = await sql<{ id: string; category: string; is_terminal: boolean }[]>`SELECT id,category,is_terminal FROM task_statuses WHERE workflow_id=${workflowId}`;
      activeStatusId = statuses.find((status) => !status.is_terminal)!.id;
      terminalStatusId = statuses.find((status) => status.is_terminal && status.category !== 'CANCELLED')!.id;
      cancelledStatusId = randomUUID();
      await sql`INSERT INTO task_statuses(id,workflow_id,code,name,category,position,is_terminal) VALUES(${cancelledStatusId},${workflowId},${'CANCELLED_MY_WORK'},'Cancelled My Work','CANCELLED',999,true)`;
      otherActiveStatusId = (await sql<{ id: string }[]>`SELECT id FROM task_statuses WHERE workflow_id=${otherWorkflowId} AND NOT is_terminal LIMIT 1`)[0].id;

      const insertTask = async (key: string, dueAt: string, statusId = activeStatusId, owner = userId, workspace = workspaceId, workflow = workflowId, deletedAt: string | null = null) => {
        const id = randomUUID();
        await sql`INSERT INTO tasks(id,workspace_id,task_key,title,workflow_id,status_id,creator_id,due_at,deleted_at) VALUES(${id},${workspace},${key},${key},${workflow},${statusId},${userId},${dueAt},${deletedAt})`;
        await sql`INSERT INTO task_assignees(task_id,user_id,assigned_by) VALUES(${id},${owner},${userId})`;
      };

      await insertTask('TODAY-B', '2026-09-01T10:00:00Z');
      await insertTask('TODAY-A', '2026-09-01T10:00:00Z');
      await insertTask('OVERDUE', '2026-08-31T23:59:59Z');
      await insertTask('EQUAL', '2026-09-01T12:00:00Z');
      await insertTask('TOMORROW', '2026-09-01T17:00:00Z');
      await insertTask('UPCOMING-END', '2026-09-08T16:59:59Z');
      await insertTask('TOO-LATE', '2026-09-08T17:00:00Z');
      await insertTask('CANCELLED', '2026-09-01T11:00:00Z', cancelledStatusId);
      await insertTask('TERMINAL', '2026-09-01T11:00:00Z', terminalStatusId);
      await insertTask('DELETED', '2026-09-01T11:00:00Z', activeStatusId, userId, workspaceId, workflowId, '2026-09-01T00:00:00Z');
      await insertTask('OTHER-USER', '2026-09-01T11:00:00Z', activeStatusId, otherUserId);
      await insertTask('OTHER-WORKSPACE', '2026-09-01T11:00:00Z', otherActiveStatusId, userId, otherWorkspaceId, otherWorkflowId);
    } catch (error) {
      await cleanup();
      throw error;
    }
  });

  afterAll(async () => {
    await cleanup();
    await sql.end();
  });

  it('projects assigned active tasks into timezone-aware, ordered buckets and counts', async () => {
    const result = await getMyWorkSummary(db, { workspaceId, userId, date: '2026-09-01', timezone: 'Asia/Jakarta', now: new Date('2026-09-01T12:00:00Z') });

    expect(result.today.map((task) => task.taskKey)).toEqual(['OVERDUE', 'TODAY-A', 'TODAY-B', 'EQUAL']);
    expect(result.upcoming.map((task) => task.taskKey)).toEqual(['TOMORROW', 'UPCOMING-END']);
    expect(result.overdue.map((task) => task.taskKey)).toEqual(['OVERDUE', 'TODAY-A', 'TODAY-B']);
    expect(result.counts).toEqual({ today: 4, upcoming: 2, overdue: 3 });
  });
});
