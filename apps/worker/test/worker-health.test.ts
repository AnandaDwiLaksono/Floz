import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runHealthCli } from '../src/health.js';
import { createWorkerHeartbeat, readLocalWorkerHealth } from '../src/worker-health.js';

const dirs: string[] = [];
const state = (overrides: Record<string, unknown> = {}) => JSON.stringify({ pid: process.pid, instanceId: 'instance-a', timestamp: 1_000, initialized: true, stopping: false, progressAt: 1_000, ...overrides });
const directory = async () => { const value = await mkdtemp(join(tmpdir(), 'floz-worker-')); dirs.push(value); return value; };
afterEach(async () => { await Promise.all(dirs.splice(0).map((value) => rm(value, { recursive: true, force: true }))); });

describe('worker local health', () => {
  it('writes restrictive initialized state every 15 seconds and removes stale state before startup', async () => {
    const dir = await directory();
    await writeFile(join(dir, 'health.json'), 'stale');
    let now = 1_000;
    const heartbeat = await createWorkerHeartbeat({ directory: dir, instanceId: 'instance-a', pid: process.pid, now: () => now, intervalMs: 15_000 });
    expect(JSON.parse(await readFile(join(dir, 'health.json'), 'utf8'))).toMatchObject({ pid: process.pid, instanceId: 'instance-a', initialized: false, stopping: false, progressAt: 1_000 });
    now = 15_999;
    await heartbeat.tick();
    expect(JSON.parse(await readFile(join(dir, 'health.json'), 'utf8')).timestamp).toBe(1_000);
    now = 16_000;
    await heartbeat.tick();
    expect(JSON.parse(await readFile(join(dir, 'health.json'), 'utf8')).timestamp).toBe(16_000);
    await heartbeat.initialize();
    expect(JSON.parse(await readFile(join(dir, 'health.json'), 'utf8')).initialized).toBe(true);
  });

  it('accepts initialized idle local state, rejects stale state only after 45 seconds', async () => {
    const dir = await directory();
    await writeFile(join(dir, 'health.json'), state());
    expect(await readLocalWorkerHealth({ directory: dir, instanceId: 'instance-a', now: () => 46_000, isProcessAlive: () => true })).toEqual({ healthy: true });
    expect(await readLocalWorkerHealth({ directory: dir, instanceId: 'instance-a', now: () => 46_001, isProcessAlive: () => true })).toMatchObject({ healthy: false, reason: 'stale' });
  });

  it('rejects malformed, wrong-instance, future, stopping, terminated, and stuck active progress state', async () => {
    const dir = await directory();
    const check = (body: string, reason: string, alive = true) => writeFile(join(dir, 'health.json'), body).then(() => expect(readLocalWorkerHealth({ directory: dir, instanceId: 'instance-a', now: () => 50_000, isProcessAlive: () => alive })).resolves.toMatchObject({ healthy: false, reason }));
    await check('{', 'malformed');
    await check(state({ instanceId: 'other' }), 'wrong-instance');
    await check(state({ timestamp: 50_001 }), 'future');
    await check(state({ stopping: true }), 'stopping');
    await check(state({ timestamp: 50_000 }), 'terminated', false);
    await check(state({ active: true, progressAt: 1_000, timestamp: 50_000 }), 'stuck-progress');
  });

  it('CLI reads local state without network dependencies', async () => {
    const dir = await directory();
    await writeFile(join(dir, 'health.json'), state({ instanceId: 'cli', timestamp: Date.now(), progressAt: Date.now() }));
    process.env.FLOZ_WORKER_RUNTIME_DIR = dir;
    process.env.FLOZ_WORKER_INSTANCE_ID = 'cli';
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
    expect(await runHealthCli()).toEqual({ healthy: true });
    expect(process.exitCode).not.toBe(1);
  });
});
