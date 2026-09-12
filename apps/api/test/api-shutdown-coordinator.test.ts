import { describe, expect, it, vi } from 'vitest';
import { ApiShutdownCoordinator, type ShutdownServer } from '../src/api-shutdown-coordinator.js';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

const setup = () => {
  const events: string[] = [];
  const drain = deferred();
  const timers = new Map<number, ReturnType<typeof deferred>>();
  const server: ShutdownServer = {
    close: vi.fn((callback) => { events.push('server.close'); void drain.promise.then(() => callback()); return server; }),
    closeIdleConnections: vi.fn(() => { events.push('idle.close'); }),
    closeAllConnections: vi.fn(() => { events.push('sockets.destroy'); })
  };
  const app = { close: vi.fn(async () => { events.push('app.close'); }) };
  const readiness = { stop: vi.fn(() => { events.push('readiness.stop'); }) };
  const exit = vi.fn((code: number) => { events.push(`exit.${code}`); });
  const sleep = vi.fn((ms: number) => {
    const timer = deferred();
    timers.set(ms, timer);
    return timer.promise;
  });
  const coordinator = new ApiShutdownCoordinator(app, server, readiness, { sleep, exit });
  return { coordinator, server, app, readiness, exit, events, drain, timers };
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ApiShutdownCoordinator', () => {
  it('marks not-ready, stops admission, drains, then closes the app exactly once', async () => {
    const fixture = setup();
    const shutdown = fixture.coordinator.shutdown();
    expect(fixture.events).toEqual(['readiness.stop', 'server.close', 'idle.close']);
    fixture.drain.resolve();
    await shutdown;
    expect(fixture.events).toEqual(['readiness.stop', 'server.close', 'idle.close', 'app.close', 'exit.0']);
    expect(fixture.app.close).toHaveBeenCalledOnce();
  });

  it('rejects requests admitted after shutdown begins', async () => {
    const fixture = setup();
    const next = vi.fn();
    const response = { status: vi.fn().mockReturnThis(), end: vi.fn() };
    const shutdown = fixture.coordinator.shutdown();
    fixture.coordinator.admissionGate({ method: 'POST' } as never, response as never, next);
    expect(response.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
    fixture.drain.resolve();
    await shutdown;
  });

  it('memoizes repeated signals and shutdown calls', async () => {
    const fixture = setup();
    fixture.coordinator.install({ once: vi.fn() } as never);
    const first = fixture.coordinator.shutdown();
    expect(fixture.coordinator.shutdown()).toBe(first);
    fixture.drain.resolve();
    await first;
    expect(fixture.server.close).toHaveBeenCalledOnce();
    expect(fixture.app.close).toHaveBeenCalledOnce();
  });

  it('forces sockets at exactly 30 seconds and exits 1 after cleanup', async () => {
    const fixture = setup();
    const shutdown = fixture.coordinator.shutdown();
    fixture.timers.get(30000)?.resolve();
    await tick();
    expect(fixture.events).toContain('sockets.destroy');
    fixture.drain.resolve();
    await shutdown;
    expect(fixture.exit).toHaveBeenCalledWith(1);
  });

  it('exits 1 when application cleanup fails', async () => {
    const fixture = setup();
    fixture.app.close.mockRejectedValueOnce(new Error('cleanup'));
    const shutdown = fixture.coordinator.shutdown();
    fixture.drain.resolve();
    await shutdown;
    expect(fixture.exit).toHaveBeenCalledWith(1);
    expect(fixture.app.close).toHaveBeenCalledOnce();
  });

  it('uses the 35-second outer boundary as forced failure', async () => {
    const fixture = setup();
    const shutdown = fixture.coordinator.shutdown();
    fixture.timers.get(35000)?.resolve();
    await shutdown;
    expect(fixture.server.closeAllConnections).toHaveBeenCalledOnce();
    expect(fixture.exit).toHaveBeenCalledWith(1);
  });
});
