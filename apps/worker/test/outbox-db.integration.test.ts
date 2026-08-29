import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '@floz/database';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { claimOutboxBatch, markOutboxDispatched, markOutboxRetry } from '@floz/database';
import { dispatchOutboxBatch } from '../src/outbox-dispatcher.js';
import { buildWakeupJobId } from '../src/queues.js';

describe('real dispatcher integration', () => {
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  if (!databaseUrl || !redisUrl) throw new Error('DATABASE_URL and REDIS_URL are required');
  const queueName = `outbox-dispatch-${process.pid}`;
  const { sql } = createDatabase(databaseUrl);
  let queue: Queue;
  let redis: Redis;

  beforeAll(async () => {
    redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
    queue = new Queue(queueName, { connection: new Redis(redisUrl, { maxRetriesPerRequest: null }), defaultJobOptions: { removeOnComplete: false } });
    await queue.obliterate({ force: true });
  });

  afterAll(async () => {
    await queue?.close();
    await redis?.quit();
    await sql.end();
  });

  it('claims a real outbox row, enqueues one BullMQ job, marks dispatched, and redispatch stays harmless', async () => {
    const ruleId = randomUUID();
    const scheduledFor = '2026-08-30T12:00:00.000Z';
    const inserted = await sql<{ id: string }[]>`INSERT INTO outbox_events(workspace_id,aggregate_type,aggregate_id,event_type,payload,status,available_at) VALUES(NULL,'recurrence_rule',${ruleId},'RECURRENCE_WAKEUP',${JSON.stringify({ recurrence_rule_id: ruleId, scheduled_for: scheduledFor })}::jsonb,'PENDING',${scheduledFor}) RETURNING id`;
    const first = await dispatchOutboxBatch({ db: sql, queue, dispatcherId: 'dispatcher-a', now: new Date('2026-08-30T12:00:01.000Z'), claim: claimOutboxBatch, markDispatched: markOutboxDispatched, markRetry: markOutboxRetry });
    expect(first).toBe(1);
    const row = (await sql`SELECT status,claimed_by,claimed_until,dispatched_at FROM outbox_events WHERE id=${inserted[0].id}`)[0];
    expect(row.status).toBe('DISPATCHED');
    expect(row.claimed_by).toBeNull();
    expect(row.claimed_until).toBeNull();
    const jobId = buildWakeupJobId({ recurrenceRuleId: ruleId, scheduledFor });
    const job = await queue.getJob(jobId);
    expect(job?.id).toBe(jobId);
    expect(job?.data).toEqual({ recurrence_rule_id: ruleId, scheduled_for: scheduledFor });

    await sql`UPDATE outbox_events SET status='PENDING',dispatched_at=NULL,claimed_by=NULL,claimed_until=NULL WHERE id=${inserted[0].id}`;
    const second = await dispatchOutboxBatch({ db: sql, queue, dispatcherId: 'dispatcher-b', now: new Date('2026-08-30T12:00:02.000Z'), claim: claimOutboxBatch, markDispatched: markOutboxDispatched, markRetry: markOutboxRetry });
    expect(second).toBe(1);
    expect(await queue.getJob(jobId)).not.toBeNull();
    expect(await queue.getJobCounts('waiting')).toMatchObject({ waiting: 1 });
  });
});
