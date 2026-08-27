import { describe, expect, test } from 'vitest';
import {
  resolveFirstOccurrence,
  resolveNextOccurrence,
  resolveNextOccurrenceAfterUpdate,
  validateExecutableRecurrence,
  validateGeneratedSchedule,
  type RecurrenceScheduleInput,
} from './recurrence';

const base = (overrides: Partial<RecurrenceScheduleInput> = {}): RecurrenceScheduleInput => ({
  frequency: 'MONTHLY', intervalValue: 1, timezone: 'Asia/Jakarta', startAt: new Date('2027-01-31T02:00:00Z'), ...overrides,
});

const sequence = (input: RecurrenceScheduleInput, count: number) => {
  const values = [resolveFirstOccurrence(input)];
  for (let i = 1; i < count; i += 1) values.push(resolveNextOccurrence({ ...input, latestGeneratedScheduledFor: values[i - 1] })!);
  return values.map((value) => value.toISOString());
};

describe('recurrence calculator', () => {
  test('monthly 31 falls back and returns to anchor', () => expect(sequence(base(), 3)).toEqual(['2027-01-31T02:00:00.000Z', '2027-02-28T02:00:00.000Z', '2027-03-31T02:00:00.000Z']));
  test('monthly fallback handles leap year', () => expect(sequence(base({ startAt: new Date('2028-01-31T02:00:00Z') }), 3)).toEqual(['2028-01-31T02:00:00.000Z', '2028-02-29T02:00:00.000Z', '2028-03-31T02:00:00.000Z']));
  test('march 31 falls back in april then returns in may', () => expect(sequence(base({ startAt: new Date('2027-03-31T02:00:00Z') }), 3)).toEqual(['2027-03-31T02:00:00.000Z', '2027-04-30T02:00:00.000Z', '2027-05-31T02:00:00.000Z']));
  test('monthly 30 falls back in february without drift', () => {
    expect(sequence(base({ startAt: new Date('2027-01-30T02:00:00Z') }), 3)).toEqual(['2027-01-30T02:00:00.000Z', '2027-02-28T02:00:00.000Z', '2027-03-30T02:00:00.000Z']);
    expect(sequence(base({ startAt: new Date('2028-01-30T02:00:00Z') }), 3)).toEqual(['2028-01-30T02:00:00.000Z', '2028-02-29T02:00:00.000Z', '2028-03-30T02:00:00.000Z']);
  });
  test('monthly interval preserves anchor', () => expect(sequence(base({ intervalValue: 2 }), 3)).toEqual(['2027-01-31T02:00:00.000Z', '2027-03-31T02:00:00.000Z', '2027-05-31T02:00:00.000Z']));
  test('daily and weekly preserve local anchors', () => {
    expect(sequence(base({ frequency: 'DAILY', startAt: new Date('2027-01-31T02:00:00Z') }), 2)).toEqual(['2027-01-31T02:00:00.000Z', '2027-02-01T02:00:00.000Z']);
    expect(sequence(base({ frequency: 'WEEKLY', intervalValue: 2, startAt: new Date('2027-01-06T02:00:00Z') }), 2)).toEqual(['2027-01-06T02:00:00.000Z', '2027-01-20T02:00:00.000Z']);
  });
  test('limits include first occurrence', () => expect(resolveNextOccurrence(base({ occurrenceLimit: 1, generatedCount: 1 }))).toBeNull());
  test('first occurrence equal to end has no next occurrence', () => expect(resolveNextOccurrence(base({ endAt: new Date('2027-01-31T02:00:00Z'), latestGeneratedScheduledFor: new Date('2027-01-31T02:00:00Z') }))).toBeNull());
  test('monthly interval fallback uses canonical anchor across short month', () => expect(sequence(base({ startAt: new Date('2027-12-31T02:00:00Z'), intervalValue: 2 }), 3)).toEqual(['2027-12-31T02:00:00.000Z', '2028-02-29T02:00:00.000Z', '2028-04-30T02:00:00.000Z']));
  test('end boundary is inclusive', () => expect(resolveNextOccurrence(base({ endAt: new Date('2027-02-28T02:00:00Z'), latestGeneratedScheduledFor: new Date('2027-01-31T02:00:00Z') }))?.toISOString()).toBe('2027-02-28T02:00:00.000Z'));
  test('end before first rejects', () => expect(() => resolveFirstOccurrence(base({ endAt: new Date('2027-01-30T02:00:00Z') }))).toThrow('VALIDATION_ERROR'));
  test('due time earlier than start rejects', () => expect(() => validateGeneratedSchedule(new Date('2027-01-01T10:00:00Z'), new Date('2027-01-01T09:00:00Z'))).toThrow('VALIDATION_ERROR'));
  test('custom and invalid intervals reject', () => {
    expect(() => validateExecutableRecurrence(base({ frequency: 'CUSTOM' }))).toThrow('UNSUPPORTED_RECURRENCE_RULE');
    expect(() => validateExecutableRecurrence(base({ intervalValue: 0 }))).toThrow('VALIDATION_ERROR');
  });
  test('updates are prospective without backfill or anchor drift', () => expect(resolveNextOccurrenceAfterUpdate({ ...base({ frequency: 'WEEKLY', startAt: new Date('2027-01-06T02:00:00Z') }), effectiveChangeTime: new Date('2027-03-10T10:00:00Z'), latestGeneratedScheduledFor: new Date('2027-03-01T09:00:00Z') })?.toISOString()).toBe('2027-03-17T02:00:00.000Z'));
  test('updates respect occurrence limits', () => expect(resolveNextOccurrenceAfterUpdate({ ...base({ occurrenceLimit: 2, generatedCount: 2 }), effectiveChangeTime: new Date('2027-02-01T00:00:00Z'), latestGeneratedScheduledFor: new Date('2027-01-31T02:00:00Z') })).toBeNull());
  test('prospective monthly update keeps canonical anchor after fallback', () => expect(resolveNextOccurrenceAfterUpdate({ ...base({ startAt: new Date('2027-01-31T02:00:00Z') }), effectiveChangeTime: new Date('2027-03-01T00:00:00Z'), latestGeneratedScheduledFor: new Date('2027-02-28T02:00:00Z') })?.toISOString()).toBe('2027-03-31T02:00:00.000Z'));
  test('long-running daily recurrence does not stop at an artificial cap', () => expect(resolveNextOccurrence({ ...base({ frequency: 'DAILY', startAt: new Date('2027-01-01T02:00:00Z') }), latestGeneratedScheduledFor: new Date('2055-01-01T02:00:00Z') })?.toISOString()).toBe('2055-01-02T02:00:00.000Z'));
});
