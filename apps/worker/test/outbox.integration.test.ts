import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { buildWakeupJobId } from '../src/queues.js';

describe('real BullMQ outbox compatibility', () => {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  let connection: Redis;
  let queue: Queue;

  beforeAll(async () => {
    connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    queue = new Queue(`outbox-test-${process.pid}`, { connection: new Redis(redisUrl, { maxRetriesPerRequest: null }), defaultJobOptions: { removeOnComplete: false } });
    await queue.obliterate({ force: true });
  });
  afterAll(async () => { await queue?.close(); await connection?.quit(); });

  it('rejects colon job IDs in BullMQ and uses safe deterministic encoding instead', async () => {
    const data = { recurrence_rule_id: 'rule-1', scheduled_for: '2026-08-30T12:00:00.000Z' };
    await expect(queue.add('wake', data, { jobId: 'recurrence:rule-1:2026-08-30T12:00:00.000Z' })).rejects.toThrow(/Custom Id cannot contain :/);
    const jobId = buildWakeupJobId({ recurrenceRuleId: data.recurrence_rule_id, scheduledFor: data.scheduled_for });
    await queue.add('wake', data, { jobId });
    await queue.add('wake', data, { jobId });
    const job = await queue.getJob(jobId);
    expect(job?.id).toBe(jobId);
    expect(job?.data).toEqual(data);
    expect(await queue.getJobCounts('waiting')).toMatchObject({ waiting: 1 });
  });
});
