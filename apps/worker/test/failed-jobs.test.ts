import { describe, expect, it } from 'vitest';
import { failedJobDiagnosticRows } from '../src/failed-jobs.js';

describe('failed job diagnostics', () => {
  it('returns at most 100 safe fields without payload or error details', async () => {
    const rows = await failedJobDiagnosticRows({
      getFailed: async () => Array.from({ length: 101 }, (_, index) => ({ id: `job-${index}`, name: 'wake', data: { secret: 'x' }, failedReason: 'secret', stacktrace: ['secret'], timestamp: 10, processedOn: 20, finishedOn: 30, attemptsMade: 3 }))
    });
    expect(rows).toHaveLength(100);
    expect(rows[0]).toEqual({ jobId: 'job-0', type: 'wake', status: 'failed', code: 'WORKER_JOB_FAILED', timing: { timestamp: 10, processedOn: 20, finishedOn: 30 } });
    expect(JSON.stringify(rows)).not.toContain('secret');
  });

  it('does not expose mutation operations', async () => {
    let calls = 0;
    const rows = await failedJobDiagnosticRows({ getFailed: async () => [{ id: 'job-1', name: 'wake' }] });
    calls += rows.length;
    expect(calls).toBe(1);
  });
});
