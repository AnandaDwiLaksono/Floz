import { describe, expect, it } from 'vitest';
import { parseWorkerEnv } from '@floz/config';
import { buildWakeupJobId } from '../src/queues.js';
import { startWorkerRuntime } from '../src/main.js';
import { createNotificationDueSoonWorker } from '../src/recurrence-worker.js';

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

  it('defaults concurrency and reconciliation settings and rejects invalid values', () => {
    expect(parseWorkerEnv({ NODE_ENV: 'test' })).toMatchObject({ WORKER_CONCURRENCY: 1, RECURRENCE_RECONCILIATION_INTERVAL_MS: 30000, RECURRENCE_RECONCILIATION_BATCH_SIZE: 50 });
    expect(() => parseWorkerEnv({ WORKER_CONCURRENCY: '0' })).toThrow();
    expect(() => parseWorkerEnv({ WORKER_CONCURRENCY: '1.5' })).toThrow();
    expect(parseWorkerEnv({ REDIS_TLS: 'false' }).REDIS_TLS).toBe('false');
  });

  it('settles notification progress when database setup fails', async () => {
    const progress: boolean[] = [];
    const handler = createNotificationDueSoonWorker({ sql: {} as never, databaseUrl: 'invalid', progress: async (active) => { progress.push(active); } });

    await expect(handler({ data: { workspaceId: 'workspace-1', taskId: 'task-1', dueVersion: 1 } } as never)).rejects.toThrow();

    expect(progress).toEqual([true, false]);
  });

  it('closes injected worker, queue, and connection once', async () => {
    const closed: string[] = [];
    const runtime = await startWorkerRuntime({
      env: parseWorkerEnv({ NODE_ENV: 'test' }),
      heartbeat: { initialize: async () => undefined, stopping: async () => undefined, remove: async () => undefined },
      createConnection: () => ({ close: async () => void closed.push('connection') }),
      createQueue: () => ({ close: async () => void closed.push('queue') }),
      createWorker: () => ({ close: async () => void closed.push('worker') }),
      startDispatcher: () => async () => void closed.push('dispatcher'),
      startReconciliation: () => async () => void closed.push('reconciliation')
    });

    await runtime.stop();
    await runtime.stop();

    expect(closed).toEqual(['dispatcher', 'reconciliation', 'worker', 'queue', 'connection']);
  });

  it('stops through SIGTERM without Redis', async () => {
    const closed: string[] = [];
    const runtime = await startWorkerRuntime({
      env: parseWorkerEnv({ NODE_ENV: 'test' }),
      heartbeat: { initialize: async () => undefined, stopping: async () => undefined, remove: async () => undefined },
      registerSignalHandlers: true,
      createConnection: () => ({ close: async () => void closed.push('connection') }),
      createQueue: () => ({ close: async () => void closed.push('queue') }),
      createWorker: () => ({ close: async () => void closed.push('worker') }),
      startDispatcher: () => async () => void closed.push('dispatcher'),
      startReconciliation: () => async () => void closed.push('reconciliation')
    });

    process.emit('SIGTERM');
    await new Promise((resolve) => setImmediate(resolve));

    expect(closed).toEqual(['dispatcher', 'reconciliation', 'worker', 'queue', 'connection']);
    await runtime.stop();
  });
});
