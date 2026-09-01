import { sql, type SQL } from 'drizzle-orm';
import type { DatabaseClient } from './index.js';
import { getKpis, type Kpis, type ReportingScope } from './kpis.js';

export type DashboardInput = Omit<ReportingScope, 'userId' | 'teamIds'> & { userId: string };
type CountRow = { key: string | null; count: number };
export type Dashboard = { kpis: Kpis; workload_by_team: CountRow[]; workload_by_assignee: CountRow[]; unassigned: number; status_breakdown: CountRow[]; priority_breakdown: CountRow[] };

async function project(db: DatabaseClient, scope: ReportingScope, predicate: SQL): Promise<Omit<Dashboard, 'kpis'>> {
  const rows = await db.execute(sql`
    WITH scoped AS (
      SELECT tasks.id, tasks.team_id, tasks.priority, task_statuses.category, task_statuses.is_terminal = false AS is_active
      FROM tasks JOIN task_statuses ON task_statuses.id = tasks.status_id
      WHERE tasks.workspace_id = ${scope.workspaceId} AND tasks.deleted_at IS NULL AND task_statuses.category <> 'CANCELLED' AND ${predicate}
    ), assignees AS (SELECT scoped.id, scoped.is_active, task_assignees.user_id FROM scoped LEFT JOIN task_assignees ON task_assignees.task_id = scoped.id)
    SELECT 'team' AS kind, CASE WHEN scoped.team_id IS NULL THEN 'UNASSIGNED' ELSE teams.name END AS key, count(DISTINCT scoped.id)::int AS count FROM scoped LEFT JOIN teams ON teams.id = scoped.team_id WHERE scoped.is_active AND (scoped.team_id IS NULL OR teams.is_active = true) GROUP BY CASE WHEN scoped.team_id IS NULL THEN 'UNASSIGNED' ELSE teams.name END
    UNION ALL SELECT 'assignee', coalesce(users.name, 'UNASSIGNED'), count(*)::int FROM assignees LEFT JOIN users ON users.id = assignees.user_id WHERE assignees.is_active GROUP BY users.name
    UNION ALL SELECT 'status', category, count(*)::int FROM scoped GROUP BY category
    UNION ALL SELECT 'priority', priority, count(*)::int FROM scoped GROUP BY priority`);
  const result = { workload_by_team: [] as CountRow[], workload_by_assignee: [] as CountRow[], unassigned: 0, status_breakdown: [] as CountRow[], priority_breakdown: [] as CountRow[] };
  for (const row of rows as unknown as Array<CountRow & { kind: string }>) {
    const value = { key: row.key!, count: Number(row.count) };
    if (row.kind === 'team') result.workload_by_team.push(value);
    if (row.kind === 'assignee') { result.workload_by_assignee.push(value); if (row.key === 'UNASSIGNED') result.unassigned = value.count; }
    if (row.kind === 'status') result.status_breakdown.push(value);
    if (row.kind === 'priority') result.priority_breakdown.push(value);
  }
  result.priority_breakdown.sort((a, b) => ({ URGENT: 1, HIGH: 2, MEDIUM: 3, LOW: 4 }[a.key ?? ''] ?? 5) - ({ URGENT: 1, HIGH: 2, MEDIUM: 3, LOW: 4 }[b.key ?? ''] ?? 5));
  return result;
}

export async function getMemberDashboard(db: DatabaseClient, input: DashboardInput): Promise<Dashboard> {
  const predicate = sql`EXISTS (SELECT 1 FROM task_assignees WHERE task_assignees.task_id = tasks.id AND task_assignees.user_id = ${input.userId})`;
  const [kpis, projection] = await Promise.all([getKpis(db, input), project(db, input, predicate)]);
  return { kpis, ...projection };
}

export async function getManagerDashboard(db: DatabaseClient, input: DashboardInput): Promise<Dashboard> {
  const admin = await db.execute(sql`SELECT 1 FROM workspace_memberships JOIN roles ON roles.id = workspace_memberships.role_id WHERE workspace_id = ${input.workspaceId} AND user_id = ${input.userId} AND status = 'ACTIVE' AND roles.code = 'ADMIN'`);
  if (admin.length) {
    const [kpis, projection] = await Promise.all([getKpis(db, { ...input, userId: undefined }), project(db, input, sql`true`)]);
    return { kpis, ...projection };
  }
  const teamIds = await db.execute(sql`SELECT id FROM teams WHERE workspace_id = ${input.workspaceId} AND manager_user_id = ${input.userId} AND is_active = true`);
  const ids = (teamIds as unknown as Array<{ id: string }>).map(({ id }) => id);
  const predicate = ids.length ? sql`tasks.team_id IN ${sql`(${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`}` : sql`false`;
  const [kpis, projection] = await Promise.all([getKpis(db, { ...input, teamIds: ids }), project(db, input, predicate)]);
  return { kpis, ...projection };
}
