import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Worker } from 'bullmq';
import { parseWorkerEnv } from '@floz/config';
import { claimOutboxBatch, createDatabase, markOutboxDispatched, markOutboxRetry } from '@floz/database';
import { createLogger } from '@floz/observability';
import { dispatchOutboxBatch } from './outbox-dispatcher.js';
import { createRecurrenceWorker, createNotificationDueSoonWorker } from './recurrence-worker.js';
import { createRecurrenceQueue, createRedisConnection, QUEUES } from './queues.js';
import { startReconciliationLoop } from './reconciliation.js';

type Closeable = { close(): Promise<unknown> };
type Connection = { close?(): Promise<unknown>; quit?(): Promise<unknown> };
type DispatcherStop = () => Promise<void>;
type WorkerEnv = ReturnType<typeof parseWorkerEnv>;
type Logger = ReturnType<typeof createLogger>;

export type WorkerRuntimeDeps = {
  env?: WorkerEnv;
  logger?: Logger;
  registerSignalHandlers?: boolean;
  createConnection?: (env: WorkerEnv) => Connection;
  createQueue?: (connection: Connection) => Closeable;
  createWorker?: (connection: Connection, concurrency: number) => Closeable;
  startDispatcher?: (queue: Closeable) => DispatcherStop;
  startReconciliation?: () => DispatcherStop;
};

export async function startWorkerRuntime(deps: WorkerRuntimeDeps = {}) {
  const env = deps.env ?? parseWorkerEnv(process.env);
  const logger = deps.logger ?? createLogger('worker', env.LOG_LEVEL);
  const connection: Connection = (deps.createConnection ?? createRedisConnection)(env);
  const queue = (deps.createQueue ?? ((value: Connection) => createRecurrenceQueue(value as never)))(connection);
  const worker = (
    deps.createWorker ??
    ((value: Connection, concurrency: number) => {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) throw new Error('DATABASE_URL is required');
      const { sql } = createDatabase(databaseUrl);
      const bullWorker = new Worker(QUEUES.recurrenceWakeup, createRecurrenceWorker({ sql }), { connection: value as never, concurrency });
      const dueSoonWorker = new Worker(QUEUES.notificationDueSoon, createNotificationDueSoonWorker({ sql }), { connection: value as never, concurrency });
      const close = bullWorker.close.bind(bullWorker);
      const closeDueSoon = dueSoonWorker.close.bind(dueSoonWorker);
      bullWorker.close = async () => { await close(); await closeDueSoon(); await sql.end(); };
      return bullWorker;
    })
  )(connection, env.WORKER_CONCURRENCY);
  const stopDispatcher = (deps.startDispatcher ?? ((value: Closeable) => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return async () => undefined;
    const { sql } = createDatabase(databaseUrl);
    const claimToken = randomUUID();
    const controller = new AbortController();
    const active = (async () => {
      while (!controller.signal.aborted) {
        await dispatchOutboxBatch({ db: sql, queue: value as never, claimToken, claim: claimOutboxBatch, markDispatched: markOutboxDispatched, markRetry: markOutboxRetry }).catch((error: unknown) => logger.error(error, 'outbox dispatch failed'));
        await delay(1000, undefined, { signal: controller.signal }).catch(() => undefined);
      }
    })();
    return async () => {
      controller.abort();
      await active;
      await sql.end();
    };
  }))(queue);
    const stopReconciliation = (deps.startReconciliation ?? (() => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return async () => undefined;
    const { sql } = createDatabase(databaseUrl);
    const { sql: claimSql } = createDatabase(databaseUrl);
    const stopLoop = startReconciliationLoop({ sql, claimSql, intervalMs: env.RECURRENCE_RECONCILIATION_INTERVAL_MS, batchSize: env.RECURRENCE_RECONCILIATION_BATCH_SIZE, onError: (error) => logger.error(error, 'recurrence reconciliation failed'), databaseUrl });
    return async () => { await stopLoop(); await sql.end(); await claimSql.end(); };
  }))();
  let stopping: Promise<void> | undefined;
  const stop = () => {
    if (!stopping) {
      stopping = (async () => {
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
        await stopReconciliation();
        await stopDispatcher();
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
