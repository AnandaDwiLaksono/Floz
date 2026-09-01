import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';
import type { DatabaseClient } from './index.js';
import { buildOperationalActivePredicate } from './reporting-core.js';
import { taskAssignees, taskStatuses, tasks } from './schema.js';

export type MyWorkSummaryInput = { workspaceId: string; userId: string; date: string; timezone: string; now: Date };
type MyWorkTask = { id: string; taskKey: string; title: string; dueAt: Date; priority: string };
export type MyWorkSummary = { today: MyWorkTask[]; upcoming: MyWorkTask[]; overdue: MyWorkTask[]; counts: { today: number; upcoming: number; overdue: number } };

export async function getMyWorkSummary(db: DatabaseClient, { workspaceId, userId, date, timezone, now }: MyWorkSummaryInput): Promise<MyWorkSummary> {
  const dayStart = sql`${date}::date::timestamp AT TIME ZONE ${timezone}`;
  const nextDayStart = sql`(${dayStart} + interval '1 day')`;
  const upcomingEnd = sql`(${nextDayStart} + interval '7 days')`;
  const base = and(eq(tasks.workspaceId, workspaceId), eq(taskAssignees.userId, userId), buildOperationalActivePredicate());
  const select = (duePredicate: ReturnType<typeof and>) => db.select({ id: tasks.id, taskKey: tasks.taskKey, title: tasks.title, dueAt: tasks.dueAt, priority: tasks.priority }).from(tasks).innerJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id)).innerJoin(taskStatuses, eq(taskStatuses.id, tasks.statusId)).where(and(base, duePredicate)).orderBy(asc(tasks.dueAt), asc(tasks.taskKey), asc(tasks.id));
  const [today, upcoming, overdue] = await Promise.all([
    select(and(gte(tasks.dueAt, dayStart), lt(tasks.dueAt, nextDayStart))),
    select(and(gte(tasks.dueAt, nextDayStart), lt(tasks.dueAt, upcomingEnd))),
    select(lt(tasks.dueAt, now))
  ]);
  return { today: today as MyWorkTask[], upcoming: upcoming as MyWorkTask[], overdue: overdue as MyWorkTask[], counts: { today: today.length, upcoming: upcoming.length, overdue: overdue.length } };
}
