'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, ApiError, MyWorkTask } from '../../../../lib/api-client';
import { getCalendarRange, getTodayInTimezone, shiftCalendarDate } from '../../../../lib/calendar-time';
import { useAuth } from '../../../../lib/auth-context';
import { taskRoute } from '../../../../lib/task-route';
import { formatStatusName, formatTransitionLabel, formatDateDisplay } from '../../../../lib/i18n-labels';

type TaskSectionProps = {
  timezone: string;
  title: string;
  tasks: MyWorkTask[];
  empty: string;
  href: string;
  linkLabel: string;
  tone?: 'default' | 'danger';
  onOpen: (id: string) => void;
  onQuickStatus: (task: MyWorkTask) => void;
  activeQuickTaskId: string | null;
  loadingQuickStatus: boolean;
  quickTransitions: { to_status_id: string; code: string; name: string }[];
  quickError: string | null;
  onTransition: (toStatusId: string) => void;
  onCloseQuickStatus: () => void;
};

function TaskSection({
  timezone,
  title,
  tasks,
  empty,
  href,
  linkLabel,
  tone = 'default',
  onOpen,
  onQuickStatus,
  activeQuickTaskId,
  loadingQuickStatus,
  quickTransitions,
  quickError,
  onTransition,
  onCloseQuickStatus,
}: TaskSectionProps) {
  return (
    <section className={`overflow-hidden rounded-xl border bg-surface ${tone === 'danger' ? 'border-danger/35' : 'border-border'}`}>
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-base font-semibold text-foreground">{title}</h2>
          <span className={`tabular-nums text-sm font-semibold ${tone === 'danger' && tasks.length ? 'text-danger' : 'text-muted-foreground'}`}>
            {tasks.length}
          </span>
        </div>
        <Link className="shrink-0 text-sm font-semibold text-primary hover:text-primary-hover" href={href}>
          {linkLabel}
        </Link>
      </div>
      {tasks.length ? (
        <ul className="divide-y divide-border">
          {tasks.map((task) => {
            const isActive = activeQuickTaskId === task.id;
            return (
              <li key={task.id} className="px-3 py-3 sm:px-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    aria-label={task.title}
                    onClick={() => onOpen(task.id)}
                    className="min-h-11 min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-subtle"
                  >
                    <span className="block truncate text-sm font-semibold text-foreground">{task.title}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span className="font-medium text-primary">{task.taskKey}</span>
                      <span>{formatStatusName(task.status.name)}</span>
                      {task.status.is_active === false && <span className="font-semibold">Diarsipkan</span>}
                      <span>{({ LOW: 'Rendah', MEDIUM: 'Sedang', HIGH: 'Tinggi', URGENT: 'Mendesak' } as Record<string, string>)[task.priority] || task.priority}</span>
                    </span>
                    <span className={`mt-1.5 block text-xs font-medium ${tone === 'danger' ? 'text-danger' : 'text-foreground'}`}>
                      {tone === 'danger' ? 'Terlambat · ' : 'Tenggat · '}{new Intl.DateTimeFormat('id-ID', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(task.dueAt))}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Ubah status ${task.taskKey}`}
                    onClick={() => onQuickStatus(task)}
                    className="min-h-11 shrink-0 rounded-lg border border-border px-3 text-sm font-semibold text-foreground transition-colors hover:bg-surface-subtle"
                  >
                    Ubah status
                  </button>
                </div>
                {isActive && (
                  <div className="mt-3 space-y-3 border-t border-border px-2 pt-3">
                    {loadingQuickStatus && (
                      <p role="status" aria-busy="true" className="text-sm text-muted-foreground">
                        Memuat pilihan status…
                      </p>
                    )}
                    {quickError && (
                      <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
                        <span>{quickError}</span>
                        <button type="button" onClick={onCloseQuickStatus} className="min-h-11 shrink-0 font-semibold text-primary">
                          Tutup
                        </button>
                      </div>
                    )}
                    {!loadingQuickStatus && !quickError && (
                      <div className="space-y-3">
                        <p className="text-sm font-medium text-foreground">Pilih status berikutnya</p>
                        <div className="flex flex-wrap gap-2">
                          {quickTransitions.map((transition) => (
                            <button
                              key={transition.to_status_id}
                              type="button"
                              onClick={() => onTransition(transition.to_status_id)}
                              className="min-h-11 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
                            >
                              {formatTransitionLabel(transition.name)}
                            </button>
                          ))}
                          {quickTransitions.length === 0 && (
                            <span className="text-sm text-muted-foreground">Tidak ada perubahan status yang tersedia.</span>
                          )}
                        </div>
                        <button type="button" onClick={onCloseQuickStatus} className="min-h-11 text-sm font-semibold text-muted-foreground hover:text-foreground">
                          Batal
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="px-5 py-8">
          <p className="text-sm font-medium text-foreground">{empty}</p>
          <p className="mt-1 text-sm text-muted-foreground">Tidak ada tindakan yang diperlukan pada bagian ini.</p>
        </div>
      )}
    </section>
  );
}

export default function MyWorkPage() {
  const { workspaceId } = useParams() as { workspaceId: string };
  const router = useRouter();
  const { user } = useAuth();
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.workspaces.myWork>> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadedWorkspace, setLoadedWorkspace] = useState(workspaceId);
  const [timezone, setTimezone] = useState<string | null>(null);
  const loadRequest = useRef(0);
  const quickRequest = useRef(0);
  const currentWorkspace = useRef(workspaceId);
  currentWorkspace.current = workspaceId;

  // Quick Status state
  const [quickTask, setQuickTask] = useState<{ id: string; version: number } | null>(null);
  const [activeQuickTaskId, setActiveQuickTaskId] = useState<string | null>(null);
  const [loadingQuickStatus, setLoadingQuickStatus] = useState(false);
  const [quickTransitions, setQuickTransitions] = useState<{ to_status_id: string; code: string; name: string }[]>([]);
  const [quickError, setQuickError] = useState<string | null>(null);

  const date = timezone ? getTodayInTimezone(timezone) : null;
  const load = useCallback(async () => {
    if (workspaceId !== currentWorkspace.current) return;
    const id = ++loadRequest.current;
    setLoading(true);
    setError('');
    try {
      const workspace = await api.workspaces.get(workspaceId);
      if (id !== loadRequest.current || workspaceId !== currentWorkspace.current) return;
      setTimezone(workspace.data.timezone);
      const summary = await api.workspaces.myWork(workspaceId, getTodayInTimezone(workspace.data.timezone));
      if (id !== loadRequest.current || workspaceId !== currentWorkspace.current) return;
      setResult(summary);
    } catch (err) {
      if (id !== loadRequest.current || workspaceId !== currentWorkspace.current) return;
      setError(
        err instanceof ApiError && err.status === 403
          ? 'You do not have permission to view My Work.'
          : err instanceof Error
          ? err.message
          : 'My Work unavailable'
      );
    } finally {
      if (id === loadRequest.current && workspaceId === currentWorkspace.current) setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    const loading = loadRequest;
    const quick = quickRequest;
    setLoadedWorkspace(workspaceId);
    setResult(null);
    setTimezone(null);
    setActiveQuickTaskId(null);
    setQuickTask(null);
    setQuickTransitions([]);
    setQuickError(null);
    setLoadingQuickStatus(false);
    void load();
    return () => { loading.current++; quick.current++; };
  }, [load, workspaceId]);

  const links = useMemo(() => {
    if (!date || !timezone || !user?.id) return null;
    const today = getCalendarRange('day', date, timezone);
    const upcomingEnd = getCalendarRange(
      'day',
      shiftCalendarDate('day', shiftCalendarDate('week', date, 1, timezone), 1, timezone),
      timezone
    ).to;
    const base = `/workspaces/${workspaceId}/tasks?assignee_id=${encodeURIComponent(user.id)}`;
    return {
      today: `${base}&bucket=active&due_from=${encodeURIComponent(today.from)}&due_to=${encodeURIComponent(today.to)}&sort=due_at`,
      upcoming: `${base}&bucket=active&due_from=${encodeURIComponent(today.to)}&due_to=${encodeURIComponent(upcomingEnd)}&sort=due_at`,
      overdue: `${base}&bucket=active&due_to=${encodeURIComponent(today.from)}&sort=due_at`,
    };
  }, [date, timezone, user?.id, workspaceId]);

  const handleQuickStatus = async (task: MyWorkTask) => {
    const id = ++quickRequest.current;
    setActiveQuickTaskId(task.id);
    setLoadingQuickStatus(true);
    setQuickError(null);
    setQuickTransitions([]);
    try {
      const [detailRes, transRes] = await Promise.all([
        api.tasks.get(workspaceId, task.id),
        api.tasks.availableTransitions(workspaceId, task.id),
      ]);
      if (id !== quickRequest.current || workspaceId !== currentWorkspace.current) return;
      setQuickTask({ id: task.id, version: detailRes.data.version });
      setQuickTransitions(transRes.data);
    } catch (err) {
      if (id !== quickRequest.current || workspaceId !== currentWorkspace.current) return;
      setQuickError(
        err instanceof ApiError && err.status === 409
          ? 'VERSION_CONFLICT'
          : err instanceof Error
          ? err.message
          : 'Gagal memuat transisi status'
      );
    } finally {
      if (id === quickRequest.current && workspaceId === currentWorkspace.current) setLoadingQuickStatus(false);
    }
  };

  const handleTransition = async (toStatusId: string) => {
    if (!quickTask) return;
    const id = ++quickRequest.current;
    setLoadingQuickStatus(true);
    setQuickError(null);
    try {
      await api.tasks.transition(workspaceId, quickTask.id, {
        version: quickTask.version,
        to_status_id: toStatusId,
      });
      if (workspaceId !== currentWorkspace.current) return;
      if (id === quickRequest.current) {
        setActiveQuickTaskId(null);
        setQuickTask(null);
      }
      await load();
    } catch (err) {
      if (id !== quickRequest.current || workspaceId !== currentWorkspace.current) return;
      if (err instanceof ApiError && err.status === 409) {
        setQuickError('VERSION_CONFLICT');
      } else {
        setQuickError(err instanceof Error ? err.message : 'Transition failed');
      }
    } finally {
      if (id === quickRequest.current && workspaceId === currentWorkspace.current) setLoadingQuickStatus(false);
    }
  };

  const handleCloseQuickStatus = () => {
    quickRequest.current++;
    setActiveQuickTaskId(null);
    setQuickTask(null);
    setQuickError(null);
  };

  if (loading || loadedWorkspace !== workspaceId) return (
    <div role="status" aria-label="Memuat Pekerjaan Saya" className="space-y-5">
      <div className="h-16 max-w-md animate-pulse rounded-lg bg-surface-subtle motion-reduce:animate-none" />
      <div className="h-36 animate-pulse rounded-xl border border-border bg-surface motion-reduce:animate-none" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-44 animate-pulse rounded-xl border border-border bg-surface motion-reduce:animate-none" />
        <div className="h-44 animate-pulse rounded-xl border border-border bg-surface motion-reduce:animate-none" />
      </div>
      <span className="sr-only">Memuat Pekerjaan Saya…</span>
    </div>
  );
  if (error)
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Pekerjaan Saya</h1>
          <p className="mt-1 text-sm text-muted-foreground">Tugas yang paling membutuhkan perhatian Anda.</p>
        </div>
        <div className="rounded-xl border border-danger/35 bg-surface p-5">
          <p role="alert" className="text-sm font-medium text-danger">{error}</p>
          <button type="button" onClick={() => void load()} className="mt-4 min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-foreground hover:bg-surface-subtle">
            Coba lagi
          </button>
        </div>
      </div>
    );
  if (!result || !links) return null;
  const { data, meta } = result;

  const sectionProps = {
    timezone: meta.timezone,
    onOpen: (id: string) => router.push(taskRoute(workspaceId, id)),
    onQuickStatus: handleQuickStatus,
    activeQuickTaskId,
    loadingQuickStatus,
    quickTransitions,
    quickError,
    onTransition: handleTransition,
    onCloseQuickStatus: handleCloseQuickStatus,
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-2 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Pekerjaan Saya</h1>
          <p className="mt-1 text-sm text-muted-foreground">Fokus pada tugas yang perlu ditindaklanjuti lebih dulu.</p>
        </div>
        <p className="text-sm tabular-nums text-muted-foreground">{formatDateDisplay(meta.date)} · {meta.timezone}</p>
      </header>

      <TaskSection
        title="Terlambat"
        tasks={data.overdue}
        empty="Tidak ada tugas yang terlambat."
        href={links.overdue}
        linkLabel="Lihat semua tugas terlambat"
        tone="danger"
        {...sectionProps}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <TaskSection
          title="Hari ini"
          tasks={data.today}
          empty="Tidak ada tugas yang perlu dikerjakan hari ini."
          href={links.today}
          linkLabel="Lihat semua tugas hari ini"
          {...sectionProps}
        />
        <TaskSection
          title="Mendatang"
          tasks={data.upcoming}
          empty="Tidak ada tugas mendatang."
          href={links.upcoming}
          linkLabel="Lihat semua tugas mendatang"
          {...sectionProps}
        />
      </div>
    </div>
  );
}
