import { randomUUID } from 'node:crypto';
import { open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';
import { Redis, type RedisOptions } from 'ioredis';
import { normalizeRedisTls } from '@floz/config';
import { readLocalWorkerHealth, type HealthResult, type WorkerIdentity } from './worker-health.js';

export type ReadinessResult = { healthy: true } | { healthy: false; reason: string };
type Pg = { unsafe(query: string): Promise<unknown>; end(options?: { timeout?: number }): Promise<unknown> };
type RedisProbe = { ping(): Promise<unknown>; disconnect(reconnect?: boolean): void | Promise<unknown> };
type PgOptions = { max: 1; connect_timeout: number; idle_timeout: number; connection: { statement_timeout: number } };
export type ReadinessInput = { directory?: string; databaseUrl?: string; redisUrl?: string; redisTls?: string; nodeEnv?: string; timeoutMs?: number; totalTimeoutMs?: number; localHealth?: () => Promise<HealthResult>; postgresFactory?: (url: string, options: PgOptions) => Pg | Promise<Pg>; redisFactory?: (url: string, options: RedisOptions) => RedisProbe | Promise<RedisProbe> };
type LockOwner = { pid: number; nonce: string; startedAt: number; worker: WorkerIdentity };
const processAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const runtime = (directory?: string) => directory ?? process.env.FLOZ_WORKER_RUNTIME_DIR ?? '/run/floz-worker';
const validWorker = (value: unknown): value is WorkerIdentity => !!value && typeof value === 'object' && Number.isSafeInteger((value as WorkerIdentity).pid) && (value as WorkerIdentity).pid > 0 && typeof (value as WorkerIdentity).instanceId === 'string' && Number.isSafeInteger((value as WorkerIdentity).startTime);
const sameWorker = (a: WorkerIdentity, b: WorkerIdentity) => a.pid === b.pid && a.instanceId === b.instanceId && a.startTime === b.startTime;
const validOwner = (value: unknown): value is LockOwner => !!value && typeof value === 'object' && Number.isSafeInteger((value as LockOwner).pid) && (value as LockOwner).pid > 0 && typeof (value as LockOwner).nonce === 'string' && (value as LockOwner).nonce.length > 0 && Number.isSafeInteger((value as LockOwner).startedAt) && validWorker((value as LockOwner).worker);
const bounded = async <T>(task: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([task, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('readiness-timeout')), Math.max(0, ms)); })]); } finally { if (timer) clearTimeout(timer); }
};

async function readWorker(directory: string) {
  const value: unknown = JSON.parse(await readFile(join(directory, 'current.json'), 'utf8'));
  return validWorker(value) ? value : undefined;
}

async function acquire(directory: string, worker: WorkerIdentity) {
  const path = join(directory, 'readiness.lock');
  const owner: LockOwner = { pid: process.pid, nonce: randomUUID(), startedAt: Date.now(), worker };
  try {
    const handle = await open(path, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(owner)); await handle.sync(); } finally { await handle.close(); }
    return async () => {
      const current: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (validOwner(current) && current.pid === owner.pid && current.nonce === owner.nonce && current.startedAt === owner.startedAt && sameWorker(current.worker, owner.worker)) await rm(path);
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    let previous: unknown;
    try { previous = JSON.parse(await readFile(path, 'utf8')); } catch { return undefined; }
    if (!validOwner(previous) || processAlive(previous.pid) || !sameWorker(previous.worker, worker)) return undefined;
    const stale = `${path}.${process.pid}.${randomUUID()}.stale`;
    try { await rename(path, stale); } catch { return undefined; }
    try {
      const moved: unknown = JSON.parse(await readFile(stale, 'utf8'));
      if (!validOwner(moved) || moved.pid !== previous.pid || moved.nonce !== previous.nonce || moved.startedAt !== previous.startedAt || !sameWorker(moved.worker, previous.worker)) return undefined;
      return await acquire(directory, worker);
    } finally { await rm(stale, { force: true }); }
  }
}

