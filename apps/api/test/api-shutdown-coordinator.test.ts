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
  const server: ShutdownServer = {
    close: vi.fn((callback) => { events.push('server.close'); void drain.promise.then(() => callback()); return server; }),
    closeIdleConnections: vi.fn(() => { events.push('idle.close'); }),
    closeAllConnections: vi.fn(() => { events.push('sockets.destroy'); })
  };
  const app = { close: vi.fn(async () => { events.push('app.close'); }) };
  const readiness = { stop: vi.fn(() => { events.push('readiness.stop'); }) };
  const exit = vi.fn((code: number) => { events.push(`exit.${code}`); });
  const coordinator = new ApiShutdownCoordinator(app, server, readiness, { exit });
  return { coordinator, server, app, readiness, exit, events, drain };
};

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

  it('forces sockets at exactly 30 seconds, then waits for server close before app cleanup', async () => {
    vi.useFakeTimers();
    const fixture = setup();
    const shutdown = fixture.coordinator.shutdown();
    await vi.advanceTimersByTimeAsync(30000);
    expect(fixture.server.closeAllConnections).toHaveBeenCalledOnce();
    expect(fixture.app.close).not.toHaveBeenCalled();
    fixture.drain.resolve();
    await shutdown;
    expect(fixture.app.close).toHaveBeenCalledOnce();
    expect(fixture.exit).toHaveBeenCalledWith(1);
    vi.useRealTimers();
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

  it('hard terminates at exactly 35 seconds without starting app cleanup when server close never resolves', async () => {
    vi.useFakeTimers();
    const fixture = setup();
    const hardTerminate = vi.fn();
    const shutdown = new ApiShutdownCoordinator(fixture.app, fixture.server, fixture.readiness, { exit: fixture.exit, hardTerminate });
    void shutdown.shutdown();
    await vi.advanceTimersByTimeAsync(35000);
    expect(hardTerminate).toHaveBeenCalledOnce();
    expect(fixture.app.close).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('accepts explicit test-only timeout bounds without changing production defaults', async () => {
    vi.useFakeTimers();
    const fixture = setup();
    const hardTerminate = vi.fn();
    const shutdown = new ApiShutdownCoordinator(fixture.app, fixture.server, fixture.readiness, {
      exit: fixture.exit,
      hardTerminate,
      forceTimeoutMs: 10,
      hardDeadlineMs: 20
    });
    void shutdown.shutdown();
    await vi.advanceTimersByTimeAsync(10);
    expect(fixture.server.closeAllConnections).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10);
    expect(hardTerminate).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('hard terminates at exactly 35 seconds when app cleanup never resolves', async () => {
    vi.useFakeTimers();
    const fixture = setup();
    const hardTerminate = vi.fn();
    fixture.app.close.mockImplementationOnce(() => new Promise<void>(() => {}));
    const shutdown = new ApiShutdownCoordinator(fixture.app, fixture.server, fixture.readiness, { exit: fixture.exit, hardTerminate });
    void shutdown.shutdown();
    fixture.drain.resolve();
    await vi.advanceTimersByTimeAsync(35000);
    expect(fixture.app.close).toHaveBeenCalledOnce();
    expect(hardTerminate).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
