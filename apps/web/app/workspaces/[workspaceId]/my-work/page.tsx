'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, ApiError, MyWorkTask } from '../../../../lib/api-client';
import { getCalendarRange, getTodayInTimezone, shiftCalendarDate } from '../../../../lib/calendar-time';
import { useAuth } from '../../../../lib/auth-context';
import { taskRoute } from '../../../../lib/task-route';

type TaskSectionProps = { title: string; tasks: MyWorkTask[]; empty: string; href: string; onOpen: (id: string) => void };
function TaskSection({ title, tasks, empty, href, onOpen }: TaskSectionProps) {
  return <section className="rounded-lg border bg-white p-4 shadow-sm dark:bg-gray-900">
    <div className="mb-3 flex items-center justify-between gap-2"><h3 className="font-semibold">{title} <span className="text-sm text-gray-500">({tasks.length})</span></h3><Link className="text-sm text-blue-600 hover:underline" href={href}>View all {title.toLowerCase()}</Link></div>
    {tasks.length ? <ul className="space-y-2">{tasks.map((task) => <li key={task.id}><button type="button" onClick={() => onOpen(task.id)} className="w-full rounded border p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800"><strong>{task.title}</strong><span className="block text-xs text-gray-500">{task.taskKey} · {task.priority} · {new Date(task.dueAt).toLocaleString()}</span></button></li>)}</ul> : <p className="text-sm text-gray-500">{empty}</p>}
  </section>;
}

export default function MyWorkPage() {
  const { workspaceId } = useParams() as { workspaceId: string };
  const router = useRouter();
  const { user } = useAuth();
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.workspaces.myWork>> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const timezone = result?.meta.timezone || user?.workspaces.find((item) => item.id === workspaceId)?.timezone || user?.timezone || 'UTC';
  const date = getTodayInTimezone(timezone);
  const load = useCallback(async () => { setLoading(true); setError(''); try { setResult(await api.workspaces.myWork(workspaceId, getTodayInTimezone(timezone))); } catch (err) { setError(err instanceof ApiError && err.status === 403 ? 'You do not have permission to view My Work.' : err instanceof Error ? err.message : 'My Work unavailable'); } finally { setLoading(false); } }, [workspaceId, timezone]);
  useEffect(() => { void load(); }, [load]);
  const links = useMemo(() => {
    const today = getCalendarRange('day', date, timezone);
    const upcomingEnd = getCalendarRange('day', shiftCalendarDate('day', shiftCalendarDate('week', date, 1, timezone), 1, timezone), timezone).to;
    return {
      today: `/workspaces/${workspaceId}/tasks?bucket=active&due_from=${encodeURIComponent(today.from)}&due_to=${encodeURIComponent(today.to)}&sort=due_at`,
      upcoming: `/workspaces/${workspaceId}/tasks?bucket=active&due_from=${encodeURIComponent(today.to)}&due_to=${encodeURIComponent(upcomingEnd)}&sort=due_at`,
      overdue: `/workspaces/${workspaceId}/tasks?bucket=active&due_to=${encodeURIComponent(today.from)}&sort=due_at`,
    };
  }, [date, timezone, workspaceId]);
  if (loading) return <p role="status">Loading My Work…</p>;
  if (error) return <div className="space-y-3"><h2 className="text-2xl font-bold">My Work</h2><p role="alert" className="text-red-600">{error}</p><button type="button" onClick={() => void load()} className="rounded border px-3 py-2">Try again</button></div>;
  if (!result) return null;
  const { data, meta } = result;
  return <div className="space-y-4"><div><h2 className="text-2xl font-bold">My Work</h2><p className="text-sm text-gray-500">{meta.date} · {meta.timezone}</p></div><div className="grid gap-4 lg:grid-cols-3"><TaskSection title="Due today" tasks={data.today} empty="No tasks due today." href={links.today} onOpen={(id) => router.push(taskRoute(workspaceId, id))} /><TaskSection title="Upcoming" tasks={data.upcoming} empty="No upcoming tasks." href={links.upcoming} onOpen={(id) => router.push(taskRoute(workspaceId, id))} /><TaskSection title="Overdue" tasks={data.overdue} empty="No overdue tasks." href={links.overdue} onOpen={(id) => router.push(taskRoute(workspaceId, id))} /></div></div>;
}
