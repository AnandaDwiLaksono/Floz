type Action = () => Promise<void> | void;

type Logger = { info(message: string): void; error(input: unknown, message: string): void };

export type WorkerShutdownResources = {
  markNotReady?: Action;
  requestHeartbeat?: Action;
  requestLoopStops: Action;
  waitForLoops: Action;
  closeWorkers: Action;
  closeQueues: Action;
  releaseAdvisoryLocks: Action;
  closeDatabaseOwners: Action;
  closeRedis: Action;
  exit: (code: 0 | 1) => void;
  logger: Logger;
};

const bounded = async <T>(action: () => Promise<T> | T, milliseconds: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(action),
      new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), milliseconds); })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export function memoizeBullWorkerClose(worker: { close(force?: boolean): Promise<unknown> }) {
  let closing: Promise<void> | undefined;
  return () => closing ??= Promise.resolve(worker.close(false)).then(() => undefined);
}

export function createWorkerShutdownCoordinator(resources: WorkerShutdownResources) {
  let stopping: Promise<void> | undefined;
  const run = async () => {
    let failed = false;
    const started = Date.now();
    const remaining = () => Math.max(0, 35_000 - (Date.now() - started));
    const runBestEffort = async (action: Action) => {
      try {
        if (await bounded(action, remaining()) === 'timeout') { failed = true; return false; }
      } catch (error) { failed = true; resources.logger.error({ err: error }, 'worker shutdown cleanup failed'); }
      return true;
    };
    try {
      const notReady = Promise.resolve((resources.markNotReady ?? (() => undefined))());
      const loopStop = Promise.resolve(resources.requestLoopStops());
      const workerClose = Promise.resolve(resources.closeWorkers());
      await runBestEffort(() => notReady);
      await runBestEffort(resources.requestHeartbeat ?? (() => undefined));
      const graceful = await bounded(() => Promise.all([loopStop, workerClose, resources.waitForLoops()]), Math.min(30_000, remaining()));
      if (graceful === 'timeout') failed = true;
    } catch (error) {
      failed = true;
      resources.logger.error({ err: error }, 'worker shutdown failed');
    } finally {
      for (const action of [resources.closeQueues, resources.closeRedis, resources.releaseAdvisoryLocks, resources.closeDatabaseOwners]) {
        if (!(await runBestEffort(action))) break;
      }
    }
    resources.exit(failed ? 1 : 0);
  };
  return { resources, stop: () => stopping ??= run() };
}
