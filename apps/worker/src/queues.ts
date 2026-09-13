import { createHash } from 'node:crypto';
import { Redis, type RedisOptions } from 'ioredis';
import { Queue } from 'bullmq';

import { normalizeRedisTls } from '@floz/config';

export const QUEUES = { recurrenceWakeup: 'recurrence-wakeup', notificationDueSoon: 'notification-due-soon' } as const;

export const getQueuePolicy = () => ({
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: true,
  removeOnFail: { count: 100, age: 604800 }
});

export const getReconnectDelay = (attempt: number, random = Math.random) =>
  Math.min(5000, Math.min(4000, 100 * 2 ** Math.min(attempt, 6)) + Math.floor(random() * 1001));

export const createDependencyTransitionReporter = (report: (event: { dependency: 'redis'; status: 'reconnecting' | 'ready' | 'error' }) => void) => {
  let status: 'reconnecting' | 'ready' | 'error' | undefined;
  return (next: 'reconnecting' | 'ready' | 'error') => {
    if (next !== status) report({ dependency: 'redis', status: next });
    status = next;
  };
};

export function buildWakeupJobId(input: { recurrenceRuleId: string; scheduledFor: string }): string {
  return `recurrence-${createHash('sha256').update(JSON.stringify([input.recurrenceRuleId, input.scheduledFor])).digest('hex')}`;
}

export function buildDueSoonWakeupJobId(taskId: string, dueVersion: number): string {
  return `due_soon-${createHash('sha256').update(`due_soon:${taskId}:${dueVersion}`).digest('hex')}`;
}

export function createRedisConnection(config: {
  REDIS_URL: string;
  REDIS_TLS?: boolean | string;
  NODE_ENV?: string;
}): Redis {
  const nodeEnv = (config.NODE_ENV ?? process.env.NODE_ENV ?? 'development') as 'development' | 'test' | 'production';
  const redisTlsStr = typeof config.REDIS_TLS === 'string'
    ? config.REDIS_TLS
    : config.REDIS_TLS !== undefined
      ? String(config.REDIS_TLS)
      : undefined;

  const { tls } = normalizeRedisTls(config.REDIS_URL, redisTlsStr, nodeEnv);
  const url = new URL(config.REDIS_URL);
  const options: RedisOptions = {
    tls: tls ? {} : undefined,
    maxRetriesPerRequest: null,
    retryStrategy: getReconnectDelay
  };
  const client = new Redis(url.toString(), options);
  const report = createDependencyTransitionReporter((event) => {
    process.stderr.write(`${JSON.stringify(event)}\n`);
  });
  client.on('reconnecting', () => report('reconnecting'));
  client.on('ready', () => report('ready'));
  client.on('error', () => report('error'));
  return client;
}

export function createRecurrenceQueue(connection: Redis): Queue {
  return new Queue(QUEUES.recurrenceWakeup, {
    connection,
    defaultJobOptions: getQueuePolicy()
  });
}
