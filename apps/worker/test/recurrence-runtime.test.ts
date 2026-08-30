import { describe, expect, it } from 'vitest';
import { parseWorkerEnv } from '@floz/config';
import { buildWakeupJobId } from '../src/queues.js';
import { startWorkerRuntime } from '../src/main.js';

describe('recurrence worker runtime', () => {
  it('builds deterministic wake-up job IDs', () => {
    expect(buildWakeupJobId({ recurrenceRuleId: 'rule-1', scheduledFor: '2026-08-30T12:00:00.000Z' })).toBe(
      'recurrence-b6a9c436b2798d4b4b0eed82fa106080265243e22e7d6440e442c447855ce938'
    );
  });

  it('keeps distinct wake-up identities distinct', () => {
    expect(buildWakeupJobId({ recurrenceRuleId: 'a:b', scheduledFor: 'c' })).not.toBe(
      buildWakeupJobId({ recurrenceRuleId: 'a', scheduledFor: 'b:c' })
    );
  });

  it('defaults concurrency and rejects invalid values', () => {
    expect(parseWorkerEnv({ NODE_ENV: 'test' }).WORKER_CONCURRENCY).toBe(5);
    expect(() => parseWorkerEnv({ WORKER_CONCURRENCY: '0' })).toThrow();
    expect(() => parseWorkerEnv({ WORKER_CONCURRENCY: '1.5' })).toThrow();
    expect(parseWorkerEnv({ REDIS_TLS: 'false' }).REDIS_TLS).toBe(false);
  });

  it('closes injected worker, queue, and connection once', async () => {
    const closed: string[] = [];
    const runtime = await startWorkerRuntime({
      env: parseWorkerEnv({ NODE_ENV: 'test' }),
      createConnection: () => ({ close: async () => void closed.push('connection') }),
      createQueue: () => ({ close: async () => void closed.push('queue') }),
      createWorker: () => ({ close: async () => void closed.push('worker') }),
      startDispatcher: () => async () => void closed.push('dispatcher')
    });

    await runtime.stop();
    await runtime.stop();

    expect(closed).toEqual(['dispatcher', 'worker', 'queue', 'connection']);
  });

  it('stops through SIGTERM without Redis', async () => {
    const closed: string[] = [];
    const runtime = await startWorkerRuntime({
      env: parseWorkerEnv({ NODE_ENV: 'test' }),
      registerSignalHandlers: true,
      createConnection: () => ({ close: async () => void closed.push('connection') }),
      createQueue: () => ({ close: async () => void closed.push('queue') }),
      createWorker: () => ({ close: async () => void closed.push('worker') }),
      startDispatcher: () => async () => void closed.push('dispatcher')
    });

    process.emit('SIGTERM');
    await new Promise((resolve) => setImmediate(resolve));

    expect(closed).toEqual(['dispatcher', 'worker', 'queue', 'connection']);
    await runtime.stop();
  });
});
