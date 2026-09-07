'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, ApiError, Dashboard, ReportingKpis } from '../../../../lib/api-client';
import { useAuth } from '../../../../lib/auth-context';
import { formatDuration, formatRatio } from '../../../../lib/report-format';
import { reportingDefaults, reportingPeriod } from '../../../../lib/reporting-period';
import { tasksRoute } from '../../../../lib/task-route';
const label = (key: string | null) => key === null ? 'Unassigned' : key.charAt(0) + key.slice(1).toLowerCase().replace('_', ' ');
function Table({ name, rows }: { name: string; rows: Array<{ key: string | null; count: number }> }) { return <table aria-label={name} className="w-full text-left text-sm"><thead><tr><th>Category</th><th className="text-right">Count</th></tr></thead><tbody>{rows.map((row) => <tr key={row.key ?? 'unassigned'}><td>{label(row.key)}</td><td className="text-right">{row.count}</td></tr>)}</tbody></table>; }

export default function ManagerDashboardPage() {
  const { workspaceId } = useParams() as { workspaceId: string }; const { user } = useAuth();
  const workspace = user?.workspaces.find((item) => item.id === workspaceId); const timezone = workspace?.timezone || 'UTC'; const authorized = workspace?.role === 'MANAGER' || workspace?.role === 'ADMIN';
  const defaults = useMemo(() => reportingDefaults(timezone), [timezone]); const [from, setFrom] = useState(defaults.from); const [to, setTo] = useState(defaults.to);
  useEffect(() => { setFrom(defaults.from); setTo(defaults.to); }, [defaults]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null); const [kpis, setKpis] = useState<ReportingKpis | null>(null); const [dashboardError, setDashboardError] = useState(''); const [kpiError, setKpiError] = useState(''); const [dashboardLoading, setDashboardLoading] = useState(true); const [kpiLoading, setKpiLoading] = useState(true);
  const period = useMemo(() => reportingPeriod(from, to, timezone), [from, to, timezone]);
  useEffect(() => { if (!authorized) return; setDashboardLoading(true); setDashboardError(''); void api.workspaces.dashboardManager(workspaceId, period).then((r) => setDashboard(r.data)).catch((e) => setDashboardError(e instanceof ApiError ? e.message : 'Dashboard unavailable')).finally(() => setDashboardLoading(false)); }, [authorized, workspaceId, period]);
  useEffect(() => { if (!authorized) return; setKpiLoading(true); setKpiError(''); void api.workspaces.kpis(workspaceId, period).then((r) => setKpis(r.data)).catch((e) => setKpiError(e instanceof ApiError ? e.message : 'KPI unavailable')).finally(() => setKpiLoading(false)); }, [authorized, workspaceId, period]);
  if (!authorized) return <p role="alert">MANAGER or ADMIN access required.</p>;
  const priorities = [...(dashboard?.priority_breakdown || [])].sort((a, b) => ['URGENT', 'HIGH', 'MEDIUM', 'LOW'].indexOf(a.key || '') - ['URGENT', 'HIGH', 'MEDIUM', 'LOW'].indexOf(b.key || ''));
  const metrics = kpis ? [['Completion rate', formatRatio(kpis.completion_rate)], ['Overdue rate', formatRatio(kpis.overdue_rate)], ['On-time completion', formatRatio(kpis.on_time_completion_rate)], ['Average completion', formatDuration(kpis.average_completion_time_seconds)]] : [];
  return <div className="space-y-5"><h2 className="text-2xl font-bold">Manager dashboard</h2><div className="flex gap-3"><label htmlFor="report-from">From</label><input id="report-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><label htmlFor="report-to">To</label><input id="report-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div><section aria-live="polite" aria-busy={dashboardLoading}>{dashboardLoading ? <p role="status" aria-label="Dashboard loading">Loading dashboard…</p> : dashboardError ? <p role="alert">{dashboardError}</p> : dashboard && <><h3>Workload</h3><p><strong>{dashboard.unassigned}</strong> Unassigned workload</p><Link href={tasksRoute(workspaceId, { assignee_id: 'unassigned', sort: 'priority' })}>View unassigned tasks</Link><Table name="Workload by team" rows={dashboard.workload_by_team} /><h3>Priority breakdown</h3><Table name="Priority breakdown" rows={priorities} />{priorities.map((row) => <Link className="mr-3" key={row.key} href={tasksRoute(workspaceId, { priority: row.key || '', sort: 'priority' })}>View {label(row.key).toLowerCase()} tasks</Link>)}{dashboard.pending_approvals !== undefined && (<div className="pt-2"><h3>Approvals</h3><p><strong>{dashboard.pending_approvals}</strong> Pending approvals</p><Link href={dashboard.drilldown_url || `/workspaces/${workspaceId}/approvals?view=managed&status=PENDING`}>View pending approvals</Link></div>)}</>}</section><section aria-live="polite" aria-busy={kpiLoading}><h3>KPI reporting</h3>{kpiLoading ? <p role="status" aria-label="KPI loading">Loading KPIs…</p> : kpiError ? <p role="alert">{kpiError}</p> : kpis && <><dl className="grid gap-3 sm:grid-cols-4">{metrics.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl><p>Evaluated {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: timezone }).format(new Date(kpis.period.evaluationAt))}</p></>}</section></div>;
}
