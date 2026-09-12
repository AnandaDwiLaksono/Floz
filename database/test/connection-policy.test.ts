import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/index.js';
import { createRedisConnection } from '../../apps/worker/src/queues.js';
import { createPostgresTlsFixture, type TlsFixture } from './fixtures/tls-mock-server.js';

describe('Task 2 — Connection Policy & Verified TLS Normalization', () => {
  let tlsFixture: TlsFixture;

  beforeAll(async () => {
    tlsFixture = await createPostgresTlsFixture();
  });

  afterAll(async () => {
    if (tlsFixture) {
      await tlsFixture.close();
    }
  });

  describe('createDatabase PostgreSQL Policy', () => {
    it('creates database client with max 1 pool size by default', () => {
      const { db, sql } = createDatabase('postgres://postgres:postgres@localhost:5432/floz');
      expect(db).toBeDefined();
      expect(sql).toBeDefined();
      const options = (sql as unknown as { options: { max: number; connect_timeout: number } }).options;
      expect(options.max).toBe(1);
      expect(options.connect_timeout).toBe(5);
      void sql.end();
    });

    it('allows only the API owner to use max 2 in production', () => {
      const { sql } = createDatabase('postgres://user:pass@db.floz.neon.tech/floz', { owner: 'api', max: 2, nodeEnv: 'production' });
      expect((sql as unknown as { options: { max: number } }).options.max).toBe(2);
      void sql.end();
      expect(() => createDatabase('postgres://user:pass@db.floz.neon.tech/floz', { owner: 'api', max: 3, nodeEnv: 'production' })).toThrow();
      expect(() => createDatabase('postgres://user:pass@db.floz.neon.tech/floz', { max: 2, nodeEnv: 'production' })).toThrow();
    });

    it('rejects rejectUnauthorized: false in production', () => {
      expect(() =>
        createDatabase('postgres://user:pass@db.floz.neon.tech/floz', {
          nodeEnv: 'production',
          ssl: { rejectUnauthorized: false }
        })
      ).toThrow('rejectUnauthorized: false is prohibited in production');
    });

    it('applies verified TLS configuration for remote production database', () => {
      const { sql } = createDatabase('postgres://user:pass@db.floz.neon.tech/floz', { nodeEnv: 'production' });
      const options = (sql as unknown as { options: { ssl: unknown } }).options;
      expect(options.ssl).toEqual({ rejectUnauthorized: true });
      void sql.end();
    });

    it('rejects insecure remote production database configuration', () => {
      expect(() => createDatabase('postgres://user:pass@db.floz.neon.tech/floz?sslmode=disable', { nodeEnv: 'production' })).toThrow();
    });

    it('positive control: connects successfully when certificate is signed by trusted CA and hostname matches', async () => {
      const { sql } = createDatabase(`postgres://user:pass@127.0.0.1:${tlsFixture.port}/floz`, {
        nodeEnv: 'test',
        dbSsl: 'true',
        ssl: {
          ca: tlsFixture.ca1Cert,
          servername: 'db.floz.local',
          rejectUnauthorized: true
        }
      });

      const result = await sql`SELECT 1`;
      expect(result).toBeDefined();
      await sql.end();
    });

    it('CA-negative: fails when reachable TLS endpoint certificate is not signed by trusted CA', async () => {
      const { sql } = createDatabase(`postgres://user:pass@127.0.0.1:${tlsFixture.port}/floz`, {
        nodeEnv: 'test',
        dbSsl: 'true',
        ssl: {
          ca: tlsFixture.ca2Cert,
          servername: 'db.floz.local',
          rejectUnauthorized: true
        }
      });

      let error: { code?: string; message?: string } | undefined;
      try {
        await sql`SELECT 1`;
      } catch (e) {
        error = e as { code?: string; message?: string };
      }

      expect(error).toBeDefined();
      expect(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN']).toContain(error?.code);
      await sql.end();
    });

    it('hostname-negative: fails when reachable TLS endpoint hostname does not match certificate SAN', async () => {
      const { sql } = createDatabase(`postgres://user:pass@127.0.0.1:${tlsFixture.port}/floz`, {
        nodeEnv: 'test',
        dbSsl: 'true',
        ssl: {
          ca: tlsFixture.ca1Cert,
          servername: 'mismatched-host.floz.local',
          rejectUnauthorized: true
        }
      });

      let error: { code?: string; message?: string } | undefined;
      try {
        await sql`SELECT 1`;
      } catch (e) {
        error = e as { code?: string; message?: string };
      }

      expect(error).toBeDefined();
      expect(['ERR_TLS_CERT_ALTNAME_INVALID', 'HOSTNAME_MISMATCH']).toContain(error?.code);
      await sql.end();
    });
  });

  describe('createRedisConnection Policy', () => {
    it('configures Redis client with maxRetriesPerRequest null and TLS disabled on localhost', () => {
      const client = createRedisConnection({
        REDIS_URL: 'redis://localhost:6379',
        NODE_ENV: 'test'
      });
      expect(client.options.maxRetriesPerRequest).toBeNull();
      expect(client.options.tls).toBeUndefined();
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
