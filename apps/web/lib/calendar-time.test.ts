import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api-client';
import {
  formatCalendarLabel,
  getCalendarDayKey,
  getCalendarRange,
  getTodayInTimezone,
  getWorkspaceDateTime,
  getTaskCalendarDayKeys,
  shiftCalendarDate,
} from './calendar-time';

describe('calendar-time', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds a month range in workspace timezone using half-open boundaries', () => {
    expect(getCalendarRange('month', '2026-08-18', 'Asia/Jakarta')).toEqual({
      from: '2026-07-31T17:00:00.000Z',
      to: '2026-08-31T17:00:00.000Z',
    });
  });

  it('keeps task day grouping stable across browser timezone differences', () => {
    expect(getCalendarDayKey('2026-08-01T00:30:00.000Z', 'Asia/Jakarta')).toBe('2026-08-01');
    expect(getCalendarDayKey('2026-08-01T00:30:00.000Z', 'America/New_York')).toBe('2026-07-31');
  });

  it('builds Monday-start week boundaries in the workspace timezone', () => {
    expect(getCalendarRange('week', '2026-08-18', 'Asia/Jakarta')).toEqual({
      from: '2026-08-16T17:00:00.000Z',
      to: '2026-08-23T17:00:00.000Z',
    });
  });

  it('shifts calendar dates by their explicit view interval', () => {
    expect(shiftCalendarDate('day', '2026-08-18', -1, 'America/New_York')).toBe('2026-08-17');
    expect(shiftCalendarDate('week', '2026-08-18', 1, 'Asia/Jakarta')).toBe('2026-08-25');
    expect(shiftCalendarDate('month', '2026-01-31', 1, 'Asia/Jakarta')).toBe('2026-02-28');
    expect(shiftCalendarDate('month', '2026-03-31', -1, 'America/New_York')).toBe('2026-02-28');
  });

  it('handles DST-aware range conversion', () => {
    expect(getCalendarRange('day', '2026-11-01', 'America/New_York')).toEqual({
      from: '2026-11-01T04:00:00.000Z',
      to: '2026-11-02T05:00:00.000Z',
    });
  });

  it('formats and gets today in the requested timezone', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T23:30:00.000Z'));
    expect(getCalendarDayKey('2026-08-01T23:30:00.000Z', 'Asia/Jakarta')).toBe('2026-08-02');
    expect(formatCalendarLabel('2026-08-01T23:30:00.000Z', 'Asia/Jakarta', { dateStyle: 'short' })).toBe('02/08/2026');
    expect(getTodayInTimezone('Asia/Jakarta')).toBe('2026-08-02');
  });

  it('converts workspace-local task form values to deterministic UTC', () => {
    expect(getWorkspaceDateTime('2026-08-18T09:00', 'Asia/Jakarta')).toBe('2026-08-18T02:00:00.000Z');
    expect(getWorkspaceDateTime('2026-11-01T09:00', 'America/New_York')).toBe('2026-11-01T14:00:00.000Z');
  });

  it('renders scheduled tasks on every visible workspace-local day they overlap', () => {
    expect(getTaskCalendarDayKeys(
      { start_at: '2026-07-31T16:00:00.000Z', due_at: '2026-08-02T18:00:00.000Z', is_deadline_only: false },
      ['2026-08-01', '2026-08-02', '2026-08-03'],
      'Asia/Jakarta',
    )).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
  });

  it('renders deadline-only tasks only on their due day', () => {
    expect(getTaskCalendarDayKeys(
      { start_at: null, due_at: '2026-08-02T18:00:00.000Z', is_deadline_only: true },
      ['2026-08-01', '2026-08-02', '2026-08-03'],
      'Asia/Jakarta',
    )).toEqual(['2026-08-03']);
  });

  it('fetches and returns the calendar task list', async () => {
    const calendarTaskList = {
      data: [
        {
          id: 'task-1',
          task_key: 'TASK-1',
          title: 'Plan release',
          status: { id: 'status-1', name: 'In Progress', code: 'IN_PROGRESS', category: 'active' },
          priority: 'HIGH' as const,
          start_at: '2026-08-01T09:00:00.000Z',
          due_at: '2026-08-01T10:00:00.000Z',
          is_deadline_only: false,
          primary_assignee: { id: 'user-1', full_name: 'Ada Lovelace' },
        },
      ],
      meta: { from: 'a', to: 'b' },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(calendarTaskList), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.tasks.calendar('ws-1', {
      from: 'a',
      to: 'b',
      team_id: 'team-1',
      assignee_id: 'user-1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/v1/workspaces/ws-1/calendar/tasks?from=a&to=b&team_id=team-1&assignee_id=user-1',
      expect.objectContaining({ credentials: 'include' })
    );
    expect(result).toEqual(calendarTaskList);
  });
});
