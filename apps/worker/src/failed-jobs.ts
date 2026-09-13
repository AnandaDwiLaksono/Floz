import { pathToFileURL } from 'node:url';
import { Queue } from 'bullmq';
import { parseWorkerEnv } from '@floz/config';
import { createRedisConnection, QUEUES } from './queues.js';

type FailedJob = { id?: string; name?: string; timestamp?: number; processedOn?: number; finishedOn?: number };
type FailedQueue = { getFailed(start: number, end: number): Promise<FailedJob[]>; close?(): Promise<unknown> };
type DiagnosticDeps = { timeoutMs?: number; write?: (value: string) => void; createConnection?: () => { disconnect?: () => void; quit?: () => Promise<unknown> }; createQueues?: (connection: unknown) => FailedQueue[] };

const readWithTimeout = async <T>(task: Promise<T>, timeoutMs: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([task, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('Failed-job diagnostic timed out')), timeoutMs); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export async function failedJobDiagnosticRows(queues: FailedQueue[], limit = 100, timeoutMs = 5000) {
  const rows: FailedJob[] = [];
  for (const queue of queues) {
    if (rows.length >= limit) break;
    rows.push(...await readWithTimeout(queue.getFailed(0, limit - rows.length - 1), timeoutMs));
  }
  return rows.slice(0, limit).map((job) => ({
    jobId: typeof job.id === 'string' ? job.id : 'unknown',
    type: typeof job.name === 'string' ? job.name : 'unknown',
    status: 'failed' as const,
    code: 'WORKER_JOB_FAILED',
    timing: { timestamp: job.timestamp, processedOn: job.processedOn, finishedOn: job.finishedOn }
  }));
}

export async function runFailedJobsDiagnostic(deps: DiagnosticDeps = {}) {
  const env = parseWorkerEnv(process.env);
  const connection = deps.createConnection?.() ?? createRedisConnection(env);
  const queues = deps.createQueues?.(connection) ?? [
    new Queue(QUEUES.recurrenceWakeup, { connection: connection as never }),
    new Queue(QUEUES.notificationDueSoon, { connection: connection as never })
  ];
  const timeoutMs = deps.timeoutMs ?? 5000;
  try {
    const rows = await failedJobDiagnosticRows(queues, 100, timeoutMs);
    (deps.write ?? ((value) => process.stdout.write(value)))(`${JSON.stringify(rows)}\n`);
  } finally {
    await Promise.race([Promise.all(queues.map((queue) => queue.close?.())), new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
    if (connection.disconnect) connection.disconnect();
    else await Promise.race([connection.quit?.(), new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runFailedJobsDiagnostic();
