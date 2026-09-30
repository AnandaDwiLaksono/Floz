'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, Dashboard, ReportingKpis, Team, WorkspaceMember } from '../../../../lib/api-client';
import { useAuth } from '../../../../lib/auth-context';
import { formatStatusName } from '../../../../lib/i18n-labels';
import { formatDuration, formatRatio } from '../../../../lib/report-format';
import { reportingDefaults, reportingPeriod } from '../../../../lib/reporting-period';
import { tasksRoute } from '../../../../lib/task-route';

const priorities = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];
const priorityLabels: Record<string, string> = { URGENT: 'Mendesak', HIGH: 'Tinggi', MEDIUM: 'Sedang', LOW: 'Rendah' };

function Breakdown({ title, rows, label }: { title: string; rows: Array<{ id: string; count: number; key: string | null }>; label: (key: string | null) => string }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return <section className="min-w-0 rounded-xl border border-border bg-surface p-5">
    <h3 className="text-base font-semibold text-foreground">{title}</h3>
    {rows.length ? <ul className="mt-5 space-y-4">{rows.map((row) => <li key={row.id}>
      <div className="flex items-center justify-between gap-3 text-sm"><span className="truncate text-foreground">{label(row.key)}</span><span className="font-semibold tabular-nums text-foreground">{row.count}</span></div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-subtle" aria-hidden="true"><div className="h-full rounded-full bg-primary" style={{ width: `${row.count / max * 100}%` }} /></div>
    </li>)}</ul> : <p className="mt-4 text-sm text-muted-foreground">Belum ada data dalam lingkup ini.</p>}
  </section>;
}

