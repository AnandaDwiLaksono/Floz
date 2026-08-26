import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('shifts week navigation by workspace calendar weeks', () => {
    expect(shiftCalendarDate('week', '2026-08-18', 1, 'Asia/Jakarta')).toBe('2026-08-25');
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
});
