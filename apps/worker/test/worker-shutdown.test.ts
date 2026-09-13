import { afterEach, describe, expect, it, vi } from 'vitest';
import { Worker } from 'bullmq';
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
    hardTerminate: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn() }
  });
  return { calls, coordinator };
};

afterEach(() => vi.useRealTimers());

describe('worker shutdown coordinator', () => {
  it('shuts down in dependency-safe order', async () => {
    const { calls, coordinator } = setup();
    await coordinator.stop();
    expect(calls).toEqual(['not-ready', 'heartbeat', 'request-loops', 'workers', 'loops-finished', 'queues', 'redis', 'advisory', 'database']);
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
    expect(calls).not.toContain('queues');
    hung.resolve();
    await stopping;
    expect(calls.slice(-4)).toEqual(['queues', 'redis', 'advisory', 'database']);
  });

  it('hard-terminates at exactly 35 seconds when tracked cleanup remains unresolved', async () => {
    vi.useFakeTimers();
    const hung = deferred();
    const { calls, coordinator } = setup();
    coordinator.resources.closeQueues = async () => { calls.push('queues'); await hung.promise; };
    void coordinator.stop();
    await vi.advanceTimersByTimeAsync(34_999);
    expect(coordinator.resources.hardTerminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(coordinator.resources.hardTerminate).toHaveBeenCalledWith(1);
    expect(calls).toContain('queues');
  });

  it('continues remaining cleanup after a transient error and releases advisory ownership before database pools', async () => {
    const { calls, coordinator } = setup();
    coordinator.resources.closeQueues = vi.fn(async () => { calls.push('queues'); throw new Error('transient'); });
    await coordinator.stop();
    expect(calls.slice(-3)).toEqual(['redis', 'advisory', 'database']);
    expect(coordinator.resources.exit).toHaveBeenCalledWith(1);
  });

  it('forces bounded cleanup after the 30 second grace result and clears both timers', async () => {
    vi.useFakeTimers();
    const graceful = deferred();
    const { calls, coordinator } = setup();
    coordinator.resources.waitForLoops = () => graceful.promise;
    const stopping = coordinator.stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).not.toContain('queues');
    graceful.resolve();
    await stopping;
    expect(calls).toContain('queues');
    expect(coordinator.resources.exit).toHaveBeenCalledWith(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts the hard deadline before a hung stopping hook and still runs best-effort cleanup', async () => {
    vi.useFakeTimers();
    const hung = deferred();
    const { calls, coordinator } = setup();
    coordinator.resources.markNotReady = () => hung.promise;
    const stopping = coordinator.stop();
    await Promise.resolve();
    expect(calls).toContain('request-loops');
    expect(calls).toContain('workers');
    await vi.advanceTimersByTimeAsync(35_000);
    expect(coordinator.resources.hardTerminate).toHaveBeenCalledWith(1);
    expect(coordinator.resources.exit).not.toHaveBeenCalled();
    hung.resolve();
    await stopping;
    expect(calls.slice(-3)).toEqual(['redis', 'advisory', 'database']);
    expect(coordinator.resources.exit).toHaveBeenCalledWith(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('BullMQ close memoization', () => {
  it('memoizes the installed BullMQ Worker.close(false) method without escalation', async () => {
    const close = vi.spyOn(Worker.prototype, 'close').mockResolvedValue();
    const worker = Object.create(Worker.prototype) as Worker;
    const memoized = memoizeBullWorkerClose(worker);
    expect(memoized()).toBe(memoized());
    await memoized();
    expect(close).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith(false);
  });
});
