import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Worker } from 'bullmq';
import { parseWorkerEnv } from '@floz/config';
import { claimOutboxBatch, createDatabase, markOutboxDispatched, markOutboxRetry } from '@floz/database';
import { createLogger, sanitizeError } from '@floz/observability';
import { dispatchOutboxBatch } from './outbox-dispatcher.js';
import { createRecurrenceWorker, createNotificationDueSoonWorker } from './recurrence-worker.js';
import { createRecurrenceQueue, createRedisConnection, QUEUES } from './queues.js';
import { startReconciliationLoop } from './reconciliation.js';
import { createWorkerShutdownCoordinator, memoizeBullWorkerClose } from './worker-shutdown.js';
import { createWorkerHeartbeat } from './worker-health.js';

type Closeable = { close(force?: boolean): Promise<unknown> };
type DatabaseOwner = { end(): Promise<unknown> };
type AdvisoryOwner = { release(): Promise<void> };
type Connection = { close?(): Promise<unknown>; quit?(): Promise<unknown> };
type Loop = { requestStop(): void; completed(): Promise<void> };
type WorkerEnv = ReturnType<typeof parseWorkerEnv>;
type Logger = ReturnType<typeof createLogger>;

export type WorkerRuntimeDeps = {
  env?: WorkerEnv;
  logger?: Logger;
  registerSignalHandlers?: boolean;
  markNotReady?: () => Promise<void> | void;
  requestHeartbeat?: () => Promise<void> | void;
  exit?: (code: 0 | 1) => void;
  hardTerminate?: (code: 1) => void;
  heartbeat?: { stopping(): Promise<void>; initialize(): Promise<void>; remove(): Promise<void>; progress?(active?: boolean): Promise<void> };
  createConnection?: (env: WorkerEnv) => Connection;
  createQueue?: (connection: Connection) => Closeable;
  createWorker?: (connection: Connection, concurrency: number) => Closeable;
  createWorkers?: (connection: Connection, concurrency: number) => { workers: Closeable[]; database: DatabaseOwner };
  startDispatcher?: (queue: Closeable) => { loop: Loop; database: DatabaseOwner } | (() => Promise<void>);
  startReconciliation?: () => { loop: Loop; databases: [DatabaseOwner, DatabaseOwner]; advisory?: AdvisoryOwner } | (() => Promise<void>);
};

const controlledLoop = (run: (signal: AbortSignal) => Promise<void>): Loop => {
  const controller = new AbortController();
  const active = run(controller.signal);
  return { requestStop: () => controller.abort(), completed: () => active };
};

