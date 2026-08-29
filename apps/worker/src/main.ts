import { pathToFileURL } from 'node:url';
import { Worker } from 'bullmq';
import { parseWorkerEnv } from '@floz/config';
import { createLogger } from '@floz/observability';
import { createRecurrenceQueue, createRedisConnection, QUEUES } from './queues.js';

type Closeable = { close(): Promise<unknown> };
type Connection = { close?(): Promise<unknown>; quit?(): Promise<unknown> };
type WorkerEnv = ReturnType<typeof parseWorkerEnv>;
type Logger = ReturnType<typeof createLogger>;

export type WorkerRuntimeDeps = {
  env?: WorkerEnv;
  logger?: Logger;
  registerSignalHandlers?: boolean;
  createConnection?: (env: WorkerEnv) => Connection;
  createQueue?: (connection: Connection) => Closeable;
  createWorker?: (connection: Connection, concurrency: number) => Closeable;
};

export async function startWorkerRuntime(deps: WorkerRuntimeDeps = {}) {
  const env = deps.env ?? parseWorkerEnv(process.env);
  const logger = deps.logger ?? createLogger('worker', env.LOG_LEVEL);
  const connection: Connection = (deps.createConnection ?? createRedisConnection)(env);
  const queue = (deps.createQueue ?? ((value: Connection) => createRecurrenceQueue(value as never)))(connection);
  const worker = (
    deps.createWorker ??
    ((value: Connection, concurrency: number) =>
      new Worker(QUEUES.recurrenceWakeup, async () => undefined, { connection: value as never, concurrency }))
  )(connection, env.WORKER_CONCURRENCY);
  let stopping: Promise<void> | undefined;
  const stop = () => {
    if (!stopping) {
      stopping = (async () => {
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
        await worker.close();
        await queue.close();
        await (connection.quit?.() ?? connection.close?.());
        logger.info('worker stopped');
      })();
    }
    return stopping;
  };
  const onSignal = () => void stop();

  if (deps.registerSignalHandlers) {
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  }
  logger.info({ concurrency: env.WORKER_CONCURRENCY, queue: QUEUES.recurrenceWakeup }, 'worker started');
  return { stop };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startWorkerRuntime({ registerSignalHandlers: true });
}
