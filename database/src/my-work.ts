import { and, asc, eq, gte, lt, ne, sql } from 'drizzle-orm';
import type { DatabaseClient } from './index.js';
import { buildOperationalActivePredicate } from './reporting-core.js';
import { taskAssignees, taskStatuses, tasks } from './schema.js';

export type MyWorkSummaryInput = { workspaceId: string; userId: string; date: string; timezone: string };
type MyWorkTask = { id: string; taskKey: string; title: string; dueAt: Date; priority: string; status: { id: string; code: string; name: string; category: string; is_active: boolean } };
export type MyWorkSummary = { today: MyWorkTask[]; upcoming: MyWorkTask[]; overdue: MyWorkTask[]; counts: { today: number; upcoming: number; overdue: number } };

export async function getMyWorkSummary(db: DatabaseClient, { workspaceId, userId, date, timezone }: MyWorkSummaryInput): Promise<MyWorkSummary> {
  const dayStart = sql`${date}::date::timestamp AT TIME ZONE ${timezone}`;
  const nextDayStart = sql`(${date}::date + interval '1 day')::timestamp AT TIME ZONE ${timezone}`;
  const upcomingEnd = sql`(${date}::date + interval '8 days')::timestamp AT TIME ZONE ${timezone}`;
  const base = and(eq(tasks.workspaceId, workspaceId), eq(taskAssignees.userId, userId), ne(taskStatuses.category, 'CANCELLED'), buildOperationalActivePredicate());
  const select = (duePredicate: ReturnType<typeof and>) => db.select({ id: tasks.id, taskKey: tasks.taskKey, title: tasks.title, dueAt: tasks.dueAt, priority: tasks.priority, status: { id: taskStatuses.id, code: taskStatuses.code, name: taskStatuses.name, category: taskStatuses.category, is_active: taskStatuses.isActive } }).from(tasks).innerJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id)).innerJoin(taskStatuses, eq(taskStatuses.id, tasks.statusId)).where(and(base, duePredicate)).orderBy(asc(tasks.dueAt), asc(tasks.taskKey), asc(tasks.id));
  const [today, upcoming, overdue] = await Promise.all([
    select(and(gte(tasks.dueAt, dayStart), lt(tasks.dueAt, nextDayStart))),
    select(and(gte(tasks.dueAt, nextDayStart), lt(tasks.dueAt, upcomingEnd))),
    select(lt(tasks.dueAt, dayStart))
  ]);
  return { today: today as MyWorkTask[], upcoming: upcoming as MyWorkTask[], overdue: overdue as MyWorkTask[], counts: { today: today.length, upcoming: upcoming.length, overdue: overdue.length } };
}
