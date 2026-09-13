import { describe, expect, it, vi } from 'vitest';
import { failedJobDiagnosticRows, runFailedJobsDiagnostic } from '../src/failed-jobs.js';

describe('failed job diagnostics', () => {
  it('returns at most 100 safe rows across both active queues', async () => {
    const recurrence = { getFailed: vi.fn(async () => Array.from({ length: 80 }, (_, index) => ({ id: `recurrence-${index}`, name: 'wake', data: { secret: 'x' }, failedReason: 'secret', stacktrace: ['secret'], timestamp: 10, processedOn: 20, finishedOn: 30 }))) };
    const notification = { getFailed: vi.fn(async () => Array.from({ length: 30 }, (_, index) => ({ id: `notification-${index}`, name: 'due-soon' }))) };
    const rows = await failedJobDiagnosticRows([recurrence, notification]);
    expect(rows).toHaveLength(100);
    expect(recurrence.getFailed).toHaveBeenCalledWith(0, 99);
    expect(notification.getFailed).toHaveBeenCalledWith(0, 19);
    expect(rows[0]).toEqual({ jobId: 'recurrence-0', type: 'wake', status: 'failed', code: 'WORKER_JOB_FAILED', timing: { timestamp: 10, processedOn: 20, finishedOn: 30 } });
    expect(JSON.stringify(rows)).not.toContain('secret');
  });

  it('never retries, removes, or re-drives failed jobs', async () => {
    const retry = vi.fn();
    const remove = vi.fn();
    await failedJobDiagnosticRows([{ getFailed: async () => [{ id: 'job-1', name: 'wake', retry, remove }] }]);
    const add = vi.fn();
    expect(retry).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('bounds stalled reads and cleanup', async () => {
    vi.useFakeTimers();
    const disconnect = vi.fn();
    const close = vi.fn(() => new Promise<void>(() => undefined));
    const run = runFailedJobsDiagnostic({
      timeoutMs: 10,
      write: vi.fn(),
      createConnection: () => ({ disconnect }),
      createQueues: () => [
        { getFailed: () => new Promise<never>(() => undefined), close },
        { getFailed: async () => [], close }
      ]
    });
    const rejected = expect(run).rejects.toThrow('Failed-job diagnostic timed out');
    await vi.advanceTimersByTimeAsync(30);
    await rejected;
    expect(disconnect).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
