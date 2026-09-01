import { and, asc, eq, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { taskStatuses, tasks } from './schema.js';

export const PRIORITY_RANK = { URGENT: 1, HIGH: 2, MEDIUM: 3, LOW: 4 } as const;
export type TaskPriority = keyof typeof PRIORITY_RANK;
export type ReportingIntervalInput = { from?: string; to?: string };
export type ReportingPeriod = { from: Date; to: Date; evaluationAt?: Date };

export function buildOperationalActivePredicate(): SQL {
  return and(isNull(tasks.deletedAt), eq(taskStatuses.isTerminal, false))!;
}

export function buildKpiEligiblePredicate(): SQL {
  return and(isNull(tasks.deletedAt), ne(taskStatuses.category, 'CANCELLED'))!;
}

export const priorityRankSql = sql<number>`CASE ${tasks.priority} WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 ELSE 5 END`;
export const priorityOrder = asc(priorityRankSql);

export function ascPriorityRank(priority: string): number {
  return PRIORITY_RANK[priority as TaskPriority] ?? 5;
}

const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export function parseReportingInterval(input: ReportingIntervalInput): ReportingPeriod {
  if (!input.from || !input.to || !isoTimestamp.test(input.from) || !isoTimestamp.test(input.to)) throw new Error('INVALID_REPORTING_INTERVAL');
  const from = new Date(input.from);
  const to = new Date(input.to);
  if (from >= to) throw new Error('INVALID_REPORTING_INTERVAL');
  return { from, to };
}

function localParts(instant: Date, timezone: string) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timezone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(instant).map((part) => [part.type, Number(part.value)]));
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute, second: values.second };
}

function fromLocal(year: number, month: number, day: number, timezone: string): Date {
  const guess = new Date(Date.UTC(year, month - 1, day));
  const local = localParts(guess, timezone);
  return new Date(guess.getTime() - (Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - guess.getTime()));
}

export function getMtdPeriod(evaluationAt: Date, timezone: string): ReportingPeriod & { evaluationAt: Date } {
  const local = localParts(evaluationAt, timezone);
  return { from: fromLocal(local.year, local.month, 1, timezone), to: evaluationAt, evaluationAt };
}

export function getUpcomingBounds(evaluationAt: Date, timezone: string): { from: Date } {
  const local = localParts(evaluationAt, timezone);
  const tomorrow = new Date(Date.UTC(local.year, local.month - 1, local.day + 1));
  return { from: fromLocal(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), timezone) };
}

export function isUpcoming(dueAt: Date, evaluationAt: Date, timezone: string): boolean {
  return dueAt >= getUpcomingBounds(evaluationAt, timezone).from;
}

export function isOverdue(dueAt: Date, evaluationAt: Date): boolean {
  return dueAt < evaluationAt;
}
