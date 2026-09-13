import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkReadiness } from '../src/readiness.js';

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
    await new Promise((resolve) => setImmediate(resolve));
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

  it('retains lock until cleanup settles after cleanup failure', async () => {
    const directory = await dir();
    const probe = { ...options(directory), postgresFactory: () => ({ unsafe: async () => 1, end: async () => { throw new Error('cleanup'); } }) };
    expect(await checkReadiness(probe)).toEqual({ healthy: true });
    expect(await checkReadiness(probe)).toEqual({ healthy: true });
  });
});
