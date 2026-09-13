import { randomUUID } from 'node:crypto';
import { open, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';
import { Redis } from 'ioredis';
import { readLocalWorkerHealth, type HealthResult } from './worker-health.js';

export type ReadinessResult = { healthy: true } | { healthy: false; reason: string };
type Pg = { unsafe(query: string): Promise<unknown>; end(options?: { timeout?: number }): Promise<unknown> };
type RedisProbe = { ping(): Promise<unknown>; disconnect(reconnect?: boolean): void };
type Input = { directory?: string; databaseUrl?: string; redisUrl?: string; timeoutMs?: number; localHealth?: () => Promise<HealthResult>; postgresFactory?: () => Pg | Promise<Pg>; redisFactory?: () => RedisProbe | Promise<RedisProbe> };
const bounded = async <T>(task: Promise<T>, timeoutMs: number, reason: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([task, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(reason)), timeoutMs); })]); } finally { if (timer) clearTimeout(timer); }
};
const processAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const runtime = (directory?: string) => directory ?? process.env.FLOZ_WORKER_RUNTIME_DIR ?? '/run/floz-worker';

async function acquire(directory: string) {
  const path = join(directory, 'readiness.lock');
  const owner = { pid: process.pid, nonce: randomUUID() };
  try { const handle = await open(path, 'wx', 0o600); await handle.writeFile(JSON.stringify(owner)); await handle.close(); return async () => { await rm(path, { force: true }); }; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    try {
      const previous = JSON.parse(await readFile(path, 'utf8')) as { pid?: unknown };
      const current = JSON.parse(await readFile(join(directory, 'current.json'), 'utf8')) as { pid?: unknown };
      if (typeof previous.pid === 'number' && previous.pid === current.pid && !processAlive(previous.pid)) { await rm(path, { force: true }); return acquire(directory); }
    } catch { return undefined; }
    return undefined;
  }
}

export async function checkReadiness(input: Input = {}): Promise<ReadinessResult> {
  const directory = runtime(input.directory);
  const local = input.localHealth ?? (() => readLocalWorkerHealth({ directory, isProcessAlive: processAlive }));
  if (!(await local()).healthy) return { healthy: false, reason: 'local' };
  const release = await acquire(directory);
  if (!release) return { healthy: false, reason: 'overlap' };
  const timeoutMs = Math.min(input.timeoutMs ?? 2000, 2000);
  let pg: Pg | undefined;
  let redis: RedisProbe | undefined;
  try {
    const databaseUrl = input.databaseUrl ?? process.env.DATABASE_URL;
    const redisUrl = input.redisUrl ?? process.env.REDIS_URL;
    if (!databaseUrl || !redisUrl) return { healthy: false, reason: 'configuration' };
    pg = await (input.postgresFactory?.() ?? postgres(databaseUrl, { max: 1, connect_timeout: 2, idle_timeout: 1, connection: { statement_timeout: 2000 } }));
    redis = await (input.redisFactory?.() ?? new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2000, commandTimeout: 2000, retryStrategy: () => null }));
    await bounded(Promise.all([pg.unsafe('SELECT 1'), redis.ping()]), timeoutMs, 'dependency-timeout');
    if (!(await local()).healthy) return { healthy: false, reason: 'local' };
    return { healthy: true };
  } catch (error) { return { healthy: false, reason: error instanceof Error && error.message === 'dependency-timeout' ? 'timeout' : 'dependency' }; }
  finally {
    redis?.disconnect(false);
    if (pg) await bounded(pg.end({ timeout: 1 }), 500, 'cleanup-timeout').catch(() => undefined);
    await release().catch(() => undefined);
  }
}

if (process.argv[1]?.endsWith('readiness.js')) {
  const result = await checkReadiness();
  if (!result.healthy) process.exitCode = 1;
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
