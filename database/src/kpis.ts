import { sql, type SQL } from 'drizzle-orm';
import type { DatabaseClient } from './index.js';
import { buildKpiEligiblePredicate, buildOperationalActivePredicate, getMtdPeriod, parseReportingInterval } from './reporting-core.js';

export type ReportingScope = { workspaceId: string; from?: string; to?: string; period?: 'MTD'; evaluationAt: Date; timezone: string };
type KpiRow = { due: number; completed: number; overdue: number; on_time: number; average_seconds: string | number; workload: number };

export type Kpis = {
  completion_rate: string;
  overdue_rate: string;
  on_time_completion_rate: string;
  average_completion_time_seconds: string;
  workload: number;
  denominators: { due: number; completed: number; overdue: number; onTime: number };
  period: { from: Date; to: Date; evaluationAt: Date };
  filters: { deleted: 'NULL'; category: 'NOT_CANCELLED'; due: 'CURRENT_DUE_AT'; completion: 'CURRENT_COMPLETED_AT' };
};

const rate = (numerator: number, denominator: number) => denominator ? (numerator / denominator).toFixed(6) : '0.000000';

export async function getKpis(db: DatabaseClient, scope: ReportingScope): Promise<Kpis> {
  const requested = scope.period === 'MTD' ? getMtdPeriod(scope.evaluationAt, scope.timezone) : { ...parseReportingInterval({ from: scope.from, to: scope.to }), evaluationAt: scope.evaluationAt };
  const period = { ...requested, to: requested.to < scope.evaluationAt ? requested.to : scope.evaluationAt };
  const eligible = buildKpiEligiblePredicate();
  const operational = buildOperationalActivePredicate();
  const from = period.from.toISOString(), to = period.to.toISOString(), evaluationAt = scope.evaluationAt.toISOString();
  const rows = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE tasks.due_at >= ${from} AND tasks.due_at < ${to})::int AS due,
      count(*) FILTER (WHERE tasks.due_at >= ${from} AND tasks.due_at < ${to} AND tasks.completed_at IS NOT NULL AND tasks.completed_at <= ${evaluationAt})::int AS completed,
      count(*) FILTER (WHERE tasks.due_at >= ${from} AND tasks.due_at < ${to} AND tasks.due_at < ${evaluationAt} AND (tasks.completed_at IS NULL OR tasks.completed_at > ${evaluationAt}))::int AS overdue,
      count(*) FILTER (WHERE tasks.due_at >= ${from} AND tasks.due_at < ${to} AND tasks.completed_at IS NOT NULL AND tasks.completed_at <= ${evaluationAt} AND tasks.completed_at <= tasks.due_at)::int AS on_time,
      coalesce(avg(extract(epoch from (tasks.completed_at - tasks.created_at))) FILTER (WHERE tasks.completed_at IS NOT NULL AND tasks.completed_at <= ${evaluationAt} AND tasks.due_at >= ${from} AND tasks.due_at < ${to}), 0)::numeric AS average_seconds,
      count(*) FILTER (WHERE ${operational})::int AS workload
    FROM tasks JOIN task_statuses ON task_statuses.id = tasks.status_id
    WHERE tasks.workspace_id = ${scope.workspaceId} AND ${eligible}` as SQL);
  const row = rows[0] as unknown as KpiRow;
  const due = Number(row.due), completed = Number(row.completed), overdue = Number(row.overdue), onTime = Number(row.on_time);
  return { completion_rate: rate(completed, due), overdue_rate: rate(overdue, due), on_time_completion_rate: rate(onTime, completed), average_completion_time_seconds: Number(row.average_seconds).toString(), workload: Number(row.workload), denominators: { due, completed, overdue, onTime }, period, filters: { deleted: 'NULL', category: 'NOT_CANCELLED', due: 'CURRENT_DUE_AT', completion: 'CURRENT_COMPLETED_AT' } };
}
