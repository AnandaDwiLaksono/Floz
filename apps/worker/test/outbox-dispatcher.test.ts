import { describe, expect, it, vi } from 'vitest';
import { dispatchOutboxBatch } from '../src/outbox-dispatcher.js';

describe('outbox dispatcher', () => {
  it('enqueues before marking dispatched and uses a deterministic safe job ID', async () => {
    const row = {
      id: 'event-1',
      workspace_id: 'workspace-1',
      aggregate_id: 'rule-1',
      event_type: 'RECURRENCE_WAKEUP',
      payload: { recurrence_rule_id: 'rule-1', scheduled_for: '2026-08-30T12:00:00.000Z' },
      available_at: new Date('2026-08-30T00:00:00.000Z'),
      attempt_count: 1,
      claimed_by: 'dispatcher-1',
      claimed_until: new Date('2026-08-30T00:01:00.000Z')
    };
    const order: string[] = [];
    const queue = { add: vi.fn(async (_name: string, _data: unknown, options: { jobId: string }) => { order.push('enqueue'); expect(options.jobId).toBe('recurrence-rule-1-2026-08-30T12_00_00.000Z'); }) };
    const claim = vi.fn(async () => [row]);
    const dispatched = vi.fn(async () => { order.push('dispatched'); return true; });

    expect(await dispatchOutboxBatch({ db: {}, queue, dispatcherId: 'dispatcher-1', now: new Date('2026-08-30T00:00:01.000Z'), claim, markDispatched: dispatched, markRetry: vi.fn() })).toBe(1);
    expect(order).toEqual(['enqueue', 'dispatched']);
  });

  it('marks enqueue failures retryable', async () => {
    const retry = vi.fn(async () => true);
    const row = { id: 'event-1', workspace_id: 'workspace-1', aggregate_id: 'rule-1', event_type: 'RECURRENCE_WAKEUP', payload: { recurrence_rule_id: 'rule-1' }, available_at: new Date(), attempt_count: 2, claimed_by: 'dispatcher-1', claimed_until: new Date(Date.now() + 60_000) };
    const queue = { add: vi.fn(async () => { throw new Error('redis unavailable'); }) };
    expect(await dispatchOutboxBatch({ db: {}, queue, dispatcherId: 'dispatcher-1', now: new Date(), claim: async () => [row], markDispatched: vi.fn(), markRetry: retry, retryDelayMs: 5000 })).toBe(0);
    expect(retry).toHaveBeenCalledWith({}, expect.objectContaining({ id: 'event-1', dispatcherId: 'dispatcher-1' }));
  });
});
