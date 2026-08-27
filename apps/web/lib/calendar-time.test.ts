import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api-client';
import {
  formatCalendarLabel,
  getCalendarDayKey,
  getCalendarRange,
  getTodayInTimezone,
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

  it('builds a calendar endpoint query with bounded range and filters', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ data: [], meta: { from: 'a', to: 'b' } });
    vi.stubGlobal('fetch', fetchMock as never);

    await api.tasks.calendar('ws-1', { from: 'a', to: 'b', team_id: 'team-1', assignee_id: 'user-1' });

    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/workspaces/ws-1/calendar/tasks?from=a&to=b&team_id=team-1&assignee_id=user-1');
  });
});