export async function checkReadiness(input: ReadinessInput = {}): Promise<ReadinessResult> {
  const directory = runtime(input.directory);
  const deadline = Date.now() + Math.min(input.totalTimeoutMs ?? 3000, 3000);
  const remaining = () => deadline - Date.now();
  const local = input.localHealth ?? (() => readLocalWorkerHealth({ directory, isProcessAlive: processAlive }));
  let release: (() => Promise<void>) | undefined;
  let released = false;
  const releaseOnce = async () => { if (!released) { released = true; await release?.(); } };
  let pg: Pg | undefined;
  let redis: RedisProbe | undefined;
  let result: ReadinessResult = { healthy: false, reason: 'dependency' };
  let settled = true;
  let abandoned = false;
  try {
    if (!(await bounded(local(), remaining())).healthy) return { healthy: false, reason: 'local' };
    const worker = await bounded(readWorker(directory), remaining()).catch(() => undefined);
    if (!worker && !input.localHealth) return { healthy: false, reason: 'local' };
    release = await bounded(acquire(directory, worker ?? { pid: process.pid, instanceId: 'injected', startTime: 0 }), remaining());
    if (!release) return { healthy: false, reason: 'overlap' };
    const databaseUrl = input.databaseUrl ?? process.env.DATABASE_URL;
    const redisUrl = input.redisUrl ?? process.env.REDIS_URL;
    if (!databaseUrl || !redisUrl) return { healthy: false, reason: 'configuration' };
    const dependencyMs = Math.min(input.timeoutMs ?? 2000, 2000, remaining());
    const pgOptions: PgOptions = { max: 1, connect_timeout: 2, idle_timeout: 1, connection: { statement_timeout: 2000 } };
    const { tls } = normalizeRedisTls(redisUrl, input.redisTls ?? process.env.REDIS_TLS, (input.nodeEnv ?? process.env.NODE_ENV ?? 'development') as 'development' | 'test' | 'production');
    const redisOptions: RedisOptions = { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2000, commandTimeout: 2000, retryStrategy: () => null, tls: tls ? {} : undefined };
    const pgFactory = Promise.resolve(input.postgresFactory?.(databaseUrl, pgOptions) ?? postgres(databaseUrl, pgOptions));
    const redisFactory = Promise.resolve(input.redisFactory?.(redisUrl, redisOptions) ?? new Redis(redisUrl, redisOptions));
    pgFactory.then((owner) => { pg = owner; }, () => undefined);
    redisFactory.then((owner) => { redis = owner; }, () => undefined);
    void Promise.allSettled([pgFactory, redisFactory]).then(async ([pgResult, redisResult]) => {
      if (!abandoned) return;
      if (redisResult.status === 'fulfilled') try { await bounded(Promise.resolve(redisResult.value.disconnect(false)), 0); } catch {}
      if (pgResult.status === 'fulfilled') try { await pgResult.value.end({ timeout: 1 }); } catch {}
      await releaseOnce().catch(() => undefined);
    });
    [pg, redis] = await bounded(Promise.all([pgFactory, redisFactory]), remaining());
    await bounded(Promise.all([pg.unsafe('SELECT 1'), redis.ping()]), Math.min(dependencyMs, remaining()));
    if (!(await bounded(local(), remaining())).healthy) return { healthy: false, reason: 'local' };
    result = { healthy: true };
  } catch (error) { result = { healthy: false, reason: error instanceof Error && error.message === 'readiness-timeout' ? 'timeout' : 'dependency' }; settled = false; abandoned = true; }
  finally {
    if (redis) try { await bounded(Promise.resolve(redis.disconnect(false)), remaining()); } catch { result = { healthy: false, reason: 'timeout' }; settled = false; }
    if (pg) {
      try { await bounded(pg.end({ timeout: 1 }), remaining()); } catch { result = { healthy: false, reason: remaining() <= 0 ? 'timeout' : 'cleanup' }; settled = false; }
    }
    if (release && settled) try { await bounded(releaseOnce(), remaining()); } catch { result = { healthy: false, reason: 'cleanup' }; }
  }
  return result;
}

export async function runReadinessCli(input: ReadinessInput = {}) {
  const result = await checkReadiness(input);
  if (!result.healthy) process.exitCode = 1;
  return result;
}

if (process.argv[1]?.endsWith('readiness.js')) process.stdout.write(`${JSON.stringify(await runReadinessCli())}\n`);