export default function ManagerDashboardPage() {
  const { workspaceId } = useParams() as { workspaceId: string };
  const { activeWorkspace, workspaceResolving, user } = useAuth();
  const workspace = !workspaceResolving && activeWorkspace?.id === workspaceId ? activeWorkspace : null;
  const timezone = workspace?.timezone || 'UTC';
  const authorized = workspace?.role === 'MANAGER' || workspace?.role === 'ADMIN';
  const defaults = useMemo(() => reportingDefaults(timezone), [timezone]);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [teamId, setTeamId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [filtersError, setFiltersError] = useState('');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [kpis, setKpis] = useState<ReportingKpis | null>(null);
  const [dashboardError, setDashboardError] = useState('');
  const [kpiError, setKpiError] = useState('');
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [kpiLoading, setKpiLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => { setFrom(defaults.from); setTo(defaults.to); }, [defaults]);
  useEffect(() => {
    if (!authorized) return;
    let current = true;
    void Promise.all([api.workspaces.teams(workspaceId), ...(workspace?.role === 'ADMIN' ? [api.workspaces.members(workspaceId)] : [])])
      .then(([teamResponse, memberResponse]) => {
        if (!current) return;
        setTeams(teamResponse.data.filter((team) => team.isActive && (workspace?.role === 'ADMIN' || team.manager_user_id === user?.id)));
        if (memberResponse) setMembers(memberResponse.data.filter((member) => member.status === 'ACTIVE'));
      })
      .catch(() => { if (current) setFiltersError('Pilihan tim tidak dapat dimuat.'); });
    return () => { current = false; };
  }, [authorized, workspace?.role, workspaceId, user?.id]);

  const valid = Boolean(from && to && from <= to);
  const period = useMemo(() => valid ? reportingPeriod(from, to, timezone) : null, [from, to, timezone, valid]);
  const params = useMemo(() => period ? { ...period, ...(teamId ? { team_id: teamId } : {}) } : null, [period, teamId]);
  const kpiParams = useMemo(() => params ? { ...params, ...(assigneeId && workspace?.role === 'ADMIN' ? { assignee_id: assigneeId } : {}) } : null, [params, assigneeId, workspace?.role]);

  useEffect(() => {
    if (!authorized || !params) return;
    let current = true;
    setDashboardLoading(true); setDashboardError('');
    void api.workspaces.dashboardManager(workspaceId, params)
      .then((response) => { if (current) setDashboard(response.data); })
      .catch((err) => { if (current) setDashboardError(err instanceof Error ? err.message : 'Dasbor belum dapat dimuat.'); })
      .finally(() => { if (current) setDashboardLoading(false); });
    return () => { current = false; };
  }, [authorized, workspaceId, params, revision]);
  useEffect(() => {
    if (!authorized || !kpiParams) return;
    let current = true;
    setKpiLoading(true); setKpiError('');
    void api.workspaces.kpis(workspaceId, kpiParams)
      .then((response) => { if (current) { setKpis(response.data); setKpiError(''); } })
      .catch((err) => { if (current) setKpiError(err instanceof Error ? err.message : 'Laporan KPI belum dapat dimuat.'); })
      .finally(() => { if (current) setKpiLoading(false); });
    return () => { current = false; };
  }, [authorized, workspaceId, kpiParams, revision]);

  if (workspaceResolving) return <p role="status">Memuat dasbor…</p>;
  if (!authorized) return <p role="alert">Akses hanya untuk Manajer atau Admin.</p>;
  const selectedTeam = teams.find((team) => team.id === teamId)?.name || 'Semua tim';
  const selectedAssignee = members.find((member) => member.user_id === assigneeId)?.full_name || 'Semua anggota';
  const orderedPriorities = [...(dashboard?.priority_breakdown || [])].sort((a, b) => priorities.indexOf(a.key || '') - priorities.indexOf(b.key || ''));
  const kpiMetrics = kpis ? [
    ['Tingkat penyelesaian', kpis.denominators.due ? formatRatio(kpis.completion_rate) : '—', `${kpis.denominators.completed} dari ${kpis.denominators.due} tugas dengan tenggat pada periode ini`],
    ['Selesai tepat waktu', kpis.denominators.completed ? formatRatio(kpis.on_time_completion_rate) : '—', `${kpis.denominators.onTime} dari ${kpis.denominators.completed} tugas selesai dengan tenggat`],
    ['Tingkat keterlambatan', kpis.denominators.due ? formatRatio(kpis.overdue_rate) : '—', `${kpis.denominators.overdue} dari ${kpis.denominators.due} tugas dengan tenggat pada periode ini`],
    ['Rata-rata waktu penyelesaian', kpis.denominators.completed ? formatDuration(kpis.average_completion_time_seconds) : '—', 'Dari dibuat hingga selesai, pada tugas periode ini'],
  ] : [];

  return <div className="space-y-6">
    <header className="border-b border-border pb-5"><h1 className="text-2xl font-semibold tracking-tight text-foreground">Dasbor Manajer</h1><p className="mt-1 text-sm text-muted-foreground">Kondisi pekerjaan tim dan titik yang perlu ditindaklanjuti.</p></header>
    <section aria-label="Filter laporan" className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm font-medium text-foreground">Dari<input id="report-from" aria-label="Dari" className="mt-1 block min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-foreground" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-sm font-medium text-foreground">Sampai<input id="report-to" aria-label="Sampai" className="mt-1 block min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-foreground" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="text-sm font-medium text-foreground">Tim<select aria-label="Tim" className="mt-1 block min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-foreground" value={teamId} onChange={(e) => setTeamId(e.target.value)}><option value="">Semua tim</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
        {workspace?.role === 'ADMIN' && <label className="text-sm font-medium text-foreground">Anggota (KPI)<select aria-label="Anggota (KPI)" className="mt-1 block min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-foreground" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}><option value="">Semua anggota</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name}</option>)}</select></label>}
      </div>
      {!valid && <p role="alert" className="mt-3 text-sm text-danger">Rentang tanggal tidak valid.</p>}
      {filtersError && <p role="alert" className="mt-3 text-sm text-danger">{filtersError}</p>}
      <p className="mt-4 text-xs text-muted-foreground">{from === defaults.from && to === defaults.to ? 'Bulan berjalan' : 'Rentang pilihan'} · {from}–{to} · Zona waktu {timezone} · Ruang lingkup: {selectedTeam}</p>
    </section>

    <section aria-busy={dashboardLoading} aria-live="polite" className="space-y-5">
      {dashboardLoading ? <p role="status" aria-label="Dashboard loading" className="rounded-xl border border-border bg-surface p-5 text-muted-foreground">Memuat kondisi tim…</p> : dashboardError ? <div className="rounded-xl border border-border bg-surface p-5"><p role="alert" className="text-sm text-danger">{dashboardError}</p><button type="button" className="mt-3 min-h-11 text-sm font-semibold text-primary" onClick={() => setRevision((n) => n + 1)}>Coba lagi</button></div> : dashboard && <>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,24rem)]">
          <div className="min-w-0 rounded-xl border border-border bg-surface p-5">
            <h2 className="text-lg font-semibold text-foreground">Perlu perhatian</h2>
            <div className="mt-5 flex flex-wrap gap-x-8 gap-y-4">
              {dashboard.pending_approvals !== undefined && <div><p className="text-xs text-muted-foreground">Persetujuan menunggu</p><p className="mt-1 text-3xl font-semibold tabular-nums text-foreground">{dashboard.pending_approvals}</p>{dashboard.drilldown_url && <Link href={dashboard.drilldown_url} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline">Buka persetujuan menunggu</Link>}</div>}
              <div><p className="text-xs text-muted-foreground">Belum ditugaskan</p><p className="mt-1 text-3xl font-semibold tabular-nums text-foreground">{dashboard.unassigned}</p><Link href={tasksRoute(workspaceId, { sort: 'priority' })} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline">Lihat daftar tugas</Link></div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Persetujuan dihitung dari langkah yang masih menunggu, bukan dari rentang tanggal tugas.</p>
          </div>
          <div className="min-w-0 rounded-xl border border-border bg-surface p-5"><h2 className="text-base font-semibold text-foreground">Beban kerja aktif</h2><p className="mt-1 text-xs text-muted-foreground">Jumlah tugas aktif, bukan penilaian kinerja.</p><p className="mt-5 text-3xl font-semibold tabular-nums text-foreground">{dashboard.kpis.workload}</p><p className="mt-1 text-sm text-muted-foreground">Tugas aktif dalam lingkup</p></div>
        </div>
        <div className="grid min-w-0 gap-5 lg:grid-cols-2">
          <Breakdown title="Beban kerja per anggota" rows={dashboard.workload_by_assignee.map((row) => ({ id: row.userId || 'unassigned', key: row.name, count: row.count }))} label={(key) => key || 'Belum ditugaskan'} />
          <Breakdown title="Beban kerja per tim" rows={dashboard.workload_by_team.map((row) => ({ id: row.key || 'unassigned', key: row.key, count: row.count }))} label={(key) => key === 'UNASSIGNED' || key === null ? 'Tanpa tim' : key} />
          <Breakdown title="Tugas berdasarkan status" rows={dashboard.status_breakdown} label={(key) => key === 'ACTIVE' ? 'Aktif' : formatStatusName(key || '')} />
          <section className="min-w-0 rounded-xl border border-border bg-surface p-5"><h3 className="text-base font-semibold text-foreground">Tugas berdasarkan prioritas</h3>{orderedPriorities.length ? <ul className="mt-4 divide-y divide-border">{orderedPriorities.map((row) => <li key={row.key} className="flex min-h-11 items-center justify-between gap-3 text-sm"><span className="text-foreground">{priorityLabels[row.key || ''] || row.key}</span><span className="font-semibold tabular-nums text-foreground">{row.count}</span></li>)}</ul> : <p className="mt-4 text-sm text-muted-foreground">Belum ada tugas pada periode ini.</p>}<Link href={tasksRoute(workspaceId, { priority: 'URGENT', sort: 'priority' })} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline">Lihat tugas mendesak</Link></section>
        </div>
      </>}
    </section>

    <section aria-busy={kpiLoading} aria-live="polite" className="rounded-xl border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold text-foreground">Laporan & KPI</h2><p className="mt-1 text-sm text-muted-foreground">Kinerja dalam periode terpilih · {selectedTeam}{workspace?.role === 'ADMIN' ? ` · ${selectedAssignee}` : ''}</p>
      {kpiLoading ? <p role="status" aria-label="KPI loading" className="mt-5 text-sm text-muted-foreground">Memuat KPI…</p> : kpiError ? <div className="mt-5"><p role="alert" className="text-sm text-danger">{kpiError}</p><button type="button" className="mt-3 min-h-11 text-sm font-semibold text-primary" onClick={() => setRevision((n) => n + 1)}>Coba lagi</button></div> : kpis && <>
        <dl className="mt-5 grid gap-5 border-t border-border pt-5 sm:grid-cols-2 xl:grid-cols-4">{kpiMetrics.map(([name, value, detail]) => <div key={name} className="min-w-0"><dt className="text-sm font-medium text-muted-foreground">{name}</dt><dd className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{value}</dd><p className="mt-2 text-xs leading-5 text-muted-foreground">{detail}</p></div>)}</dl>
        <p className="mt-5 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">Proyeksi langsung dari data tugas saat ini; bukan snapshot historis. Dihitung pada {new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(kpis.period.evaluationAt))} ({timezone}). Interval [dari, sampai hari berikutnya); batas evaluasi sekarang.</p>
      </>}
    </section>
  </div>;
}
