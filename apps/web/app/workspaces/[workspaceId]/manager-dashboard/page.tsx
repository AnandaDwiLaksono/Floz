'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, ApiError, Dashboard, ReportingKpis } from '../../../../lib/api-client';
import { formatDuration, formatRatio } from '../../../../lib/report-format';
import { useAuth } from '../../../../lib/auth-context';
import { reportingPeriod } from '../../../../lib/reporting-period';
const label = (key: string | null) => key === null ? 'Unassigned' : key.charAt(0) + key.slice(1).toLowerCase().replace('_', ' ');
const taskLink = (workspaceId: string, params: Record<string, string>) => `/workspaces/${workspaceId}/tasks?${new URLSearchParams(params)}`;
function Table({ name, rows }: { name: string; rows: Array<{ key: string | null; count: number }> }) { return <table aria-label={name} className="w-full text-left text-sm"><thead><tr><th className="pb-2">Category</th><th className="pb-2 text-right">Count</th></tr></thead><tbody>{rows.map((row) => <tr key={row.key ?? 'unassigned'}><td className="border-t py-2">{label(row.key)}</td><td className="border-t py-2 text-right font-semibold">{row.count}</td></tr>)}</tbody></table>; }

export default function ManagerDashboardPage() {
  const { workspaceId } = useParams() as { workspaceId: string };
  const { user } = useAuth();
  const workspace = user?.workspaces.find((item) => item.id === workspaceId);
  const timezone = workspace?.timezone || 'UTC';
  const authorized = workspace?.role === 'MANAGER' || workspace?.role === 'ADMIN';
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 8) + '01');
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [dashboard, setDashboard] = useState<Dashboard | null>(null); const [kpis, setKpis] = useState<ReportingKpis | null>(null);
  const [dashboardError, setDashboardError] = useState(''); const [kpiError, setKpiError] = useState(''); const [dashboardLoading, setDashboardLoading] = useState(true); const [kpiLoading, setKpiLoading] = useState(true);
  const period = useMemo(() => reportingPeriod(from, to, timezone), [from, to, timezone]);
  useEffect(() => { if (!authorized) return; setDashboardLoading(true); setDashboardError(''); void api.workspaces.dashboardManager(workspaceId, period).then((r) => setDashboard(r.data)).catch((e) => setDashboardError(e instanceof ApiError ? e.message : 'Dashboard unavailable')).finally(() => setDashboardLoading(false)); }, [authorized, workspaceId, period]);
  useEffect(() => { if (!authorized) return; setKpiLoading(true); setKpiError(''); void api.workspaces.kpis(workspaceId, period).then((r) => setKpis(r.data)).catch((e) => setKpiError(e instanceof ApiError ? e.message : 'KPI unavailable')).finally(() => setKpiLoading(false)); }, [authorized, workspaceId, period]);
  if (!workspace || !['MANAGER', 'ADMIN'].includes(workspace.role)) return <p role="alert">MANAGER or ADMIN access required.</p>;
  const priorities = (dashboard?.priority_breakdown || []).sort((a, b) => ['URGENT', 'HIGH', 'MEDIUM', 'LOW'].indexOf(a.key || '') - ['URGENT', 'HIGH', 'MEDIUM', 'LOW'].indexOf(b.key || ''));
  return <main className="space-y-5"><h2 className="text-2xl font-bold">Manager dashboard</h2><div className="flex gap-3"><label>From <input aria-label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label>To <input aria-label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label></div>{dashboardLoading ? <p role="status" aria-label="Dashboard loading">Loading dashboard…</p> : dashboardError ? <p role="alert">{dashboardError}</p> : dashboard && <><section><h3>Workload</h3><p><strong>{dashboard.unassigned}</strong> Unassigned workload</p><Link href={taskLink(workspaceId, { bucket: 'active', assignee_id: 'unassigned', sort: 'priority' })}>View unassigned tasks</Link><Table name="Workload by team" rows={dashboard.workload_by_team} /></section><section><h3>Priority breakdown</h3><Table name="Priority breakdown" rows={priorities} />{priorities.map((row) => <Link className="mr-3" key={row.key} href={taskLink(workspaceId, { bucket: 'active', priority: row.key || '', sort: 'priority' })}>View {label(row.key).toLowerCase()} tasks</Link>)}</section></>}{kpiLoading ? <p role="status" aria-label="KPI loading">Loading KPIs…</p> : kpiError ? <p role="alert">{kpiError}</p> : kpis && <section><h3>KPI reporting</h3><div className="grid gap-3 sm:grid-cols-4">{[['Completion rate', formatRatio(kpis.completion_rate)], ['Overdue rate', formatRatio(kpis.overdue_rate)], ['On-time completion', formatRatio(kpis.on_time_completion_rate)], ['Average completion', formatDuration(kpis.average_completion_time_seconds)]].map(([name, value]) => <article key={name}><p>{name}</p><strong>{value}</strong></article>)}</div><p>Evaluated {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: workspace.timezone || 'UTC' }).format(new Date(kpis.period.evaluationAt))}</p></section>}</main>;
}
