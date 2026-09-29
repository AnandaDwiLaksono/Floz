'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError, CalendarTaskSummary, Team, WorkspaceMember } from '../../../../lib/api-client';
import { CalendarView, getCalendarDayKey, getTaskCalendarDayKeys, getCalendarRange, getTodayInTimezone, shiftCalendarDate } from '../../../../lib/calendar-time';

const label = (iso: string, timezone: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('id-ID', { timeZone: timezone, ...options }).format(new Date(iso));
import { taskRoute } from '../../../../lib/task-route';
import { formatStatusName } from '../../../../lib/i18n-labels';

const views: CalendarView[] = ['month', 'week', 'day'];
const viewNames: Record<CalendarView, string> = { month: 'Bulan', week: 'Minggu', day: 'Hari' };

function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export default function CalendarPage() {
  const { workspaceId } = useParams() as { workspaceId: string };
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedView = searchParams.get('view');
  const hasInvalidView = requestedView !== null && !views.includes(requestedView as CalendarView);
  const view: CalendarView = hasInvalidView ? 'month' : requestedView as CalendarView || 'month';
  const requestedDate = searchParams.get('date');
  const teamId = searchParams.get('team_id') || '';
  const assigneeId = searchParams.get('assignee_id') || '';
  const [timezone, setTimezone] = useState('UTC');
  const [tasks, setTasks] = useState<CalendarTaskSummary[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [metadataLoaded, setMetadataLoaded] = useState(false);

  const hasInvalidDate = requestedDate !== null && !validDate(requestedDate);
  const invalidState = hasInvalidView || hasInvalidDate;
  const date = validDate(requestedDate) ? requestedDate : getTodayInTimezone(timezone);
  const range = useMemo(() => getCalendarRange(view, date, timezone), [view, date, timezone]);
  const update = useCallback((values: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(values).forEach(([key, value]) => value ? params.set(key, value) : params.delete(key));
    router.push(`/workspaces/${workspaceId}/calendar?${params.toString()}`);
  }, [router, searchParams, workspaceId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const workspace = await api.workspaces.get(workspaceId);
      const nextTimezone = workspace.data.timezone || 'UTC';
      setTimezone(nextTimezone);
      const [teamResult, memberResult] = await Promise.all([
        api.workspaces.teams(workspaceId),
        api.workspaces.members(workspaceId),
      ]);
      setTeams(teamResult.data);
      setMembers(memberResult.data);
      setMetadataLoaded(true);
      if (invalidState) {
        setTasks([]);
        setError(hasInvalidView ? 'Tampilan kalender tidak valid.' : 'Tanggal kalender tidak valid.');
        return;
      }
      const actualRange = getCalendarRange(view, date, nextTimezone);
      const calendar = await api.tasks.calendar(workspaceId, { ...actualRange, team_id: teamId, assignee_id: assigneeId });
      setTasks(calendar.data);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? 'Anda tidak memiliki akses ke kalender ini.' : 'Kalender belum dapat dimuat.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, view, date, teamId, assigneeId, invalidState, hasInvalidView]);

  useEffect(() => { void load(); }, [load]);

  const days = useMemo(() => {
    const output: string[] = [];
    for (let cursor = range.from; cursor < range.to;) {
      const key = getCalendarDayKey(cursor, timezone);
      output.push(key);
      cursor = getCalendarRange('day', key, timezone).to;
    }
    return output;
  }, [range, timezone]);
  const grouped = useMemo(() => tasks.reduce<Record<string, CalendarTaskSummary[]>>((result, task) => {
    for (const key of getTaskCalendarDayKeys(task, days, timezone)) (result[key] ||= []).push(task);
    return result;
  }, {}), [tasks, days, timezone]);
  const context = { view, date, team_id: teamId, assignee_id: assigneeId };
  const calendarReturnUrl = useMemo(() => {
    const params = new URLSearchParams({ view, date });
    if (teamId) params.set('team_id', teamId);
    if (assigneeId) params.set('assignee_id', assigneeId);
    return `/workspaces/${workspaceId}/calendar?${params}`;
  }, [workspaceId, view, date, teamId, assigneeId]);
  const taskDetailRoute = (taskId: string, edit_schedule = false) => `${taskRoute(workspaceId, taskId, { edit_schedule, calendarContext: context })}&return_to=${encodeURIComponent(calendarReturnUrl)}`;
  const create = (day: string) => {
    const params = new URLSearchParams({
      create: '1',
      prefill_start_at: `${day}T09:00`,
      prefill_due_at: `${day}T10:00`,
      prefill_timezone: timezone,
      cal_view: view,
      cal_date: date,
      return_to: calendarReturnUrl,
    });
    if (teamId) params.set('cal_team_id', teamId);
    if (assigneeId) params.set('cal_assignee_id', assigneeId);
    router.push(`/workspaces/${workspaceId}/tasks?${params}`);
  };
  const periodHeading = useMemo(() => {
    if (view === 'day') return label(`${date}T12:00:00Z`, timezone, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (view === 'month') return label(`${date}T12:00:00Z`, timezone, { month: 'long', year: 'numeric' });
    const start = label(range.from, timezone, { day: 'numeric', month: 'short' });
    const end = label(new Date(new Date(range.to).getTime() - 1).toISOString(), timezone, { day: 'numeric', month: 'short', year: 'numeric' });
    return `${start} - ${end}`;
  }, [view, date, range, timezone]);

  const renderTask = (task: CalendarTaskSummary) => {
    const isMonth = view === 'month';
    const detailRoute = taskDetailRoute(task.id, false);
    return (
      <article
        key={task.id}
        className="group flex min-w-0 items-start justify-between gap-1.5 rounded border border-border/70 bg-surface p-1.5 text-xs hover:border-border hover:bg-surface-subtle"
      >
        <button
          type="button"
          aria-label={task.title}
          onClick={() => router.push(detailRoute)}
          className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          {task.is_deadline_only && (
            <div className="mb-0.5">
              <span className="inline-block rounded bg-warning/15 px-1 py-0.5 text-[9px] font-semibold leading-none text-warning-foreground">
                Tenggat
              </span>
            </div>
          )}
          <p className="line-clamp-2 text-xs font-medium leading-snug text-foreground">{task.title}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
            {!task.is_deadline_only && task.start_at && (
              <span>{label(task.start_at, timezone, { hour: '2-digit', minute: '2-digit' })}</span>
            )}
            {!task.is_deadline_only && task.status?.name && (
              <span>· {formatStatusName(task.status.name)}</span>
            )}
          </div>
        </button>
        {!isMonth && (
          <button
            type="button"
            aria-label={`Ubah jadwal ${task.title}`}
            onClick={() => router.push(taskDetailRoute(task.id, true))}
            className="shrink-0 rounded border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground transition-opacity hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
          >
            Ubah
          </button>
        )}
      </article>
    );
  };

  const getDayOfWeek = (dateStr: string, tz: string): number => {
    const d = new Date(`${dateStr}T12:00:00Z`);
    const weekdayShort = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d);
    const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
    return map[weekdayShort] ?? 0;
  };

  const leadingEmptyDays = days.length > 0 ? getDayOfWeek(days[0], timezone) : 0;
  const trailingEmptyDays = days.length > 0 ? (7 - ((leadingEmptyDays + days.length) % 7)) % 7 : 0;

  return (
    <main className="space-y-4 text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Kalender</h2>
          <p className="text-xs text-muted-foreground">Zona waktu: {timezone}</p>
          <h3 className="mt-1 text-base font-semibold text-foreground" aria-live="polite">{periodHeading}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => update({ date: getTodayInTimezone(timezone) })} className="min-h-9 rounded-md border border-border px-3 text-xs font-medium hover:bg-surface-subtle">Hari ini</button>
          <button type="button" aria-label="Periode sebelumnya" onClick={() => update({ date: shiftCalendarDate(view, date, -1, timezone) })} className="min-h-9 rounded-md border border-border px-3 text-xs font-medium hover:bg-surface-subtle">Sebelumnya</button>
          <button type="button" aria-label="Periode berikutnya" onClick={() => update({ date: shiftCalendarDate(view, date, 1, timezone) })} className="min-h-9 rounded-md border border-border px-3 text-xs font-medium hover:bg-surface-subtle">Berikutnya</button>
          <div role="group" aria-label="Rentang kalender" className="flex rounded-md border border-border">
            {views.map((item) => (
              <button
                key={item}
                type="button"
                aria-label={`Tampilan ${viewNames[item].toLowerCase()}`}
                aria-pressed={view === item}
                onClick={() => update({ view: item })}
                className={`min-h-9 px-3 text-xs font-medium ${view === item ? 'bg-primary text-primary-foreground' : 'hover:bg-surface-subtle'}`}
              >
                {viewNames[item]}
              </button>
            ))}
          </div>
        </div>
      </header>
      <section aria-label="Filter kalender" className="grid gap-3 rounded-lg border border-border/80 bg-surface p-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">Tim<select aria-label="Filter tim" value={teamId} onChange={(event) => update({ team_id: event.target.value })} className="min-h-9 rounded-md border border-border bg-surface px-3 text-xs text-foreground"><option value="">Semua tim</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">Penanggung jawab<select aria-label="Filter penanggung jawab" value={assigneeId} onChange={(event) => update({ assignee_id: event.target.value })} className="min-h-9 rounded-md border border-border bg-surface px-3 text-xs text-foreground"><option value="">Semua penanggung jawab</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name || member.user_id}</option>)}</select></label>
      </section>
      {error && <div role="alert" className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}{!invalidState && <button type="button" onClick={() => void load()} className="ml-3 underline">Coba lagi</button>}</div>}
      {loading && <div role="status" aria-label="Memuat kalender" className="space-y-2">{[...Array(view === 'day' ? 2 : 4)].map((_, index) => <div key={index} className="h-16 animate-pulse rounded-md bg-surface-subtle" />)}</div>}
      {!loading && metadataLoaded && !error && (
        <>
          {!tasks.length && <p className="rounded-md border border-dashed border-border/80 p-4 text-center text-sm text-muted-foreground">{teamId || assigneeId ? 'Tidak ada tugas yang sesuai filter.' : 'Belum ada tugas pada rentang ini.'}</p>}
          {view === 'month' ? (
            <div className="space-y-2">
              <div className="hidden grid-cols-7 gap-2 md:grid text-center text-xs font-semibold text-muted-foreground pb-1">
                <div>Sen</div>
                <div>Sel</div>
                <div>Rab</div>
                <div>Kam</div>
                <div>Jum</div>
                <div>Sab</div>
                <div>Min</div>
              </div>
              <div className="hidden grid-cols-7 gap-2 md:grid min-w-0">
                {Array.from({ length: leadingEmptyDays }).map((_, i) => (
                  <div key={`lead-${i}`} className="min-w-0 rounded-md border border-dashed border-border/40 bg-surface-subtle/30 p-2 min-h-[100px]" aria-hidden="true" />
                ))}
                {days.map((day) => (
                  <section
                    key={day}
                    aria-label={label(`${day}T12:00:00Z`, timezone, { weekday: 'long', day: 'numeric', month: 'long' })}
                    className="group min-w-0 rounded-md border border-border/80 bg-surface p-2 min-h-[100px] flex flex-col justify-between"
                  >
                    <div>
                      <div className="mb-1.5 flex items-center justify-between gap-1">
                        <span className="text-xs font-semibold text-foreground">
                          {label(`${day}T12:00:00Z`, timezone, { day: 'numeric' })}
                        </span>
                        <button
                          type="button"
                          aria-label={`Buat tugas pada ${day}`}
                          onClick={() => create(day)}
                          className="inline-flex h-5 w-5 items-center justify-center rounded border border-border/50 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                        >
                          +
                        </button>
                      </div>
                      <div className="space-y-1">{(grouped[day] || []).map(renderTask)}</div>
                    </div>
                  </section>
                ))}
                {Array.from({ length: trailingEmptyDays }).map((_, i) => (
                  <div key={`trail-${i}`} className="min-w-0 rounded-md border border-dashed border-border/40 bg-surface-subtle/30 p-2 min-h-[100px]" aria-hidden="true" />
                ))}
              </div>
              <div className="grid grid-cols-1 gap-2 md:hidden">
                {days.map((day) => (
                  <section
                    key={day}
                    aria-label={label(`${day}T12:00:00Z`, timezone, { weekday: 'long', day: 'numeric', month: 'long' })}
                    className="min-w-0 rounded-md border border-border bg-surface p-3"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h4 className="truncate text-sm font-semibold">
                        {label(`${day}T12:00:00Z`, timezone, { weekday: 'short', day: 'numeric', month: 'short' })}
                      </h4>
                      <button
                        type="button"
                        aria-label={`Buat tugas pada ${day}`}
                        onClick={() => create(day)}
                        className="min-h-11 min-w-11 shrink-0 rounded border border-border px-2.5 text-xs font-medium text-foreground hover:bg-surface-subtle"
                      >
                        + Buat
                      </button>
                    </div>
                    <div className="space-y-1.5">{(grouped[day] || []).map(renderTask)}</div>
                  </section>
                ))}
              </div>
            </div>
          ) : view === 'week' ? (
            <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-7">
              {days.map((day) => (
                <section
                  key={day}
                  aria-label={label(`${day}T12:00:00Z`, timezone, { weekday: 'long', day: 'numeric', month: 'long' })}
                  className="group min-w-0 rounded-md border border-border bg-surface p-2.5 flex flex-col min-h-[140px]"
                >
                  <div className="mb-2 flex items-center justify-between gap-1 border-b border-border/50 pb-1.5">
                    <h4 className="truncate text-xs font-semibold text-foreground">
                      {label(`${day}T12:00:00Z`, timezone, { weekday: 'short', day: 'numeric' })}
                    </h4>
                    <button
                      type="button"
                      aria-label={`Buat tugas pada ${day}`}
                      onClick={() => create(day)}
                      className="inline-flex h-5 w-5 items-center justify-center rounded border border-border/50 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                    >
                      +
                    </button>
                  </div>
                  <div className="space-y-1.5 flex-1">{(grouped[day] || []).map(renderTask)}</div>
                </section>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {days.map((day) => (
                <section
                  key={day}
                  aria-label={label(`${day}T12:00:00Z`, timezone, { weekday: 'long', day: 'numeric', month: 'long' })}
                  className="min-w-0 rounded-md border border-border bg-surface p-3"
                >
                  <div className="mb-2.5 flex items-center justify-between gap-2 border-b border-border/50 pb-2">
                    <h4 className="truncate text-sm font-semibold text-foreground">
                      {label(`${day}T12:00:00Z`, timezone, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </h4>
                    <button
                      type="button"
                      aria-label={`Buat tugas pada ${day}`}
                      onClick={() => create(day)}
                      className="min-h-9 shrink-0 rounded border border-border px-3 text-xs font-medium text-foreground hover:bg-surface-subtle"
                    >
                      + Buat tugas
                    </button>
                  </div>
                  <div className="space-y-2">{(grouped[day] || []).map(renderTask)}</div>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
};
