'use client';

import React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, CalendarDays, CheckCircle2, Clock3 } from 'lucide-react';
import { api, ApiError, MemberDashboard, MyWorkSummary, MyWorkTask } from '../../../../lib/api-client';
import { getTodayInTimezone } from '../../../../lib/calendar-time';
import { formatStatusName } from '../../../../lib/i18n-labels';
import { formatDuration, formatRatio } from '../../../../lib/report-format';
import { taskRoute, tasksRoute } from '../../../../lib/task-route';
import { useAuth } from '../../../../lib/auth-context';

function TaskList({ tasks, empty, timezone, onOpen }: { tasks: MyWorkTask[]; empty: string; timezone: string; onOpen: (id: string) => void }) {
  if (!tasks.length) return <p className="py-5 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {tasks.slice(0, 4).map((task) => (
        <li key={task.id} className="py-3 first:pt-1 last:pb-1">
          <button type="button" aria-label={task.title} onClick={() => onOpen(task.id)} className="flex min-h-11 w-full items-center justify-between gap-4 rounded-lg px-2 text-left transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-foreground">{task.title}</span>
              <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span className="font-medium text-primary">{task.taskKey}</span>
                <span>{formatStatusName(task.status.name)}</span>
              </span>
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(task.dueAt))}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function MemberDashboardPage() {
  const { workspaceId } = useParams() as { workspaceId: string };
  const router = useRouter();
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<MemberDashboard | null>(null);
  const [work, setWork] = useState<MyWorkSummary | null>(null);
  const [timezone, setTimezone] = useState('UTC');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const workspace = await api.workspaces.get(workspaceId);
      const zone = workspace.data.timezone || 'UTC';
      setTimezone(zone);
      const [dashboardResponse, workResponse] = await Promise.all([
        api.workspaces.dashboardMember(workspaceId),
        api.workspaces.myWork(workspaceId, getTodayInTimezone(zone)),
      ]);
      setDashboard(dashboardResponse.data);
      setWork(workResponse.data);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? 'Anda tidak memiliki akses ke ringkasan ini.' : 'Ringkasan belum dapat dimuat.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return (
    <div role="status" aria-label="Memuat ringkasan" className="space-y-5">
      <span className="sr-only">Memuat ringkasan…</span>
      <div className="h-16 max-w-sm rounded-lg bg-surface-subtle" />
      <div className="h-24 rounded-xl border border-border bg-surface" />
      <div className="grid gap-4 lg:grid-cols-3"><div className="h-72 rounded-xl border border-border bg-surface lg:col-span-2" /><div className="h-72 rounded-xl border border-border bg-surface" /></div>
    </div>
  );

  if (error || !dashboard || !work) return (
    <div className="space-y-5">
      <header><h1 className="text-2xl font-semibold tracking-tight text-foreground">Ringkasan</h1><p className="mt-1 text-sm text-muted-foreground">Fokus kerja Anda hari ini.</p></header>
      <section className="rounded-xl border border-danger/35 bg-surface p-5">
        <p role="alert" className="text-sm font-medium text-danger">{error || 'Ringkasan belum dapat dimuat.'}</p>
        <button type="button" onClick={() => void load()} className="mt-4 min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-foreground hover:bg-surface-subtle">Coba lagi</button>
      </section>
    </div>
  );

  const { kpis } = dashboard;
  const memberId = user?.id || '';
  const hasAttention = work.overdue.length + work.today.length + work.upcoming.length > 0;
  const maxStatus = Math.max(1, ...dashboard.status_breakdown.map((row) => row.count));
  const metrics = [
    { label: 'Tingkat penyelesaian', value: kpis.denominators.due ? formatRatio(kpis.completion_rate) : '—' },
    { label: 'Selesai tepat waktu', value: kpis.denominators.completed ? formatRatio(kpis.on_time_completion_rate) : '—' },
    { label: 'Tingkat keterlambatan', value: kpis.denominators.due ? formatRatio(kpis.overdue_rate) : '—' },
    { label: 'Rata-rata waktu penyelesaian', value: kpis.denominators.completed ? formatDuration(kpis.average_completion_time_seconds) : '—' },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Ringkasan</h1>
          <p className="mt-1 text-sm text-muted-foreground">Yang perlu Anda tindak lanjuti sekarang.</p>
        </div>
        <Link href={`/workspaces/${workspaceId}/my-work`} className="inline-flex min-h-11 items-center gap-2 self-start text-sm font-semibold text-primary hover:underline sm:self-auto">Buka Pekerjaan Saya <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
      </header>

      <section aria-label="Ringkasan pekerjaan" className="grid overflow-hidden rounded-xl border border-border bg-surface sm:grid-cols-2 lg:grid-cols-5">
        {[
          ['Tugas aktif', kpis.workload, 'normal'],
          ['Terlambat', work.counts.overdue, 'danger'],
          ['Jatuh tempo hari ini', work.counts.today, 'normal'],
          ['Mendatang', work.counts.upcoming, 'quiet'],
          ['Selesai periode ini', kpis.denominators.completed, 'quiet'],
        ].map(([label, value, tone], index) => (
          <div key={String(label)} className={`px-4 py-4 ${index ? 'border-t border-border sm:border-l sm:border-t-0' : ''} ${index === 2 ? 'sm:border-t lg:border-t-0' : ''}`}>
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === 'danger' && Number(value) > 0 ? 'text-danger' : tone === 'quiet' ? 'text-muted-foreground' : 'text-foreground'}`}>{value}</p>
          </div>
        ))}
      </section>

      <div className="grid min-w-0 gap-5 xl:grid-cols-3">
        <div className="min-w-0 space-y-5 xl:col-span-2">
          <section className={`overflow-hidden rounded-xl border bg-surface ${work.overdue.length ? 'border-danger/35' : 'border-border'}`}>
            <div className="flex min-h-14 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
              <div className="flex items-center gap-2"><AlertCircle className={`h-4 w-4 ${work.overdue.length ? 'text-danger' : 'text-muted-foreground'}`} aria-hidden="true" /><h2 className="font-semibold text-foreground">Perlu perhatian</h2></div>
              <span className={`text-sm font-semibold tabular-nums ${work.overdue.length ? 'text-danger' : 'text-muted-foreground'}`}>{work.counts.overdue}</span>
            </div>
            <div className="px-3 py-3 sm:px-5"><TaskList tasks={work.overdue} empty="Tidak ada tugas yang terlambat." timezone={timezone} onOpen={(id) => router.push(taskRoute(workspaceId, id))} /></div>
            {work.overdue.length > 0 && <div className="border-t border-border px-5 py-3"><Link href={tasksRoute(workspaceId, { assignee_id: memberId, bucket: 'active', overdue: 'true', sort: 'due_at' })} className="text-sm font-semibold text-primary hover:underline">Lihat semua tugas terlambat</Link></div>}
          </section>

          {!hasAttention && <section className="rounded-xl border border-border bg-surface px-5 py-8 text-center"><CheckCircle2 className="mx-auto h-5 w-5 text-success" aria-hidden="true" /><p className="mt-3 text-sm font-semibold text-foreground">Tidak ada tugas yang memerlukan perhatian.</p><p className="mt-1 text-sm text-muted-foreground">Pekerjaan aktif akan muncul di sini saat perlu ditindaklanjuti.</p></section>}

          <div className="grid gap-5 md:grid-cols-2">
            <section className="overflow-hidden rounded-xl border border-border bg-surface">
              <div className="flex min-h-14 items-center justify-between border-b border-border px-5 py-3"><div className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-primary" aria-hidden="true" /><h2 className="font-semibold text-foreground">Hari ini</h2></div><span className="text-sm font-semibold tabular-nums text-muted-foreground">{work.counts.today}</span></div>
              <div className="px-3 py-3"><TaskList tasks={work.today} empty="Tidak ada tugas yang jatuh tempo hari ini." timezone={timezone} onOpen={(id) => router.push(taskRoute(workspaceId, id))} /></div>
            </section>
            <section className="overflow-hidden rounded-xl border border-border bg-surface">
              <div className="flex min-h-14 items-center justify-between border-b border-border px-5 py-3"><div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden="true" /><h2 className="font-semibold text-foreground">Mendatang</h2></div><span className="text-sm font-semibold tabular-nums text-muted-foreground">{work.counts.upcoming}</span></div>
              <div className="px-3 py-3"><TaskList tasks={work.upcoming} empty="Tidak ada tugas mendatang." timezone={timezone} onOpen={(id) => router.push(taskRoute(workspaceId, id))} /></div>
            </section>
          </div>
        </div>

        <aside className="min-w-0 space-y-5">
          <section className="rounded-xl border border-border bg-surface p-5">
            <div className="mb-4 flex items-center justify-between gap-3"><h2 className="font-semibold text-foreground">Status tugas</h2><Link href={tasksRoute(workspaceId, { assignee_id: memberId, bucket: 'active', sort: 'due_at' })} aria-label="Lihat tugas aktif" className="text-sm font-semibold text-primary hover:underline">Lihat tugas</Link></div>
            {dashboard.status_breakdown.length ? <ul className="space-y-4">{dashboard.status_breakdown.map((row) => <li key={row.id}><div className="mb-1.5 flex justify-between gap-3 text-sm"><span className="text-foreground">{row.key === 'ACTIVE' ? 'Aktif' : formatStatusName(row.key)}</span><span className="font-semibold tabular-nums text-foreground">{row.count}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-surface-subtle" aria-hidden="true"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(6, row.count / maxStatus * 100)}%` }} /></div></li>)}</ul> : <p className="text-sm text-muted-foreground">Belum ada data tugas aktif.</p>}
          </section>

          <section className="rounded-xl border border-border bg-surface p-5">
            <div className="mb-4"><h2 className="font-semibold text-foreground">Kinerja bulan berjalan</h2><p className="mt-1 text-xs text-muted-foreground">Proyeksi langsung · {timezone}</p></div>
            <dl className="divide-y divide-border">{metrics.map((metric) => <div key={metric.label} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"><dt className="text-sm text-muted-foreground">{metric.label}</dt><dd className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{metric.value}</dd></div>)}</dl>
            <div className="mt-4 border-t border-border pt-4"><Link href={tasksRoute(workspaceId, { assignee_id: memberId, bucket: 'completed', sort: '-updated_at' })} className="text-sm font-semibold text-primary hover:underline">Lihat tugas selesai</Link></div>
          </section>
        </aside>
      </div>
    </div>
  );
}
