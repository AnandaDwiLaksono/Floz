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

const timeout = (milliseconds: number) => new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), milliseconds));

export function memoizeBullWorkerClose(worker: { close(force?: boolean): Promise<unknown> }) {
  let closing: Promise<void> | undefined;
  return () => closing ??= Promise.resolve(worker.close(false)).then(() => undefined);
}

export function createWorkerShutdownCoordinator(resources: WorkerShutdownResources) {
  let stopping: Promise<void> | undefined;
  const run = async () => {
    let failed = false;
    const deadline = timeout(35_000);
    const abort = new Error('worker shutdown deadline exceeded');
    const beforeDeadline = async (action: Action) => {
      if (await Promise.race([Promise.resolve(action()).then(() => false), deadline.then(() => true)])) throw abort;
    };
    try {
      await beforeDeadline(resources.markNotReady ?? (() => undefined));
      await beforeDeadline(resources.requestHeartbeat ?? (() => undefined));
      await beforeDeadline(resources.requestLoopStops);
      const gracefulWork = Promise.all([Promise.resolve(resources.closeWorkers()), Promise.resolve(resources.waitForLoops())]);
      await Promise.race([gracefulWork, timeout(30_000)]);
      for (const action of [resources.closeQueues, resources.releaseAdvisoryLocks, resources.closeDatabaseOwners, resources.closeRedis]) {
        try { await beforeDeadline(action); } catch (error) { failed = true; if (error === abort) throw error; resources.logger.error({ err: error }, 'worker shutdown cleanup failed'); }
      }
    } catch (error) {
      failed = true;
      resources.logger.error({ err: error }, 'worker shutdown failed');
    }
    resources.exit(failed ? 1 : 0);
  };
  return { resources, stop: () => stopping ??= run() };
}
