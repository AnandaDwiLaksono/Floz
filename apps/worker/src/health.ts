import { readLocalWorkerHealth } from './worker-health.js';

const isProcessAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
export async function runHealthCli() {
  const result = await readLocalWorkerHealth({ isProcessAlive });
  if (!result.healthy) process.exitCode = 1;
  return result;
}

if (process.argv[1]?.endsWith('health.js')) await runHealthCli();
