'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, ApiError, MyWorkSummary } from '../../../../lib/api-client';
import { taskRoute } from '../../../../lib/task-route';

type WorkTask = { id: string; taskKey: string; title: string; dueAt: string; priority: string };
const today = new Date().toISOString().slice(0, 10);

function TaskSection({ title, tasks, empty, href, onOpen }: { title: string; tasks: WorkTask[]; empty: string; href: string; onOpen: (id: string) => void }) {
  return <section className="rounded-lg border bg-white p-4 shadow-sm dark:bg-gray-900">
    <div className="mb-3 flex items-center justify-between gap-2"><h3 className="font-semibold">{title} <span className="text-sm text-gray-500">({tasks.length})</span></h3><Link className="text-sm text-blue-600 hover:underline" href={href}>View all {title.toLowerCase()}</Link></div>
    {tasks.length ? <ul className="space-y-2">{tasks.map((task) => <li key={task.id}><button type="button" onClick={() => onOpen(task.id)} className="w-full rounded border p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800"><strong>{task.title}</strong><span className="block text-xs text-gray-500">{task.taskKey} · {task.priority} · {new Date(task.dueAt).toLocaleString()}</span></button></li>)}</ul> : <p className="text-sm text-gray-500">{empty}</p>}
  </section>;
}

export default function MyWorkPage() {
  const { workspaceId } = useParams() as { workspaceId: string };
  const router = useRouter();
  const [result, setResult] = useState<{ data: MyWorkSummary; meta: { date: string; timezone: string } } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = async () => { setLoading(true); setError(''); try { setResult(await api.workspaces.myWork(workspaceId, today)); } catch (err) { setError(err instanceof ApiError && err.status === 403 ? 'You do not have permission to view My Work.' : err instanceof Error ? err.message : 'My Work unavailable'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [workspaceId]);
  if (loading) return <p role="status">Loading My Work…</p>;
  if (error) return <div className="space-y-3"><h2 className="text-2xl font-bold">My Work</h2><p role="alert" className="text-red-600">{error}</p><button type="button" onClick={() => void load()} className="rounded border px-3 py-2">Try again</button></div>;
  if (!result) return null;
  const { data, meta } = result;
  return <div className="space-y-4"><div><h2 className="text-2xl font-bold">My Work</h2><p className="text-sm text-gray-500">{meta.date} · {meta.timezone}</p></div><div className="grid gap-4 lg:grid-cols-3"><TaskSection title="Due today" tasks={data.today as WorkTask[]} empty="No tasks due today." href={`/workspaces/${workspaceId}/tasks?bucket=active&sort=due_at`} onOpen={(id) => router.push(taskRoute(workspaceId, id))} /><TaskSection title="Upcoming" tasks={data.upcoming as WorkTask[]} empty="No upcoming tasks." href={`/workspaces/${workspaceId}/tasks?bucket=active&sort=due_at`} onOpen={(id) => router.push(taskRoute(workspaceId, id))} /><TaskSection title="Overdue" tasks={data.overdue as WorkTask[]} empty="No overdue tasks." href={`/workspaces/${workspaceId}/tasks?bucket=active&sort=due_at`} onOpen={(id) => router.push(taskRoute(workspaceId, id))} /></div></div>;
}
