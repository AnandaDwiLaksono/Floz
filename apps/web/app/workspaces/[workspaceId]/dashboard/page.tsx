'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, ApiError, Dashboard } from '../../../../lib/api-client';

type Kpis = { completion_rate: string; overdue_rate: string; on_time_completion_rate: string; average_completion_time_seconds: string; workload: number };
const percent = (value: string) => `${Math.round(Number(value) * 100)}%`;
const duration = (value: string) => { const seconds = Number(value); const hours = Math.floor(seconds / 3600); const minutes = Math.round((seconds % 3600) / 60); return hours ? `${hours}h ${minutes}m` : `${minutes}m`; };

export default function MemberDashboardPage() {
  const { workspaceId } = useParams() as { workspaceId: string };
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = async () => { setLoading(true); setError(''); try { setData((await api.workspaces.dashboardMember(workspaceId)).data); } catch (err) { setError(err instanceof ApiError && err.status === 403 ? 'You do not have permission to view this page.' : err instanceof Error ? err.message : 'Dashboard unavailable'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [workspaceId]);
  if (loading) return <p role="status">Loading Dashboard…</p>;
  if (error) return <div className="space-y-3"><h2 className="text-2xl font-bold">Dashboard</h2><p role="alert" className="text-red-600">{error}</p><button type="button" onClick={() => void load()} className="rounded border px-3 py-2">Try again</button></div>;
  if (!data) return null;
  const kpis = data.kpis as unknown as Kpis;
  const statuses = data.status_breakdown as Array<{ key: string; count: number }>;
  return <div className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-bold">Dashboard</h2><p className="text-sm text-gray-500">Your assigned work</p></div><Link href={`/workspaces/${workspaceId}/tasks?bucket=active&sort=due_at`} className="rounded border px-3 py-2 text-sm text-blue-600">View my tasks</Link></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[['Completion rate', percent(kpis.completion_rate)], ['Overdue rate', percent(kpis.overdue_rate)], ['On-time completion', percent(kpis.on_time_completion_rate)], ['Average completion', duration(kpis.average_completion_time_seconds)]].map(([label, value]) => <section key={label} className="rounded-lg border bg-white p-4 dark:bg-gray-900"><p className="text-sm text-gray-500">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></section>)}</div><section className="rounded-lg border bg-white p-4 dark:bg-gray-900"><h3 className="mb-3 font-semibold">Status breakdown</h3><ul className="grid gap-2 sm:grid-cols-2">{statuses.map((row) => <li key={row.key} className="flex justify-between rounded bg-gray-50 p-2 dark:bg-gray-800"><span>{row.key}</span><strong>{row.count}</strong></li>)}</ul>{!statuses.length && <p className="text-sm text-gray-500">No assigned task data.</p>}</section></div>;
}
