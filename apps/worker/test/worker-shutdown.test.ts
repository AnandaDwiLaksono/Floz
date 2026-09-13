import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkerShutdownCoordinator, memoizeBullWorkerClose } from '../src/worker-shutdown.js';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

const setup = () => {
  const calls: string[] = [];
  const action = (name: string) => vi.fn(async () => { calls.push(name); });
  const coordinator = createWorkerShutdownCoordinator({
    markNotReady: action('not-ready'),
    requestHeartbeat: action('heartbeat'),
    requestLoopStops: action('request-loops'),
    waitForLoops: action('loops-finished'),
    closeWorkers: action('workers'),
    closeQueues: action('queues'),
    releaseAdvisoryLocks: action('advisory'),
    closeDatabaseOwners: action('database'),
    closeRedis: action('redis'),
    exit: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn() }
  });
  return { calls, coordinator };
};

afterEach(() => vi.useRealTimers());

describe('worker shutdown coordinator', () => {
  it('shuts down in dependency-safe order', async () => {
    const { calls, coordinator } = setup();
    await coordinator.stop();
    expect(calls).toEqual(['not-ready', 'heartbeat', 'request-loops', 'workers', 'loops-finished', 'queues', 'advisory', 'database', 'redis']);
  });

  it('memoizes repeated shutdown requests', async () => {
    const { coordinator } = setup();
    expect(coordinator.stop()).toBe(coordinator.stop());
    await coordinator.stop();
  });

  it('bounds graceful work at exactly 30 seconds and cleanup continues', async () => {
    vi.useFakeTimers();
    const hung = deferred();
    const { calls, coordinator } = setup();
    coordinator.resources.waitForLoops = () => hung.promise;
    const stopping = coordinator.stop();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(calls).not.toContain('queues');
    await vi.advanceTimersByTimeAsync(1);
    await stopping;
    expect(calls.slice(-4)).toEqual(['queues', 'advisory', 'database', 'redis']);
  });

  it('hard-fails at exactly 35 seconds when cleanup hangs without detached continuation', async () => {
    vi.useFakeTimers();
    const hung = deferred();
    const { calls, coordinator } = setup();
    coordinator.resources.closeQueues = async () => { calls.push('queues'); await hung.promise; };
    const stopping = coordinator.stop();
    await vi.advanceTimersByTimeAsync(34_999);
    expect(coordinator.resources.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await stopping;
    expect(coordinator.resources.exit).toHaveBeenCalledWith(1);
    hung.resolve();
    await Promise.resolve();
    expect(calls).not.toContain('database');
  });

  it('closes later owners after a transient cleanup error and exits one', async () => {
    const { coordinator } = setup();
    coordinator.resources.closeQueues = vi.fn(async () => { throw new Error('transient'); });
    await coordinator.stop();
    expect(coordinator.resources.closeDatabaseOwners).toHaveBeenCalled();
    expect(coordinator.resources.closeRedis).toHaveBeenCalled();
    expect(coordinator.resources.exit).toHaveBeenCalledWith(1);
  });
});

describe('BullMQ close memoization', () => {
  it('calls the installed BullMQ worker close(false) once and never escalates', async () => {
    const close = vi.fn(async () => undefined);
    const worker = { close };
    const memoized = memoizeBullWorkerClose(worker);
    expect(memoized()).toBe(memoized());
    await memoized();
    expect(close).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith(false);
  });
});
