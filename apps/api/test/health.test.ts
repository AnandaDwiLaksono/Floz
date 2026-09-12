import { describe, expect, it, vi } from 'vitest';
import { HealthController } from '../src/health.controller';
import { ReadinessService } from '../src/readiness.service';

describe('HealthController', () => {
  it('preserves the cheap API health response', () => {
    expect(new HealthController({ check: vi.fn() } as never).health()).toEqual({ data: { status: 'ok', service: 'api' } });
  });

  it('uses the same cheap response for explicit liveness', () => {
    const controller = new HealthController({ check: vi.fn().mockResolvedValue(true) } as never);

    expect(controller.live()).toEqual({ data: { status: 'ok', service: 'api' } });
  });
});

describe('ReadinessService', () => {
  it('returns ready after the shared AuthService SQL probe succeeds', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const service = new ReadinessService({ database: { sql } } as never);

    await expect(service.check()).resolves.toBe(true);
    expect(sql).toHaveBeenCalledTimes(1);
  });

  it('returns not ready when the shared database probe fails', async () => {
    const service = new ReadinessService({ database: { sql: vi.fn().mockRejectedValue(new Error('postgres://secret')) } } as never);

    await expect(service.check()).resolves.toBe(false);
  });

  it('cancels and settles a timed-out probe before admitting a replacement', async () => {
    vi.useFakeTimers();
    let rejectQuery!: (error: Error) => void;
    const query = new Promise((_, reject) => { rejectQuery = reject; }) as Promise<unknown> & { cancel: () => void };
    query.cancel = vi.fn(() => rejectQuery(new Error('cancelled')));
    const sql = vi.fn(() => query);
    const service = new ReadinessService({ database: { sql } } as never);
    const first = service.check();
    const contended = service.check();

    await vi.advanceTimersByTimeAsync(2000);
    await expect(first).resolves.toBe(false);
    await expect(contended).resolves.toBe(false);
    expect(query.cancel).toHaveBeenCalledTimes(1);
    expect(sql).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('returns not ready while stopping without querying PostgreSQL', async () => {
    const sql = vi.fn();
    const service = new ReadinessService({ database: { sql } } as never);
    service.stop();

    await expect(service.check()).resolves.toBe(false);
    expect(sql).not.toHaveBeenCalled();
  });
});
