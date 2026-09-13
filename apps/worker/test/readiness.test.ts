import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkReadiness, runReadinessCli } from '../src/readiness.js';

const dirs: string[] = [];
const dir = async () => { const value = await mkdtemp(join(tmpdir(), 'floz-readiness-')); dirs.push(value); return value; };
afterEach(async () => { await Promise.all(dirs.splice(0).map((value) => rm(value, { recursive: true, force: true }))); });
const healthy = async () => ({ healthy: true as const });
const options = (directory: string, pg = async () => 1, ping = async () => 'PONG') => ({ directory, databaseUrl: 'postgres://unused', redisUrl: 'redis://unused', localHealth: healthy, postgresFactory: () => ({ unsafe: pg, end: async () => undefined }), redisFactory: () => ({ ping, disconnect: () => undefined }) });

describe('worker dependency readiness', () => {
  it('fails before dependencies when local worker health fails', async () => {
    let postgres = 0;
    const result = await checkReadiness({ directory: await dir(), postgresFactory: () => { postgres++; throw new Error('must not run'); } });
    expect(result).toMatchObject({ healthy: false, reason: 'local' });
    expect(postgres).toBe(0);
  });

  it('fails for PostgreSQL, Redis, and TLS probe errors', async () => {
    for (const probe of [options(await dir(), async () => { throw new Error('pg'); }), options(await dir(), async () => 1, async () => { throw new Error('redis'); }), { ...options(await dir()), postgresFactory: () => { throw new Error('TLS'); } }]) expect(await checkReadiness(probe)).toMatchObject({ healthy: false, reason: 'dependency' });
  });

  it('bounds both dependency timeouts and releases owners', async () => {
    for (const probe of [options(await dir(), () => new Promise<never>(() => undefined)), options(await dir(), async () => 1, () => new Promise<never>(() => undefined))]) expect(await checkReadiness({ ...probe, timeoutMs: 10 })).toMatchObject({ healthy: false, reason: 'timeout' });
  });

  it('rejects overlapping probes without creating another owner', async () => {
    const directory = await dir();
    let pgOwners = 0;
    const probe = { ...options(directory, () => new Promise<never>(() => undefined)), timeoutMs: 30, postgresFactory: () => { pgOwners++; return { unsafe: () => new Promise<never>(() => undefined), end: async () => undefined }; } };
    const first = checkReadiness(probe);
    for (;;) { try { await readFile(join(directory, 'readiness.lock')); break; } catch { await new Promise((resolve) => setImmediate(resolve)); } }
    await expect(checkReadiness(probe)).resolves.toMatchObject({ healthy: false, reason: 'overlap' });
    await first;
    expect(pgOwners).toBe(1);
  });

  it('allows concurrent successful probes in separate runtime directories', async () => {
    expect(await Promise.all([checkReadiness(options(await dir())), checkReadiness(options(await dir()))])).toEqual([{ healthy: true }, { healthy: true }]);
  });

  it('fails if current local instance begins stopping before success', async () => {
    let calls = 0;
    const result = await checkReadiness({ ...options(await dir()), localHealth: async () => ++calls === 1 ? { healthy: true } : { healthy: false, reason: 'stopping' } });
    expect(result).toMatchObject({ healthy: false, reason: 'local' });
  });

  it('returns cleanup failure and retains lock until cleanup settles', async () => {
    const directory = await dir();
    let finish!: () => void;
    const cleanup = new Promise<void>((resolve) => { finish = resolve; });
    const probe = { ...options(directory), postgresFactory: () => ({ unsafe: async () => 1, end: () => cleanup }) };
    const first = checkReadiness(probe);
    for (;;) { try { await readFile(join(directory, 'readiness.lock')); break; } catch { await new Promise((resolve) => setImmediate(resolve)); } }
    await expect(checkReadiness(probe)).resolves.toMatchObject({ healthy: false, reason: 'overlap' });
    finish();
    await expect(first).resolves.toEqual({ healthy: true });
    await expect(checkReadiness({ ...options(directory), postgresFactory: () => ({ unsafe: async () => 1, end: async () => { throw new Error('cleanup'); } }) })).resolves.toMatchObject({ healthy: false, reason: 'cleanup' });
  });

  it('applies the absolute deadline to local health and factories', async () => {
    const started = Date.now();
    await expect(checkReadiness({ ...options(await dir()), totalTimeoutMs: 30, localHealth: () => new Promise(() => undefined) })).resolves.toMatchObject({ healthy: false, reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(200);
    await expect(checkReadiness({ ...options(await dir()), totalTimeoutMs: 30, postgresFactory: () => new Promise(() => undefined) })).resolves.toMatchObject({ healthy: false, reason: 'timeout' });
  });

  it('cleans delayed factory owners before allowing a replacement', async () => {
    const directory = await dir();
    let resolve!: (value: { unsafe(query: string): Promise<number>; end(): Promise<void> }) => void;
    const delayed = new Promise<{ unsafe(query: string): Promise<number>; end(): Promise<void> }>((value) => { resolve = value; });
    const first = checkReadiness({ ...options(directory), totalTimeoutMs: 20, postgresFactory: () => delayed });
    await expect(first).resolves.toMatchObject({ healthy: false, reason: 'timeout' });
    await expect(checkReadiness(options(directory))).resolves.toMatchObject({ healthy: false, reason: 'overlap' });
    resolve({ unsafe: async () => 1, end: async () => undefined });
    for (;;) { try { await readFile(join(directory, 'readiness.lock')); } catch { break; } await new Promise((resolve) => setImmediate(resolve)); }
    await expect(checkReadiness(options(directory))).resolves.toEqual({ healthy: true });
  });

  it('bounds hung Redis cleanup without releasing the lock', async () => {
    const directory = await dir();
    const started = Date.now();
    const first = checkReadiness({ ...options(directory), totalTimeoutMs: 30, redisFactory: () => ({ ping: async () => 'PONG', disconnect: () => new Promise<void>(() => undefined) }) });
    await expect(first).resolves.toMatchObject({ healthy: false, reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(200);
    await expect(checkReadiness(options(directory))).resolves.toMatchObject({ healthy: false, reason: 'overlap' });
  });

  it('keeps the lock after PG settles until late Redis settles', async () => {
    const directory = await dir();
    let resolvePg!: (value: { unsafe(query: string): Promise<number>; end(): Promise<void> }) => void;
    let resolveRedis!: (value: { ping(): Promise<string>; disconnect(): void }) => void;
    const pg = new Promise<{ unsafe(query: string): Promise<number>; end(): Promise<void> }>((resolve) => { resolvePg = resolve; });
    const redis = new Promise<{ ping(): Promise<string>; disconnect(): void }>((resolve) => { resolveRedis = resolve; });
    const first = checkReadiness({ ...options(directory), totalTimeoutMs: 20, postgresFactory: () => pg, redisFactory: () => redis });
    await expect(first).resolves.toMatchObject({ healthy: false, reason: 'timeout' });
    resolvePg({ unsafe: async () => 1, end: async () => undefined });
    await new Promise((resolve) => setImmediate(resolve));
    await expect(checkReadiness(options(directory))).resolves.toMatchObject({ healthy: false, reason: 'overlap' });
    resolveRedis({ ping: async () => 'PONG', disconnect: () => undefined });
    for (;;) { try { await readFile(join(directory, 'readiness.lock')); } catch { break; } await new Promise((resolve) => setImmediate(resolve)); }
    await expect(checkReadiness(options(directory))).resolves.toEqual({ healthy: true });
  });

  it('releases only after late Redis settles after PG', async () => {
    const directory = await dir();
    let resolveRedis!: (value: { ping(): Promise<string>; disconnect(): void }) => void;
    const redis = new Promise<{ ping(): Promise<string>; disconnect(): void }>((resolve) => { resolveRedis = resolve; });
    const first = checkReadiness({ ...options(directory), totalTimeoutMs: 20, redisFactory: () => redis });
    await expect(first).resolves.toMatchObject({ healthy: false, reason: 'timeout' });
    await new Promise((resolve) => setImmediate(resolve));
    await expect(checkReadiness(options(directory))).resolves.toMatchObject({ healthy: false, reason: 'overlap' });
    resolveRedis({ ping: async () => 'PONG', disconnect: () => undefined });
    for (;;) { try { await readFile(join(directory, 'readiness.lock')); } catch { break; } await new Promise((resolve) => setImmediate(resolve)); }
    await expect(checkReadiness(options(directory))).resolves.toEqual({ healthy: true });
  });

  it('recovers only a stale lock bound to the current worker identity', async () => {
    const directory = await dir();
    const worker = { pid: process.pid, instanceId: 'worker-a', startTime: 1 };
    await writeFile(join(directory, 'current.json'), JSON.stringify(worker));
    await writeFile(join(directory, 'readiness.lock'), JSON.stringify({ pid: 999999, nonce: 'old', startedAt: 1, worker }));
    await expect(checkReadiness(options(directory))).resolves.toEqual({ healthy: true });
    await writeFile(join(directory, 'readiness.lock'), JSON.stringify({ pid: 999999, nonce: 'old', startedAt: 1, worker: { ...worker, instanceId: 'other' } }));
    await expect(checkReadiness(options(directory))).resolves.toMatchObject({ healthy: false, reason: 'overlap' });
  });

  it('writes lock identity and uses bounded Redis options with normalized TLS', async () => {
    const directory = await dir();
    await writeFile(join(directory, 'current.json'), JSON.stringify({ pid: process.pid, instanceId: 'worker-a', startTime: 1 }));
    let lock: unknown;
    const result = await checkReadiness({ ...options(directory), redisUrl: 'rediss://redis.example.test:6380', redisFactory: (url, redisOptions) => { lock = readFile(join(directory, 'readiness.lock'), 'utf8'); expect(url).toContain('rediss:'); expect(redisOptions).toMatchObject({ maxRetriesPerRequest: 1, connectTimeout: 2000, commandTimeout: 2000, tls: {} }); return { ping: async () => 'PONG', disconnect: () => undefined }; } });
    expect(result).toEqual({ healthy: true });
    expect(JSON.parse(await lock as string)).toMatchObject({ pid: process.pid, worker: { instanceId: 'worker-a', startTime: 1 } });
  });

  it('sets CLI exit code for dependency and cleanup failures', async () => {
    process.exitCode = undefined;
    await runReadinessCli({ ...options(await dir()), postgresFactory: () => { throw new Error('pg'); } });
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});
