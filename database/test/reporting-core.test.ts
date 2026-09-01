import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { ascPriorityRank, buildKpiEligiblePredicate, buildOperationalActivePredicate, getMtdPeriod, isInReportingInterval, isOverdue, isUpcoming, parseReportingInterval } from '../src/reporting-core.js';

const dialect = new PgDialect();
const render = (predicate: ReturnType<typeof buildOperationalActivePredicate>) => dialect.sqlToQuery(predicate);

describe('reporting core', () => {
  it('builds canonical operational-active and KPI predicates with correct bound values', () => {
    const operational = render(buildOperationalActivePredicate());
    const eligible = render(buildKpiEligiblePredicate());
    expect(operational.sql).toContain('"tasks"."deleted_at" is null and "task_statuses"."is_terminal" = $1');
    expect(operational.params).toEqual([false]);
    expect(eligible.sql).toContain('"tasks"."deleted_at" is null and "task_statuses"."category" <> $1');
    expect(eligible.params).toEqual(['CANCELLED']);
  });

  it('ranks priorities explicitly', () => {
    expect(['URGENT', 'HIGH', 'MEDIUM', 'LOW'].sort((a, b) => ascPriorityRank(a) - ascPriorityRank(b))).toEqual(['URGENT', 'HIGH', 'MEDIUM', 'LOW']);
  });

  it('validates exact finite ISO reporting intervals and half-open boundaries', () => {
    const period = parseReportingInterval({ from: '2026-09-01T00:00:00Z', to: '2026-09-02T00:00:00Z' });
    expect(period).toEqual({ from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-02T00:00:00Z') });
    expect(isInReportingInterval(period.from, period)).toBe(true);
    expect(isInReportingInterval(period.to, period)).toBe(false);
    for (const input of [{ from: '2026-09-02T00:00:00Z', to: '2026-09-01T00:00:00Z' }, { from: '2026-09-01T00:00:00Z' }, { from: '2026-02-30T00:00:00Z', to: '2026-03-01T00:00:00Z' }, { from: '2026-09-01T24:00:00Z', to: '2026-09-02T00:00:00Z' }, { from: '2026-09-01T00:00:00+99:00', to: '2026-09-02T00:00:00Z' }]) expect(() => parseReportingInterval(input)).toThrow('INVALID_REPORTING_INTERVAL');
  });

  it('uses evaluation_at for month-to-date cutoff', () => {
    expect(getMtdPeriod(new Date('2026-09-15T12:00:00Z'), 'UTC')).toEqual({ from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-15T12:00:00Z'), evaluationAt: new Date('2026-09-15T12:00:00Z') });
  });

  it('puts local tomorrow midnight in Upcoming and keeps overdue equality strict', () => {
    const now = new Date('2026-09-01T12:00:00Z');
    expect(isUpcoming(new Date('2026-09-02T00:00:00Z'), now, 'UTC')).toBe(true);
    expect(isUpcoming(new Date('2026-09-01T14:00:00Z'), new Date('2026-09-01T12:00:00Z'), 'Asia/Jakarta')).toBe(false);
    expect(isUpcoming(new Date('2026-09-01T17:00:00Z'), new Date('2026-09-01T12:00:00Z'), 'Asia/Jakarta')).toBe(true);
    expect(isOverdue(new Date('2026-09-01T12:00:00Z'), now)).toBe(false);
    expect(isOverdue(new Date('2026-09-01T11:59:59Z'), now)).toBe(true);
  });
});
