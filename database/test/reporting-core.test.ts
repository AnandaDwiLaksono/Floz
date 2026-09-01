import { describe, expect, it } from 'vitest';
import { ascPriorityRank, buildKpiEligiblePredicate, buildOperationalActivePredicate, getMtdPeriod, isOverdue, isUpcoming, parseReportingInterval } from '../src/reporting-core.js';

describe('reporting core', () => {
  it('exports canonical operational-active and KPI predicates', () => {
    expect(buildOperationalActivePredicate().queryChunks).toHaveLength(3);
    expect(buildKpiEligiblePredicate().queryChunks).toHaveLength(3);
  });

  it('ranks priorities explicitly', () => {
    expect(['URGENT', 'HIGH', 'MEDIUM', 'LOW'].sort((a, b) => ascPriorityRank(a) - ascPriorityRank(b))).toEqual(['URGENT', 'HIGH', 'MEDIUM', 'LOW']);
  });

  it('validates half-open ISO reporting intervals', () => {
    expect(parseReportingInterval({ from: '2026-09-01T00:00:00Z', to: '2026-09-02T00:00:00Z' })).toEqual({ from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-02T00:00:00Z') });
    expect(() => parseReportingInterval({ from: '2026-09-02T00:00:00Z', to: '2026-09-01T00:00:00Z' })).toThrow('INVALID_REPORTING_INTERVAL');
    expect(() => parseReportingInterval({ from: '2026-09-01T00:00:00Z' })).toThrow('INVALID_REPORTING_INTERVAL');
  });

  it('uses evaluation_at for month-to-date cutoff', () => {
    expect(getMtdPeriod(new Date('2026-09-15T12:00:00Z'), 'UTC')).toEqual({ from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-15T12:00:00Z'), evaluationAt: new Date('2026-09-15T12:00:00Z') });
  });

  it('puts tomorrow midnight in Upcoming and equality outside Overdue', () => {
    const now = new Date('2026-09-01T12:00:00Z');
    const tomorrow = new Date('2026-09-02T00:00:00Z');
    expect(isUpcoming(tomorrow, now, 'UTC')).toBe(true);
    expect(isOverdue(new Date('2026-09-01T12:00:00Z'), now)).toBe(false);
    expect(isOverdue(new Date('2026-09-01T11:59:59Z'), now)).toBe(true);
  });
});
