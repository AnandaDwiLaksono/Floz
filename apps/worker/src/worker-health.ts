import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

export type WorkerIdentity = { pid: number; instanceId: string; startTime: number };
export type WorkerHealthState = WorkerIdentity & { timestamp: number; initialized: boolean; stopping: boolean; progressAt: number; active: boolean };
export type HealthResult = { healthy: true } | { healthy: false; reason: string };
const pathFor = (directory: string, name: string) => join(directory, name);
const validNumber = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const validIdentity = (value: unknown): value is WorkerIdentity => !!value && typeof value === 'object' && validNumber((value as WorkerIdentity).pid) && (value as WorkerIdentity).pid > 0 && typeof (value as WorkerIdentity).instanceId === 'string' && (value as WorkerIdentity).instanceId.length > 0 && validNumber((value as WorkerIdentity).startTime);

async function atomicWrite(directory: string, name: string, value: unknown) {
  const target = pathFor(directory, name);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
    await handle.close();
    await rename(temporary, target);
    await chmod(target, 0o600);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function createWorkerHeartbeat(input: { directory?: string; instanceId?: string; pid?: number; now?: () => number; intervalMs?: number }) {
  const directory = input.directory ?? process.env.FLOZ_WORKER_RUNTIME_DIR ?? '/run/floz-worker';
  const now = input.now ?? Date.now;
  const identity: WorkerIdentity = { pid: input.pid ?? process.pid, instanceId: input.instanceId ?? randomUUID(), startTime: now() };
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  for (const name of await readdir(directory)) if (name === 'health.json' || name === 'current.json' || /^(health|current)\.json\.\d+\.[0-9a-f-]+\.tmp$/i.test(name)) await rm(pathFor(directory, name), { force: true });
  await atomicWrite(directory, 'current.json', identity);
  let state: WorkerHealthState = { ...identity, timestamp: identity.startTime, initialized: false, stopping: false, progressAt: identity.startTime, active: false };
  let lastWrite = state.timestamp;
  let activeOperations = 0;
  let writes = Promise.resolve();
  let removed = false;
  const intervalMs = input.intervalMs ?? 15_000;
  const update = (change: () => void) => writes = writes.then(async () => { if (removed) return; change(); await atomicWrite(directory, 'health.json', state); });
  const tick = async () => { const time = now(); if (time - lastWrite >= intervalMs) await update(() => { state = { ...state, timestamp: time }; lastWrite = time; }); };
  const timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref();
  return {
    identity,
    tick,
    initialize: async () => { const time = now(); await update(() => { state = { ...state, timestamp: time, initialized: true }; lastWrite = time; }); },
    progress: async (active: boolean) => { const time = now(); await update(() => { const wasActive = activeOperations > 0; activeOperations = Math.max(0, activeOperations + (active ? 1 : -1)); state = { ...state, timestamp: time, progressAt: active ? (wasActive ? state.progressAt : time) : state.progressAt, active: activeOperations > 0 }; lastWrite = time; }); },
    stopping: async () => { clearInterval(timer); const time = now(); await update(() => { state = { ...state, timestamp: time, stopping: true }; }); },
     remove: async () => { clearInterval(timer); removed = true; await writes; await Promise.all(['health.json', 'current.json'].map((name) => rm(pathFor(directory, name), { force: true }))); }

  };
}

export async function readLocalWorkerHealth(input: { directory?: string; now?: () => number; isProcessAlive?: (pid: number) => boolean }): Promise<HealthResult> {
  const directory = input.directory ?? process.env.FLOZ_WORKER_RUNTIME_DIR ?? '/run/floz-worker';
  let identity: unknown;
  let state: unknown;
  try { identity = JSON.parse(await readFile(pathFor(directory, 'current.json'), 'utf8')); state = JSON.parse(await readFile(pathFor(directory, 'health.json'), 'utf8')); } catch (error) { return { healthy: false, reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'malformed' }; }
  if (!validIdentity(identity) || !validIdentity(state)) return { healthy: false, reason: 'malformed' };
  const health = state as Partial<WorkerHealthState>;
  if (![health.timestamp, health.progressAt].every(validNumber) || typeof health.initialized !== 'boolean' || typeof health.stopping !== 'boolean' || typeof health.active !== 'boolean') return { healthy: false, reason: 'malformed' };
  if (identity.pid !== health.pid || identity.instanceId !== health.instanceId || identity.startTime !== health.startTime) return { healthy: false, reason: 'wrong-instance' };
  const now = input.now?.() ?? Date.now();
  if (health.timestamp! > now || health.progressAt! > now || health.startTime > now) return { healthy: false, reason: 'future' };
  if (health.stopping) return { healthy: false, reason: 'stopping' };
  if (!health.initialized) return { healthy: false, reason: 'uninitialized' };
  if (health.active && now - health.progressAt! > 45_000) return { healthy: false, reason: 'stuck-progress' };
  if (now - health.timestamp! > 45_000) return { healthy: false, reason: 'stale' };
  if (input.isProcessAlive && !input.isProcessAlive(health.pid)) return { healthy: false, reason: 'terminated' };
  return { healthy: true };
}
