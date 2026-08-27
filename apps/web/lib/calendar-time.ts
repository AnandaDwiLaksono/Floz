export type CalendarView = 'month' | 'week' | 'day';

type CivilDate = { year: number; month: number; day: number };

function parseDate(date: string): CivilDate {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
}

function addDays(date: CivilDate, days: number): CivilDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function addMonths(date: CivilDate, months: number): CivilDate {
  const next = new Date(Date.UTC(date.year, date.month - 1 + months, 1));
  const year = next.getUTCFullYear();
  const month = next.getUTCMonth() + 1;
  const day = Math.min(date.day, new Date(Date.UTC(year, month, 0)).getUTCDate());
  return { year, month, day };
}

function formatDate(date: CivilDate): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

function mondayStart(date: CivilDate): CivilDate {
  const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

function zonedParts(instant: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, Number(part.value)]));
}

function offsetMs(instant: Date, timezone: string): number {
  const parts = zonedParts(instant, timezone);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return localAsUtc - instant.getTime();
}

function fromZoned(date: CivilDate, timezone: string, hour = 0, minute = 0): Date {
  const guess = new Date(Date.UTC(date.year, date.month - 1, date.day, hour, minute));
  return new Date(guess.getTime() - offsetMs(guess, timezone));
}

function fromZonedMidnight(date: CivilDate, timezone: string): Date {
  return fromZoned(date, timezone);
}

function rangeDates(view: CalendarView, date: string): { start: CivilDate; end: CivilDate } {
  const value = parseDate(date);
  if (view === 'day') return { start: value, end: addDays(value, 1) };
  if (view === 'week') {
    const start = mondayStart(value);
    return { start, end: addDays(start, 7) };
  }
  const start = { year: value.year, month: value.month, day: 1 };
  return { start, end: addMonths(start, 1) };
}

export function getCalendarRange(view: CalendarView, date: string, timezone: string): { from: string; to: string } {
  const { start, end } = rangeDates(view, date);
  return { from: fromZonedMidnight(start, timezone).toISOString(), to: fromZonedMidnight(end, timezone).toISOString() };
}

export function formatCalendarLabel(iso: string, timezone: string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: timezone, ...options }).format(new Date(iso));
}

export function getCalendarDayKey(iso: string, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const zoned = Object.fromEntries(formatter.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${zoned.year}-${zoned.month}-${zoned.day}`;
}

export function shiftCalendarDate(view: CalendarView, date: string, direction: -1 | 1, timezone: string): string {
  void timezone;
  const value = parseDate(date);
  if (view === 'month') return formatDate(addMonths(value, direction));
  return formatDate(addDays(value, direction * (view === 'week' ? 7 : 1)));
}

export function getTodayInTimezone(timezone: string): string {
  return getCalendarDayKey(new Date().toISOString(), timezone);
}

export function getWorkspaceDateTime(value: string, timezone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error('Invalid workspace date-time');
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  return fromZoned(date, timezone, Number(match[4]), Number(match[5])).toISOString();
}
