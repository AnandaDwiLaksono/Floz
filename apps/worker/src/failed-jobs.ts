import { pathToFileURL } from 'node:url';
import { Queue } from 'bullmq';
import { parseWorkerEnv } from '@floz/config';
import { createRedisConnection, QUEUES } from './queues.js';

type FailedJob = { id?: string; name?: string; timestamp?: number; processedOn?: number; finishedOn?: number };

export async function failedJobDiagnosticRows(queue: { getFailed(start: number, end: number): Promise<FailedJob[]> }) {
  const jobs = await queue.getFailed(0, 99);
  return jobs.slice(0, 100).map((job) => ({
    jobId: typeof job.id === 'string' ? job.id : 'unknown',
    type: typeof job.name === 'string' ? job.name : 'unknown',
    status: 'failed' as const,
    code: 'WORKER_JOB_FAILED',
    timing: { timestamp: job.timestamp, processedOn: job.processedOn, finishedOn: job.finishedOn }
  }));
}

export async function runFailedJobsDiagnostic() {
  const env = parseWorkerEnv(process.env);
  const connection = createRedisConnection(env);
  const queue = new Queue(QUEUES.recurrenceWakeup, { connection });
  try {
    process.stdout.write(`${JSON.stringify(await failedJobDiagnosticRows({ getFailed: (start, end) => queue.getFailed(start, end) }))}\n`);
  } finally {
    await queue.close();
    await connection.quit();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runFailedJobsDiagnostic();
