'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, ApiError, MemberDashboard } from '../../../../lib/api-client';

import { formatDuration, formatRatio } from '../../../../lib/report-format';

export default function MemberDashboardPage() {
  const { workspaceId } = useParams() as { workspaceId: string };
  const [data, setData] = useState<MemberDashboard | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); setError(''); try { setData((await api.workspaces.dashboardMember(workspaceId)).data); } catch (err) { setError(err instanceof ApiError && err.status === 403 ? 'You do not have permission to view this page.' : err instanceof Error ? err.message : 'Dashboard unavailable'); } finally { setLoading(false); } }, [workspaceId]);
  useEffect(() => { void load(); }, [load]);
  if (loading) return <p role="status">Loading Dashboard…</p>;
  if (error) return <div className="space-y-3"><h2 className="text-2xl font-bold">Dashboard</h2><p role="alert" className="text-red-600">{error}</p><button type="button" onClick={() => void load()} className="rounded border px-3 py-2">Try again</button></div>;
  if (!data) return null;
  const { kpis } = data;
  return <div className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-bold">Dashboard</h2><p className="text-sm text-gray-500">Your assigned work</p></div><div className="flex gap-2"><Link href={`/workspaces/${workspaceId}/tasks?bucket=active&sort=due_at`} className="rounded border px-3 py-2 text-sm text-blue-600">View active tasks</Link><Link href={`/workspaces/${workspaceId}/tasks?bucket=completed&sort=-updated_at`} className="rounded border px-3 py-2 text-sm text-blue-600">View completed tasks</Link></div></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[['Completion rate', formatRatio(kpis.completion_rate)], ['Overdue rate', formatRatio(kpis.overdue_rate)], ['On-time completion', formatRatio(kpis.on_time_completion_rate)], ['Average completion', formatDuration(kpis.average_completion_time_seconds)]].map(([label, value]) => <section key={label} className="rounded-lg border bg-white p-4 dark:bg-gray-900"><p className="text-sm text-gray-500">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></section>)}</div><section className="rounded-lg border bg-white p-4 dark:bg-gray-900"><h3 className="mb-3 font-semibold">Status breakdown</h3>{data.status_breakdown.length ? <ul className="grid gap-2 sm:grid-cols-2">{data.status_breakdown.map((row) => <li key={row.id} className="flex justify-between rounded bg-gray-50 p-2 dark:bg-gray-800"><span>{row.key === 'OPEN' ? 'Open' : row.key === 'IN_PROGRESS' ? 'In progress' : row.key === 'COMPLETED' ? 'Completed' : 'Other'}</span><strong>{row.count}</strong></li>)}</ul> : <p className="text-sm text-gray-500">No assigned task data.</p>}</section></div>;
}
