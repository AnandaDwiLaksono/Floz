import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, getManagerDashboard, getMemberDashboard } from '../src/index.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/floz';

describe('dashboard integration', () => {
  const { db, sql } = createDatabase(databaseUrl);
  const workspaceId = randomUUID(), otherWorkspaceId = randomUUID();
  const memberId = randomUUID(), managerId = randomUUID(), adminId = randomUUID(), outsiderId = randomUUID();
  const activeTeamId = randomUUID(), inactiveTeamId = randomUUID(), unmanagedTeamId = randomUUID();
  let workflowId: string, activeStatusId: string, completedStatusId: string;

  beforeAll(async () => {
    await sql`INSERT INTO roles(id,code,name) VALUES(${randomUUID()},'ADMIN','Admin'),(${randomUUID()},'MANAGER','Manager'),(${randomUUID()},'MEMBER','Member') ON CONFLICT (code) DO NOTHING`;
    const roles = await sql<{ id: string; code: string }[]>`SELECT id,code FROM roles WHERE code IN ('ADMIN','MANAGER','MEMBER')`;
    const role = (code: string) => roles.find((row) => row.code === code)!.id;
    await sql`INSERT INTO users(id,email,name) VALUES(${memberId},${`member-${memberId}@test`},'Member'),(${managerId},${`manager-${managerId}@test`},'Manager'),(${adminId},${`admin-${adminId}@test`},'Admin'),(${outsiderId},${`outsider-${outsiderId}@test`},'Outside')`;
    await sql`INSERT INTO workspaces(id,name,slug,created_by) VALUES(${workspaceId},'Dashboard',${`dashboard-${workspaceId}`},${adminId}),(${otherWorkspaceId},'Other',${`other-${otherWorkspaceId}`},${adminId})`;
    await sql`INSERT INTO workspace_memberships(workspace_id,user_id,role_id,status) VALUES(${workspaceId},${memberId},${role('MEMBER')},'ACTIVE'),(${workspaceId},${managerId},${role('MANAGER')},'ACTIVE'),(${workspaceId},${adminId},${role('ADMIN')},'ACTIVE'),(${workspaceId},${outsiderId},${role('MEMBER')},'ACTIVE')`;
    await sql`INSERT INTO teams(id,workspace_id,name,manager_user_id,is_active) VALUES(${activeTeamId},${workspaceId},'Active',${managerId},true),(${inactiveTeamId},${workspaceId},'Inactive',${managerId},false),(${unmanagedTeamId},${workspaceId},'Unmanaged',${adminId},true)`;
    workflowId = (await sql<{ id: string }[]>`SELECT id FROM workflows WHERE workspace_id=${workspaceId} LIMIT 1`)[0].id;
    activeStatusId = (await sql<{ id: string }[]>`SELECT id FROM task_statuses WHERE workflow_id=${workflowId} AND is_terminal=false LIMIT 1`)[0].id;
    completedStatusId = randomUUID();
    await sql`INSERT INTO task_statuses(id,workflow_id,code,name,category,position,is_terminal) VALUES(${completedStatusId},${workflowId},'DASHBOARD_COMPLETED','Dashboard Completed','COMPLETED',999,true)`;
    const add = async (key: string, statusId: string, priority: string, teamId: string | null, assignees: string[]) => {
      const id = randomUUID();
      await sql`INSERT INTO tasks(id,workspace_id,task_key,title,workflow_id,status_id,priority,team_id,creator_id,due_at,completed_at) VALUES(${id},${workspaceId},${key},${key},${workflowId},${statusId},${priority},${teamId},${adminId},'2026-09-05T00:00:00Z',${statusId === completedStatusId ? '2026-09-04T00:00:00Z' : null})`;
      for (const userId of assignees) await sql`INSERT INTO task_assignees(task_id,user_id,assigned_by) VALUES(${id},${userId},${adminId})`;
    };
    await add('MEMBER-DONE', completedStatusId, 'LOW', activeTeamId, [memberId]);
    await add('TEAM-OUTSIDE', activeStatusId, 'URGENT', activeTeamId, [outsiderId]);
    await add('TEAM-UNASSIGNED', activeStatusId, 'HIGH', activeTeamId, []);
    await add('INACTIVE', activeStatusId, 'MEDIUM', inactiveTeamId, [memberId]);
    await add('UNMANAGED', activeStatusId, 'LOW', unmanagedTeamId, [memberId]);
    await add('NO-TEAM', activeStatusId, 'MEDIUM', null, []);
  });

  afterAll(async () => {
    await sql`DELETE FROM task_assignees WHERE task_id IN (SELECT id FROM tasks WHERE workspace_id=${workspaceId})`;
    await sql`DELETE FROM tasks WHERE workspace_id=${workspaceId}`;
    await sql`DELETE FROM workflow_transitions WHERE workflow_id IN (SELECT id FROM workflows WHERE workspace_id IN (${workspaceId},${otherWorkspaceId}))`;
    await sql`DELETE FROM task_statuses WHERE workflow_id IN (SELECT id FROM workflows WHERE workspace_id IN (${workspaceId},${otherWorkspaceId}))`;
    await sql`DELETE FROM workflows WHERE workspace_id IN (${workspaceId},${otherWorkspaceId})`;
    await sql`DELETE FROM team_memberships WHERE team_id IN (${activeTeamId},${inactiveTeamId},${unmanagedTeamId})`;
    await sql`DELETE FROM teams WHERE workspace_id=${workspaceId}`;
    await sql`DELETE FROM workspace_memberships WHERE workspace_id IN (${workspaceId},${otherWorkspaceId})`;
    await sql`DELETE FROM workspaces WHERE id IN (${workspaceId},${otherWorkspaceId})`;
    await sql`DELETE FROM users WHERE id IN (${memberId},${managerId},${adminId},${outsiderId})`;
    await sql.end();
  });

  const input = (userId: string) => ({ workspaceId, userId, from: '2026-09-01T00:00:00Z', to: '2026-09-10T00:00:00Z', evaluationAt: new Date('2026-09-10T00:00:00Z'), timezone: 'UTC' });

  it('includes completed assigned work in member scope', async () => {
    const result = await getMemberDashboard(db, input(memberId));
    expect(result.kpis.denominators.due).toBe(3);
    expect(result.status_breakdown).toContainEqual(expect.objectContaining({ key: 'COMPLETED', count: 1 }));
  });

  it('projects only active managed teams while retaining outside assignees and unassigned workload', async () => {
    const result = await getManagerDashboard(db, input(managerId));
    expect(result.workload_by_team).toEqual([{ key: 'Active', count: 2 }]);
    expect(result.workload_by_assignee).toContainEqual({ key: 'Outside', count: 1 });
    expect(result.workload_by_assignee).toContainEqual({ key: 'UNASSIGNED', count: 1 });
    expect(result.unassigned).toBe(1);
    expect(result.priority_breakdown.map((row) => row.key)).toEqual(['URGENT', 'HIGH', 'LOW']);
    expect(result).not.toHaveProperty('pending_approvals');
  });

  it('projects the full workspace for admins including active unassigned teams and tasks', async () => {
    const result = await getManagerDashboard(db, input(adminId));
    expect(result.workload_by_team).toEqual(expect.arrayContaining([{ key: 'UNASSIGNED', count: 1 }, { key: 'Unmanaged', count: 1 }]));
    expect(result.kpis.denominators.due).toBe(6);
  });
});
