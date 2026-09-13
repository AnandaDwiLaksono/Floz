import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export type WorkerHealthState = { pid: number; instanceId: string; timestamp: number; initialized: boolean; stopping: boolean; progressAt: number; active?: boolean };
export type HealthResult = { healthy: true } | { healthy: false; reason: string };
const fileName = (directory: string) => join(directory, 'health.json');

async function writeState(directory: string, state: WorkerHealthState) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${fileName(directory)}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'w', 0o600);
  try { await handle.writeFile(JSON.stringify(state)); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, fileName(directory));
  await chmod(fileName(directory), 0o600);
}

export async function createWorkerHeartbeat(input: { directory?: string; instanceId?: string; pid?: number; now?: () => number; intervalMs?: number }) {
  const directory = input.directory ?? process.env.FLOZ_WORKER_RUNTIME_DIR ?? '/run/floz-worker';
  const instanceId = input.instanceId ?? process.env.FLOZ_WORKER_INSTANCE_ID ?? randomUUID();
  const pid = input.pid ?? process.pid;
  const now = input.now ?? Date.now;
  let state: WorkerHealthState = { pid, instanceId, timestamp: now(), initialized: false, stopping: false, progressAt: now() };
  await rm(fileName(directory), { force: true });
  await writeState(directory, state);
  let lastWrite = state.timestamp;
  const tick = async () => { if (now() - lastWrite >= (input.intervalMs ?? 15_000)) { state = { ...state, timestamp: now() }; lastWrite = state.timestamp; await writeState(directory, state); } };
  const timer = setInterval(() => { void tick(); }, input.intervalMs ?? 15_000);
  timer.unref();
  return {
    instanceId,
    tick,
    initialize: async () => { state = { ...state, timestamp: now(), initialized: true }; lastWrite = state.timestamp; await writeState(directory, state); },
    progress: async (active = true) => { state = { ...state, timestamp: now(), progressAt: now(), active }; lastWrite = state.timestamp; await writeState(directory, state); },
    stopping: async () => { clearInterval(timer); state = { ...state, timestamp: now(), stopping: true }; await writeState(directory, state); },
    remove: async () => { clearInterval(timer); await unlink(fileName(directory)).catch(() => undefined); }
  };
}

export async function readLocalWorkerHealth(input: { directory?: string; instanceId?: string; now?: () => number; isProcessAlive?: (pid: number) => boolean }): Promise<HealthResult> {
  const directory = input.directory ?? process.env.FLOZ_WORKER_RUNTIME_DIR ?? '/run/floz-worker';
  let state: WorkerHealthState;
  try { state = JSON.parse(await readFile(fileName(directory), 'utf8')) as WorkerHealthState; } catch { return { healthy: false, reason: 'malformed' }; }
  if (!state || typeof state !== 'object' || typeof state.instanceId !== 'string' || typeof state.pid !== 'number' || typeof state.timestamp !== 'number' || typeof state.progressAt !== 'number' || typeof state.initialized !== 'boolean' || typeof state.stopping !== 'boolean') return { healthy: false, reason: 'malformed' };
  const now = input.now?.() ?? Date.now();
  if (input.instanceId && state.instanceId !== input.instanceId) return { healthy: false, reason: 'wrong-instance' };
  if (state.timestamp > now) return { healthy: false, reason: 'future' };
  if (state.stopping) return { healthy: false, reason: 'stopping' };
  if (!state.initialized) return { healthy: false, reason: 'uninitialized' };
  if (now - state.timestamp > 45_000) return { healthy: false, reason: 'stale' };
  if (input.isProcessAlive && !input.isProcessAlive(state.pid)) return { healthy: false, reason: 'terminated' };
  if (state.active && now - state.progressAt > 45_000) return { healthy: false, reason: 'stuck-progress' };
  return { healthy: true };
}
