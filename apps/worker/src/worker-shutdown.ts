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
  hardTerminate?: (code: 1) => void;
  logger: Logger;
};

export function memoizeBullWorkerClose(worker: { close(force?: boolean): Promise<unknown> }) {
  let closing: Promise<void> | undefined;
  return (force?: boolean) => { void force; return closing ??= Promise.resolve(worker.close(false)).then(() => undefined); };
}

export function createWorkerShutdownCoordinator(resources: WorkerShutdownResources) {
  let stopping: Promise<void> | undefined;
  const run = async () => {
    let failed = false;
    const invoke = (action: Action) => {
      try { return Promise.resolve(action()); } catch (error) { return Promise.reject(error); }
    };
    const settle = async (actions: Action[]) => {
      const results = await Promise.allSettled(actions.map(invoke));
      for (const result of results) {
        if (result.status === 'rejected') {
          failed = true;
          resources.logger.error({ err: result.reason }, 'worker shutdown cleanup failed');
        }
      }
    };
    let cleanup: Promise<void> | undefined;
    const startCleanup = () => cleanup ??= (async () => {
      await settle([resources.closeQueues]);
      await settle([resources.closeRedis]);
      await settle([resources.releaseAdvisoryLocks]);
      await settle([resources.closeDatabaseOwners]);
    })();
    const forced = setTimeout(() => { failed = true; void startCleanup(); }, 30_000);
    const hard = setTimeout(() => (resources.hardTerminate ?? ((code) => process.exit(code)))(1), 35_000);
    try {
      const heartbeat = invoke(resources.requestHeartbeat ?? (() => undefined));
      const notReady = invoke(resources.markNotReady ?? (() => undefined));
      const drainRequests = [resources.requestLoopStops, resources.closeWorkers].map(invoke);
      await settle([() => Promise.all([notReady, ...drainRequests]).then(() => undefined), resources.waitForLoops]);
      await settle([() => heartbeat]);
      await startCleanup();
      resources.exit(failed ? 1 : 0);
    } finally {
      clearTimeout(forced);
      clearTimeout(hard);
    }
  };
  return { resources, stop: () => stopping ??= run() };
}
