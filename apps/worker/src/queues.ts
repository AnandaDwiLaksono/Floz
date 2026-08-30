import { createHash } from 'node:crypto';
import { Redis, type RedisOptions } from 'ioredis';
import { Queue } from 'bullmq';

export const QUEUES = { recurrenceWakeup: 'recurrence-wakeup' } as const;

export function buildWakeupJobId(input: { recurrenceRuleId: string; scheduledFor: string }): string {
  return `recurrence-${createHash('sha256').update(JSON.stringify([input.recurrenceRuleId, input.scheduledFor])).digest('hex')}`;
}

export function createRedisConnection(config: { REDIS_URL: string; REDIS_TLS: boolean }): Redis {
  const url = new URL(config.REDIS_URL);
  const options: RedisOptions = config.REDIS_TLS ? { tls: {} } : {};
  return new Redis(url.toString(), { ...options, maxRetriesPerRequest: null });
}

export function createRecurrenceQueue(connection: Redis): Queue {
  return new Queue(QUEUES.recurrenceWakeup, {
    connection,
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: true }
  });
}
