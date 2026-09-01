import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, getKpis, type ReportingScope } from '../src/index.js';

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)('kpis integration', () => {
  const { db, sql } = databaseUrl ? createDatabase(databaseUrl) : ({} as any);
  const workspaceId = randomUUID();
  const userId = randomUUID();
  let workflowId: string;
  let activeStatusId: string;
  let completedStatusId: string;
  let cancelledStatusId: string;
  const ids: string[] = [];

  beforeAll(async () => {
    await sql`INSERT INTO roles(id,code,name) VALUES(${randomUUID()},'ADMIN',${'KPI Admin'}) ON CONFLICT (code) DO NOTHING`;
    const roleId = (await sql<{ id: string }[]>`SELECT id FROM roles WHERE code='ADMIN'`)[0].id;
    await sql`INSERT INTO users(id,email,name) VALUES(${userId},${`kpi-${userId}@test.com`},'KPI')`;
    await sql`INSERT INTO workspaces(id,name,slug,created_by) VALUES(${workspaceId},'KPI',${`kpi-${workspaceId}`},${userId})`;
    await sql`INSERT INTO workspace_memberships(workspace_id,user_id,role_id,status) VALUES(${workspaceId},${userId},${roleId},'ACTIVE')`;
    workflowId = (await sql<{ id: string }[]>`SELECT id FROM workflows WHERE workspace_id=${workspaceId} LIMIT 1`)[0].id;
    const statuses = await sql<{ id: string; category: string; is_terminal: boolean }[]>`SELECT id,category,is_terminal FROM task_statuses WHERE workflow_id=${workflowId}`;
    activeStatusId = statuses.find((s) => !s.is_terminal)!.id;
    completedStatusId = randomUUID();
    cancelledStatusId = randomUUID();
    await sql`INSERT INTO task_statuses(id,workflow_id,code,name,category,position,is_terminal) VALUES(${completedStatusId},${workflowId},'KPI_COMPLETED','Completed','COMPLETED',998,true),(${cancelledStatusId},${workflowId},'KPI_CANCELLED','Cancelled','CANCELLED',999,false)`;
    const add = async (key: string, due: string, created: string, completed: string | null, status = activeStatusId) => {
      const id = randomUUID(); ids.push(id);
      await sql`INSERT INTO tasks(id,workspace_id,task_key,title,workflow_id,status_id,creator_id,due_at,created_at,completed_at) VALUES(${id},${workspaceId},${key},${key},${workflowId},${status},${userId},${due},${created},${completed})`;
    };
    await add('DONE', '2026-09-09T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-03T00:00:00Z', completedStatusId);
    await add('LATE', '2026-09-04T00:00:00Z', '2026-09-02T00:00:00Z', '2026-09-05T00:00:00Z', completedStatusId);
    await add('OPEN', '2026-09-06T00:00:00Z', '2026-09-02T00:00:00Z', null);
    await add('FUTURE', '2026-09-20T00:00:00Z', '2026-09-02T00:00:00Z', null);
    await add('EQUAL', '2026-09-10T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-10T00:00:00Z', completedStatusId);
    await add('CANCELLED', '2026-09-04T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z', cancelledStatusId);
  });

  afterAll(async () => {
    await sql`DELETE FROM tasks WHERE workspace_id=${workspaceId}`;
    await sql`DELETE FROM workflow_transitions WHERE workflow_id=${workflowId}`;
    await sql`DELETE FROM task_statuses WHERE workflow_id=${workflowId}`;
    await sql`DELETE FROM workflows WHERE id=${workflowId}`;
    await sql`DELETE FROM workspace_memberships WHERE workspace_id=${workspaceId}`;
    await sql`DELETE FROM workspaces WHERE id=${workspaceId}`;
    await sql`DELETE FROM users WHERE id=${userId}`;
    await sql.end();
  });

  it('computes custom half-open KPIs from current due dates and completion timestamps', async () => {
    const scope: ReportingScope = { workspaceId, from: '2026-09-01T00:00:00Z', to: '2026-09-10T00:00:00Z', evaluationAt: new Date('2026-09-10T00:00:00Z'), timezone: 'UTC' };
    const result = await getKpis(db, scope);
    expect(result.denominators).toEqual({ due: 3, completed: 2, overdue: 3, onTime: 1 });
    expect(result.completion_rate).toBe('0.666667');
    expect(result.overdue_rate).toBe('1.000000');
    expect(result.on_time_completion_rate).toBe('0.500000');
    expect(result.average_completion_time_seconds).toBe('216000');
    expect(result.workload).toBe(2);
  });

  it('uses MTD cutoff and excludes due work after evaluationAt', async () => {
    const result = await getKpis(db, { workspaceId, period: 'MTD', evaluationAt: new Date('2026-09-05T00:00:00Z'), timezone: 'UTC' });
    expect(result.denominators.due).toBe(1);
    expect(result.denominators.completed).toBe(1);
  });

  it('reflects live reopen and reschedule mutations', async () => {
    await sql`UPDATE tasks SET completed_at=NULL,status_id=${activeStatusId},due_at='2026-09-12T00:00:00Z' WHERE task_key='DONE' AND workspace_id=${workspaceId}`;
    const result = await getKpis(db, { workspaceId, from: '2026-09-01T00:00:00Z', to: '2026-09-10T00:00:00Z', evaluationAt: new Date('2026-09-10T00:00:00Z'), timezone: 'UTC' });
    expect(result.denominators).toEqual({ due: 2, completed: 1, overdue: 2, onTime: 0 });
  });
});
