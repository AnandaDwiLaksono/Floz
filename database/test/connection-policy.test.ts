import { describe, expect, it } from 'vitest';
import { createDatabase } from '../src/index.js';
import { createRedisConnection } from '../../apps/worker/src/queues.js';

describe('Task 2 — Connection Policy & Verified TLS Normalization', () => {
  describe('createDatabase PostgreSQL Policy', () => {
    it('creates database client with max 1 pool size by default', () => {
      const { db, sql } = createDatabase('postgres://postgres:postgres@localhost:5432/floz');
      expect(db).toBeDefined();
      expect(sql).toBeDefined();
      // Inspect options on postgres.js client
      const options = (sql as unknown as { options: { max: number; connect_timeout: number } }).options;
      expect(options.max).toBe(1);
      expect(options.connect_timeout).toBe(5);
      void sql.end();
    });

    it('rejects cap overrides exceeding approved budget in production', () => {
      expect(() => createDatabase('postgres://user:pass@db.floz.neon.tech/floz', { max: 10, nodeEnv: 'production' })).toThrow();
    });

    it('applies verified TLS configuration for remote production database', () => {
      const { sql } = createDatabase('postgres://user:pass@db.floz.neon.tech/floz', { nodeEnv: 'production' });
      const options = (sql as unknown as { options: { ssl: unknown } }).options;
      expect(options.ssl).toBe('require');
      void sql.end();
    });

    it('rejects insecure remote production database configuration', () => {
      expect(() => createDatabase('postgres://user:pass@db.floz.neon.tech/floz?sslmode=disable', { nodeEnv: 'production' })).toThrow();
    });
  });

  describe('createRedisConnection Policy', () => {
    it('configures Redis client with maxRetriesPerRequest null and retryStrategy cap', () => {
      const client = createRedisConnection({
        REDIS_URL: 'redis://localhost:6379',
        NODE_ENV: 'test'
      });
      expect(client.options.maxRetriesPerRequest).toBeNull();
      expect(client.options.connectTimeout).toBe(10000);
      expect(typeof client.options.retryStrategy).toBe('function');
      const delay = (client.options.retryStrategy as (times: number) => number)(10);
      expect(delay).toBeLessThanOrEqual(5000);
      client.disconnect();
    });

    it('rejects unencrypted remote production Redis', () => {
      expect(() => createRedisConnection({
        REDIS_URL: 'redis://default:pass@redis.floz.upstash.io:6379',
        NODE_ENV: 'production'
      })).toThrow();
    });

    it('accepts rediss:// remote production Redis with TLS enabled', () => {
      const client = createRedisConnection({
        REDIS_URL: 'rediss://default:pass@redis.floz.upstash.io:6379',
        NODE_ENV: 'production'
      });
      expect(client.options.tls).toBeDefined();
      client.disconnect();
    });
  });
});
