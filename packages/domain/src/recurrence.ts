export type ExecutableFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';
export type RecurrenceFrequency = ExecutableFrequency | 'CUSTOM';

export interface RecurrenceScheduleInput {
  frequency: RecurrenceFrequency;
  intervalValue: number;
  timezone: string;
  startAt: Date;
  endAt?: Date | null;
  occurrenceLimit?: number | null;
  generatedCount?: number;
  anchorDay?: number | null;
  latestGeneratedScheduledFor?: Date | null;
}

export interface RecurrenceUpdateInput extends RecurrenceScheduleInput {
  effectiveChangeTime: Date;
  latestGeneratedScheduledFor: Date;
}

type LocalTime = { year: number; month: number; day: number; hour: number; minute: number; second: number; millisecond: number };

function parts(instant: Date, timezone: string): LocalTime {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const values = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, Number(part.value)]));
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute, second: values.second, millisecond: instant.getUTCMilliseconds() };
}

function fromLocal(local: LocalTime, timezone: string): Date {
  const guess = new Date(Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second, local.millisecond));
  const localAtGuess = parts(guess, timezone);
  const offset = Date.UTC(localAtGuess.year, localAtGuess.month - 1, localAtGuess.day, localAtGuess.hour, localAtGuess.minute, localAtGuess.second, localAtGuess.millisecond) - guess.getTime();
  return new Date(guess.getTime() - offset);
}

function addDays(local: LocalTime, days: number): LocalTime {
  const next = new Date(Date.UTC(local.year, local.month - 1, local.day + days, local.hour, local.minute, local.second, local.millisecond));
  return { ...local, year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function addMonths(local: LocalTime, months: number, anchorDay: number): LocalTime {
  const next = new Date(Date.UTC(local.year, local.month - 1 + months, 1));
  const year = next.getUTCFullYear();
  const month = next.getUTCMonth() + 1;
  const day = Math.min(anchorDay, new Date(Date.UTC(year, month, 0)).getUTCDate());
  return { ...local, year, month, day };
}

function isExecutable(frequency: RecurrenceFrequency): frequency is ExecutableFrequency {
  return frequency === 'DAILY' || frequency === 'WEEKLY' || frequency === 'MONTHLY';
}

export function validateExecutableRecurrence(input: RecurrenceScheduleInput): void {
  if (!isExecutable(input.frequency)) throw new Error('UNSUPPORTED_RECURRENCE_RULE');
  if (!Number.isInteger(input.intervalValue) || input.intervalValue <= 0) throw new Error('VALIDATION_ERROR');
  if (input.endAt && input.occurrenceLimit) throw new Error('VALIDATION_ERROR');
  if (input.occurrenceLimit != null && (!Number.isInteger(input.occurrenceLimit) || input.occurrenceLimit <= 0)) throw new Error('VALIDATION_ERROR');
  if (input.frequency === 'MONTHLY' && input.anchorDay != null && (!Number.isInteger(input.anchorDay) || input.anchorDay < 1 || input.anchorDay > 31)) throw new Error('VALIDATION_ERROR');
}

function occurrence(input: RecurrenceScheduleInput, index: number): Date {
  const local = parts(input.startAt, input.timezone);
  if (input.frequency === 'DAILY') return fromLocal(addDays(local, index * input.intervalValue), input.timezone);
  if (input.frequency === 'WEEKLY') return fromLocal(addDays(local, index * input.intervalValue * 7), input.timezone);
  return fromLocal(addMonths(local, index * input.intervalValue, input.anchorDay ?? local.day), input.timezone);
}

function passesEnd(input: RecurrenceScheduleInput, candidate: Date): boolean {
  return !input.endAt || candidate <= input.endAt;
}

export function resolveFirstOccurrence(input: RecurrenceScheduleInput): Date {
  validateExecutableRecurrence(input);
  const first = occurrence(input, 0);
  if (!passesEnd(input, first)) throw new Error('VALIDATION_ERROR');
  return first;
}

export function resolveNextOccurrence(input: RecurrenceScheduleInput): Date | null {
  validateExecutableRecurrence(input);
  if (input.occurrenceLimit != null && (input.generatedCount ?? 1) >= input.occurrenceLimit) return null;
  const after = input.latestGeneratedScheduledFor ?? input.startAt;
  for (let i = 1; i < 10000; i += 1) {
    const candidate = occurrence(input, i);
    if (candidate <= after) continue;
    if (!passesEnd(input, candidate)) return null;
    return candidate;
  }
  return null;
}

export function resolveNextOccurrenceAfterUpdate(input: RecurrenceUpdateInput): Date | null {
  validateExecutableRecurrence(input);
  const after = new Date(Math.max(input.effectiveChangeTime.getTime(), input.latestGeneratedScheduledFor.getTime()));
  for (let i = 1; i < 10000; i += 1) {
    const candidate = occurrence(input, i);
    if (candidate <= after) continue;
    if (!passesEnd(input, candidate)) return null;
    return candidate;
  }
  return null;
}

export function validateGeneratedSchedule(startAt: Date | null, dueAt: Date | null): void {
  if (startAt && dueAt && dueAt < startAt) throw new Error('VALIDATION_ERROR');
}
