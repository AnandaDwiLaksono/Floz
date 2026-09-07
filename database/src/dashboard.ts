import { sql, type SQL } from 'drizzle-orm';
import type { DatabaseClient } from './index.js';
import { getKpis, type Kpis, type ReportingScope } from './kpis.js';
import { ascPriorityRank } from './reporting-core.js';

export type DashboardInput = ReportingScope & { userId: string };
type CountRow = { key: string | null; count: number };
export type AssigneeCount = { userId: string | null; name: string | null; count: number };
export type StatusCount = CountRow & { position: number; id: string };
export type Dashboard = { kpis: Kpis; workload_by_team: CountRow[]; workload_by_assignee: AssigneeCount[]; unassigned: number; status_breakdown: StatusCount[]; priority_breakdown: CountRow[]; pending_approvals?: number; drilldown_url?: string };

async function project(db: DatabaseClient, scope: ReportingScope, predicate: SQL): Promise<Omit<Dashboard, 'kpis' | 'pending_approvals' | 'drilldown_url'>> {
  const scoped = sql`
    WITH scoped AS (
      SELECT tasks.id, tasks.team_id, tasks.priority, task_statuses.id AS status_id, task_statuses.category, task_statuses.position, task_statuses.is_terminal = false AS is_active
      FROM tasks JOIN task_statuses ON task_statuses.id = tasks.status_id
      WHERE tasks.workspace_id = ${scope.workspaceId} AND tasks.deleted_at IS NULL AND task_statuses.category <> 'CANCELLED' AND ${predicate}
    )`;
  const [teamRows, assigneeRows, statusRows, priorityRows] = await Promise.all([
    db.execute(sql`${scoped}
      SELECT key, count(*)::int AS count
      FROM (
        SELECT CASE WHEN scoped.team_id IS NULL THEN 'UNASSIGNED' ELSE teams.name END AS key, CASE WHEN scoped.team_id IS NULL THEN 1 ELSE 0 END AS sort_null
        FROM scoped LEFT JOIN teams ON teams.id = scoped.team_id
        WHERE scoped.is_active AND (scoped.team_id IS NULL OR teams.is_active = true)
      ) grouped
      GROUP BY key, sort_null
      ORDER BY sort_null, key`),
    db.execute(sql`${scoped}
      SELECT task_assignees.user_id AS user_id, users.name AS name, count(DISTINCT scoped.id)::int AS count
      FROM scoped JOIN task_assignees ON task_assignees.task_id = scoped.id JOIN users ON users.id = task_assignees.user_id
      WHERE scoped.is_active GROUP BY task_assignees.user_id, users.name
      UNION ALL
      SELECT NULL AS user_id, NULL AS name, count(*)::int AS count
      FROM scoped WHERE scoped.is_active AND NOT EXISTS (SELECT 1 FROM task_assignees WHERE task_assignees.task_id = scoped.id)
      ORDER BY user_id NULLS LAST, name NULLS LAST`),
    db.execute(sql`${scoped}
      SELECT category AS key, position, status_id AS id, count(*)::int AS count
      FROM scoped GROUP BY category, position, status_id ORDER BY position, status_id`),
    db.execute(sql`${scoped}
      SELECT priority AS key, count(*)::int AS count
      FROM scoped GROUP BY priority`)
  ]);
  const workload_by_assignee = (assigneeRows as unknown as Array<{ user_id: string | null; name: string | null; count: number }>).map((row) => ({ userId: row.user_id, name: row.name, count: Number(row.count) }));
  return {
    workload_by_team: (teamRows as unknown as CountRow[]).map((row) => ({ key: row.key, count: Number(row.count) })),
    workload_by_assignee,
    unassigned: workload_by_assignee.find((row) => row.userId === null)?.count ?? 0,
    status_breakdown: (statusRows as unknown as Array<{ key: string; position: number; id: string; count: number }>).map((row) => ({ key: row.key, position: Number(row.position), id: row.id, count: Number(row.count) })),
    priority_breakdown: (priorityRows as unknown as CountRow[]).map((row) => ({ key: row.key, count: Number(row.count) })).sort((a, b) => ascPriorityRank(a.key ?? '') - ascPriorityRank(b.key ?? ''))
  };
}

export async function getMemberDashboard(db: DatabaseClient, input: DashboardInput): Promise<Dashboard> {
  const predicate = sql`EXISTS (SELECT 1 FROM task_assignees WHERE task_assignees.task_id = tasks.id AND task_assignees.user_id = ${input.userId})`;
  const [kpis, projection] = await Promise.all([getKpis(db, input), project(db, input, predicate)]);
  return { kpis, ...projection };
}

export async function getManagerDashboard(db: DatabaseClient, input: DashboardInput): Promise<Dashboard> {
  const admin = await db.execute(sql`SELECT 1 FROM workspace_memberships JOIN roles ON roles.id = workspace_memberships.role_id WHERE workspace_id = ${input.workspaceId} AND user_id = ${input.userId} AND status = 'ACTIVE' AND roles.code = 'ADMIN'`);
  if (admin.length) {
    const predicate = input.teamIds ? input.teamIds.length ? sql`tasks.team_id IN ${sql`(${sql.join(input.teamIds.map((id) => sql`${id}`), sql`, `)})`}` : sql`false` : sql`true`;
    
    // pending approvals for ADMIN: all workspace pending steps, optionally filtered by team_id
    const approvalsPredicate = input.teamIds && input.teamIds.length 
      ? sql`EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.user_id = approval_steps.approver_user_id AND tm.team_id IN ${sql`(${sql.join(input.teamIds.map((id) => sql`${id}`), sql`, `)})`})` 
      : sql`true`;
    const pendingApprovalsRows = await db.execute(sql`SELECT COUNT(DISTINCT approval_steps.id)::int AS count FROM approval_steps WHERE workspace_id = ${input.workspaceId} AND status = 'PENDING' AND ${approvalsPredicate}`);
    const pending_approvals = Number((pendingApprovalsRows[0] as unknown as { count: number }).count);
    
    const [kpis, projection] = await Promise.all([getKpis(db, { ...input, userId: undefined }), project(db, input, predicate)]);
    return { kpis, ...projection, pending_approvals };
  }
  const teamIds = await db.execute(sql`SELECT id FROM teams WHERE workspace_id = ${input.workspaceId} AND manager_user_id = ${input.userId} AND is_active = true`);
  const managed = (teamIds as unknown as Array<{ id: string }>).map(({ id }) => id);
  const ids = input.teamIds ? input.teamIds.filter((id) => managed.includes(id)) : managed;
  const predicate = ids.length ? sql`tasks.team_id IN ${sql`(${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`}` : sql`false`;
  
  // pending approvals for MANAGER: assigned directly to manager OR assigned to effective members of teams canonically managed
  const approvalsPredicate = ids.length 
    ? sql`(approval_steps.approver_user_id = ${input.userId} OR EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.user_id = approval_steps.approver_user_id AND tm.team_id IN ${sql`(${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`}))`
    : sql`approval_steps.approver_user_id = ${input.userId}`;
  const pendingApprovalsRows = await db.execute(sql`SELECT COUNT(DISTINCT approval_steps.id)::int AS count FROM approval_steps WHERE workspace_id = ${input.workspaceId} AND status = 'PENDING' AND ${approvalsPredicate}`);
  const pending_approvals = Number((pendingApprovalsRows[0] as unknown as { count: number }).count);
  
  const [kpis, projection] = await Promise.all([getKpis(db, { ...input, teamIds: ids }), project(db, input, predicate)]);
  return { kpis, ...projection, pending_approvals };
}
