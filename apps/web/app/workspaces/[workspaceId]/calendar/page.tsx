'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError, CalendarTaskSummary, Team, WorkspaceMember } from '../../../../lib/api-client';
import { CalendarView, formatCalendarLabel, getCalendarDayKey, getTaskCalendarDayKeys, getCalendarRange, getTodayInTimezone, shiftCalendarDate } from '../../../../lib/calendar-time';

const views: CalendarView[] = ['month', 'week', 'day'];

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

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const workspace = await api.workspaces.get(workspaceId);
        if (!active) return;
        const nextTimezone = workspace.data.timezone || 'UTC';
        setTimezone(nextTimezone);
        const [teamResult, memberResult] = await Promise.all([
          api.workspaces.teams(workspaceId),
          api.workspaces.members(workspaceId),
        ]);
        if (!active) return;
        setTeams(teamResult.data);
        setMembers(memberResult.data);
        setMetadataLoaded(true);
        if (invalidState) {
          setTasks([]);
          setError(hasInvalidView ? 'Invalid calendar view.' : 'Invalid calendar date.');
          return;
        }
        const actualRange = getCalendarRange(view, date, nextTimezone);
        const calendar = await api.tasks.calendar(workspaceId, { ...actualRange, team_id: teamId, assignee_id: assigneeId });
        if (!active) return;
        setTasks(calendar.data);
      } catch (err) {
        if (!active) return;
        setError(err instanceof ApiError && err.status === 403 ? 'You do not have access to this calendar.' : err instanceof Error ? err.message : 'Failed to load calendar');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [workspaceId, view, date, teamId, assigneeId, invalidState, hasInvalidView]);

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
  const create = (day: string) => router.push(`/workspaces/${workspaceId}/tasks?create=1&prefill_start_at=${day}T09:00&prefill_due_at=${day}T10:00&prefill_timezone=${encodeURIComponent(timezone)}`);

  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-2xl font-bold">Calendar</h2><p className="text-sm text-gray-500">Timezone: {timezone}</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => update({ date: getTodayInTimezone(timezone) })} className="rounded border px-3 py-2 text-sm">Today</button>
        <button type="button" aria-label="Previous period" onClick={() => update({ date: shiftCalendarDate(view, date, -1, timezone) })} className="rounded border px-3 py-2 text-sm">Previous</button>
        <button type="button" aria-label="Next period" onClick={() => update({ date: shiftCalendarDate(view, date, 1, timezone) })} className="rounded border px-3 py-2 text-sm">Next</button>
        {views.map((item) => <button key={item} type="button" aria-label={`${item[0].toUpperCase()}${item.slice(1)} view`} aria-pressed={view === item} onClick={() => update({ view: item })} className="rounded border px-3 py-2 text-sm">{item[0].toUpperCase() + item.slice(1)} view</button>)}
      </div>
    </div>
    <div className="grid gap-2 sm:grid-cols-2">
      <select aria-label="Team" value={teamId} onChange={(event) => update({ team_id: event.target.value })} className="rounded border p-2"><option value="">All teams</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select>
      <select aria-label="Assignee" value={assigneeId} onChange={(event) => update({ assignee_id: event.target.value })} className="rounded border p-2"><option value="">All assignees</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.user?.full_name || member.user_id}</option>)}</select>
    </div>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {loading && <p role="status">Loading calendar range…</p>}
    {!loading && metadataLoaded && !error && <div className={view === 'month' ? 'grid gap-2 sm:grid-cols-2 lg:grid-cols-7' : 'space-y-2'}>
      {days.map((day) => <section key={day} className="min-h-32 rounded border p-2">
        <div className="mb-2 flex items-center justify-between gap-2"><h3 className="font-semibold">{formatCalendarLabel(`${day}T00:00:00.000Z`, timezone, { weekday: view === 'month' ? 'short' : 'long', month: 'short', day: 'numeric' })}</h3><button type="button" aria-label={`Create task on ${day}`} onClick={() => create(day)} className="rounded border px-2 py-1 text-sm">Create</button></div>
        <div className="space-y-2">{(grouped[day] || []).map((task) => <button key={task.id} type="button" onClick={() => router.push(`/workspaces/${workspaceId}/tasks?selected_task_id=${task.id}`)} className="block w-full rounded border p-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800"><strong>{task.title}</strong><span className="block text-xs text-gray-500">{task.is_deadline_only ? 'Deadline only' : `${task.status.name} · ${task.priority}`}{task.primary_assignee ? ` · ${task.primary_assignee.full_name}` : ''}</span></button>)}</div>
      </section>)}
      {!tasks.length && <p className="text-sm text-gray-500">{teamId || assigneeId ? 'No tasks match these filters.' : 'No tasks in this range.'}</p>}
    </div>}
  </div>;
}
