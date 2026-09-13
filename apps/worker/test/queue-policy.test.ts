import { describe, expect, it } from 'vitest';
import { createDependencyTransitionReporter, createRecurrenceQueue, createRedisConnection, getReconnectDelay, getQueuePolicy } from '../src/queues.js';

describe('worker queue policy', () => {
  it('bounds recurrence retries and retention', () => {
    expect(getQueuePolicy()).toEqual({
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
      removeOnFail: { count: 100, age: 604800 }
    });
  });

  it('caps reconnect delay including jitter at five seconds', () => {
    for (let attempt = 0; attempt < 20; attempt++) expect(getReconnectDelay(attempt, () => 1)).toBeLessThanOrEqual(5000);
  });

  it('reports only sanitized dependency state transitions', () => {
    const events: object[] = [];
    const report = createDependencyTransitionReporter((event) => events.push(event));
    report('reconnecting');
    report('error');
    report('reconnecting');
    report('ready');
    report('error');
    report('reconnecting');
    expect(events).toEqual([
      { dependency: 'redis', status: 'reconnecting' },
      { dependency: 'redis', status: 'ready' },
      { dependency: 'redis', status: 'reconnecting' }
    ]);
  });

  it('keeps verified TLS and unlimited runtime Redis request retries', () => {
    const client = createRedisConnection({ REDIS_URL: 'rediss://redis.example.test:6380', NODE_ENV: 'production' });
    expect(client.options.maxRetriesPerRequest).toBeNull();
    expect(client.options.tls).toEqual({});
    void client.disconnect();
  });

  it('applies policy to actual recurrence job lifecycle options', () => {
    const queue = createRecurrenceQueue({} as never);
    expect(queue.opts.defaultJobOptions).toEqual({
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
      removeOnFail: { count: 100, age: 604800 }
    });
    void queue.close();
  });
});