export async function startWorkerRuntime(deps: WorkerRuntimeDeps = {}) {
  const env = deps.env ?? parseWorkerEnv(process.env);
  const logger = deps.logger ?? createLogger('worker', env.LOG_LEVEL);
  const heartbeat = deps.heartbeat ?? await createWorkerHeartbeat({});
  try {
  const databaseUrl = process.env.DATABASE_URL;
  const connection: Connection = (deps.createConnection ?? createRedisConnection)(env);
  const queue = (deps.createQueue ?? ((value: Connection) => createRecurrenceQueue(value as never)))(connection);
  const workerOwner = deps.createWorkers
    ? deps.createWorkers(connection, env.WORKER_CONCURRENCY)
    : deps.createWorker
      ? { workers: [deps.createWorker(connection, env.WORKER_CONCURRENCY)], database: { end: async () => undefined } }
      : (() => {
        if (!databaseUrl) throw new Error('DATABASE_URL is required');
        const { sql } = createDatabase(databaseUrl);
        return { workers: [new Worker(QUEUES.recurrenceWakeup, createRecurrenceWorker({ sql, progress: (active) => heartbeat.progress?.(active) }), { connection: connection as never, concurrency: env.WORKER_CONCURRENCY }), new Worker(QUEUES.notificationDueSoon, createNotificationDueSoonWorker({ sql, progress: (active) => heartbeat.progress?.(active) }), { connection: connection as never, concurrency: env.WORKER_CONCURRENCY })], database: sql };
      })();
  const dispatcherFactory = deps.startDispatcher ?? ((value: Closeable) => {
    if (!databaseUrl) throw new Error('DATABASE_URL is required');
    const { sql } = createDatabase(databaseUrl);
    const claimToken = randomUUID();
    const loop = controlledLoop(async (signal) => {
      while (!signal.aborted) {
        await heartbeat.progress?.(true);
        await dispatchOutboxBatch({ db: sql, queue: value as never, claimToken, claim: claimOutboxBatch, markDispatched: markOutboxDispatched, markRetry: markOutboxRetry }).catch((error: unknown) => logger.error({ err: sanitizeError(error), event: 'outbox.dispatch.failed' }, 'outbox dispatch failed'));
        await heartbeat.progress?.(false);
        await delay(1000, undefined, { signal }).catch(() => undefined);
      }
    });
    return { loop, database: sql };
  });
  const dispatcherResult = dispatcherFactory(queue);
  const dispatcherOwner = typeof dispatcherResult === 'function' ? { loop: (() => { let done: Promise<void> | undefined; const stop = () => done ??= dispatcherResult(); return { requestStop: () => void stop(), completed: stop }; })(), database: { end: async () => undefined } } : dispatcherResult;
  const reconciliationFactory = deps.startReconciliation ?? (() => {
    if (!databaseUrl) throw new Error('DATABASE_URL is required');
    const { sql } = createDatabase(databaseUrl);
    const { sql: claimSql } = createDatabase(databaseUrl);
    let stop: Promise<void> | undefined;
    const stopLoop = startReconciliationLoop({ sql, claimSql, intervalMs: env.RECURRENCE_RECONCILIATION_INTERVAL_MS, batchSize: env.RECURRENCE_RECONCILIATION_BATCH_SIZE, onError: (error) => logger.error({ err: sanitizeError(error), event: 'reconciliation.failed' }, 'recurrence reconciliation failed'), databaseUrl, progress: (active) => heartbeat.progress?.(active) });
    return { loop: { requestStop: () => { stop ??= stopLoop(); }, completed: () => stop ?? Promise.resolve() }, databases: [sql, claimSql] };
  });
  const reconciliationResult = reconciliationFactory();
  const reconciliationOwner = typeof reconciliationResult === 'function' ? { loop: (() => { let done: Promise<void> | undefined; const stop = () => done ??= reconciliationResult(); return { requestStop: () => void stop(), completed: stop }; })(), databases: [] as DatabaseOwner[] } : reconciliationResult;
  const closeWorkers = workerOwner.workers.map(memoizeBullWorkerClose);
  const loops = [dispatcherOwner.loop, reconciliationOwner.loop];
  const databases = [workerOwner.database, dispatcherOwner.database, ...reconciliationOwner.databases];
  const shutdown = createWorkerShutdownCoordinator({
    markNotReady: deps.markNotReady,
    requestHeartbeat: async () => { await heartbeat.stopping(); await deps.requestHeartbeat?.(); },
    requestLoopStops: () => { for (const loop of loops) loop.requestStop(); },
    waitForLoops: () => Promise.allSettled(loops.map((loop) => loop.completed())).then(() => undefined),
    closeWorkers: () => Promise.allSettled(closeWorkers.map((close) => close())).then((results) => { const failed = results.find((result) => result.status === 'rejected'); if (failed?.status === 'rejected') throw failed.reason; }),
    closeQueues: () => queue.close(false).then(() => undefined),
    releaseAdvisoryLocks: () => ('advisory' in reconciliationOwner ? reconciliationOwner.advisory?.release() : undefined) ?? reconciliationOwner.loop.completed(),
    closeDatabaseOwners: async () => { const results = await Promise.allSettled(databases.map((database) => database.end())); await heartbeat.remove(); const failed = results.find((result) => result.status === 'rejected'); if (failed?.status === 'rejected') throw failed.reason; },
    closeRedis: () => Promise.resolve(connection.quit?.() ?? connection.close?.()).then(() => undefined),
    exit: deps.exit ?? ((code) => { process.exitCode = code; }),
    hardTerminate: deps.hardTerminate,
    logger
  });
  const onSignal = () => void shutdown.stop();
  if (deps.registerSignalHandlers) {
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  }
  await heartbeat.initialize();
  logger.info({ concurrency: env.WORKER_CONCURRENCY, queue: QUEUES.recurrenceWakeup }, 'worker started');
  return { stop: shutdown.stop };
  } catch (error) {
    await heartbeat.remove();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await startWorkerRuntime({ registerSignalHandlers: true });
