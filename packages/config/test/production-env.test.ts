import { describe, expect, it } from 'vitest';
import {
  parseApiEnv,
  parseDatabaseEnv,
  parseMigrationEnv,
  parseWebEnv,
  parseWorkerEnv,
  normalizeOrigins,
  normalizePostgresTls,
  normalizeRedisTls
} from '../src/index.js';

describe('Task 1 — Configuration Contract and Origin Normalization', () => {
  const validSecret = 'a-very-long-production-secret-with-at-least-32-chars-random';

  describe('Origin Normalization', () => {
    it('parses comma-separated ALLOWED_ORIGINS and trims whitespace', () => {
      const origins = normalizeOrigins({
        ALLOWED_ORIGINS: 'https://app.floz.local, https://admin.floz.local '
      }, 'production');
      expect(origins).toEqual(['https://app.floz.local', 'https://admin.floz.local']);
    });

    it('accepts agreeing legacy ALLOWED_ORIGIN alias', () => {
      const origins = normalizeOrigins({
        ALLOWED_ORIGIN: 'https://app.floz.local',
        ALLOWED_ORIGINS: 'https://app.floz.local, https://admin.floz.local'
      }, 'production');
      expect(origins).toEqual(['https://app.floz.local', 'https://admin.floz.local']);
    });

    it('rejects conflicting ALLOWED_ORIGIN and ALLOWED_ORIGINS without leaking values', () => {
      expect(() => normalizeOrigins({
        ALLOWED_ORIGIN: 'https://other.floz.local',
        ALLOWED_ORIGINS: 'https://app.floz.local'
      }, 'production')).toThrowError(/ALLOWED_ORIGIN/);
    });

    it('rejects invalid production origins (http, paths, wildcards, credentials, null)', () => {
      expect(() => normalizeOrigins({ ALLOWED_ORIGINS: 'http://app.floz.local' }, 'production')).toThrow();
      expect(() => normalizeOrigins({ ALLOWED_ORIGINS: 'https://app.floz.local/path' }, 'production')).toThrow();
      expect(() => normalizeOrigins({ ALLOWED_ORIGINS: '*' }, 'production')).toThrow();
      expect(() => normalizeOrigins({ ALLOWED_ORIGINS: 'https://user:pass@app.floz.local' }, 'production')).toThrow();
      expect(() => normalizeOrigins({ ALLOWED_ORIGINS: 'null' }, 'production')).toThrow();
    });

    it('defaults to localhost origins in development and test', () => {
      expect(normalizeOrigins({}, 'development')).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
      expect(normalizeOrigins({}, 'test')).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
    });

    it('rejects missing origins in production', () => {
      expect(() => normalizeOrigins({}, 'production')).toThrow();
    });
  });

  describe('PostgreSQL TLS Normalization', () => {
    it('allows localhost plaintext in development and test', () => {
      const dev = normalizePostgresTls('postgres://postgres:postgres@localhost:5432/floz', undefined, 'development');
      expect(dev.ssl).toBe(false);
      const test = normalizePostgresTls('postgres://postgres:postgres@127.0.0.1:5432/floz', 'false', 'test');
      expect(test.ssl).toBe(false);
    });

    it('enforces verified TLS on remote production database', () => {
      const prod = normalizePostgresTls('postgres://user:pass@db.floz.neon.tech/floz', undefined, 'production');
      expect(prod.ssl).toBe('require');
    });

    it('rejects DB_SSL=false on remote production database', () => {
      expect(() => normalizePostgresTls('postgres://user:pass@db.floz.neon.tech/floz', 'false', 'production')).toThrow();
    });

    it('rejects insecure sslmode (disable, allow, prefer) in production', () => {
      expect(() => normalizePostgresTls('postgres://user:pass@db.floz.neon.tech/floz?sslmode=disable', undefined, 'production')).toThrow();
      expect(() => normalizePostgresTls('postgres://user:pass@db.floz.neon.tech/floz?sslmode=prefer', undefined, 'production')).toThrow();
    });

    it('rejects production localhost database', () => {
      expect(() => normalizePostgresTls('postgres://postgres:postgres@localhost:5432/floz', undefined, 'production')).toThrow();
      expect(() => normalizePostgresTls('postgres://postgres:postgres@127.0.0.1:5432/floz', undefined, 'production')).toThrow();
    });
  });

  describe('Redis TLS Normalization', () => {
    it('allows localhost plaintext in development and test', () => {
      const dev = normalizeRedisTls('redis://localhost:6379', undefined, 'development');
      expect(dev.tls).toBe(false);
      const test = normalizeRedisTls('redis://127.0.0.1:6379', 'false', 'test');
      expect(test.tls).toBe(false);
    });

    it('accepts rediss:// remote URL in production', () => {
      const prod = normalizeRedisTls('rediss://default:pass@redis.floz.upstash.io:6379', undefined, 'production');
      expect(prod.tls).toBe(true);
    });

    it('accepts redis:// with REDIS_TLS=true in production', () => {
      const prod = normalizeRedisTls('redis://default:pass@redis.floz.upstash.io:6379', 'true', 'production');
      expect(prod.tls).toBe(true);
    });

    it('rejects rediss:// with REDIS_TLS=false in production', () => {
      expect(() => normalizeRedisTls('rediss://default:pass@redis.floz.upstash.io:6379', 'false', 'production')).toThrow();
    });

    it('rejects plaintext remote redis:// in production when REDIS_TLS is unset or false', () => {
      expect(() => normalizeRedisTls('redis://default:pass@redis.floz.upstash.io:6379', undefined, 'production')).toThrow();
      expect(() => normalizeRedisTls('redis://default:pass@redis.floz.upstash.io:6379', 'false', 'production')).toThrow();
    });
  });

  describe('Service Environment Parsers', () => {
    describe('parseApiEnv', () => {
      it('parses valid production environment', () => {
        const env = parseApiEnv({
          NODE_ENV: 'production',
          API_PORT: '3001',
          DATABASE_URL: 'postgres://user:pass@db.floz.neon.tech/floz',
          BETTER_AUTH_SECRET: validSecret,
          BETTER_AUTH_URL: 'https://api.floz.local',
          ALLOWED_ORIGINS: 'https://app.floz.local'
        });
        expect(env.NODE_ENV).toBe('production');
        expect(env.API_PORT).toBe(3001);
        expect(env.ALLOWED_ORIGINS).toEqual(['https://app.floz.local']);
        expect(env.DB_POOL_MAX).toBe(1);
      });

      it('rejects NODE_TLS_REJECT_UNAUTHORIZED=0 in production', () => {
        expect(() => parseApiEnv({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgres://user:pass@db.floz.neon.tech/floz',
          BETTER_AUTH_SECRET: validSecret,
          BETTER_AUTH_URL: 'https://api.floz.local',
          ALLOWED_ORIGINS: 'https://app.floz.local',
          NODE_TLS_REJECT_UNAUTHORIZED: '0'
        })).toThrow();
      });

      it('rejects weak BETTER_AUTH_SECRET in production', () => {
        expect(() => parseApiEnv({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgres://user:pass@db.floz.neon.tech/floz',
          BETTER_AUTH_SECRET: 'short-secret',
          BETTER_AUTH_URL: 'https://api.floz.local',
          ALLOWED_ORIGINS: 'https://app.floz.local'
        })).toThrow();

        expect(() => parseApiEnv({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgres://user:pass@db.floz.neon.tech/floz',
          BETTER_AUTH_SECRET: '1111111111111111111111111111111111111111',
          BETTER_AUTH_URL: 'https://api.floz.local',
          ALLOWED_ORIGINS: 'https://app.floz.local'
        })).toThrow();
      });

      it('uses test defaults without secrets in test environment', () => {
        const env = parseApiEnv({ NODE_ENV: 'test' });
        expect(env.API_PORT).toBe(3001);
        expect(env.ALLOWED_ORIGINS).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
      });
    });

    describe('parseWorkerEnv', () => {
      it('parses valid production environment with max 1 concurrency and DB_POOL_MAX', () => {
        const env = parseWorkerEnv({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgres://user:pass@db.floz.neon.tech/floz',
          REDIS_URL: 'rediss://default:pass@redis.floz.upstash.io:6379'
        });
        expect(env.NODE_ENV).toBe('production');
        expect(env.WORKER_CONCURRENCY).toBe(1);
        expect(env.DB_POOL_MAX).toBe(1);
      });

      it('rejects production worker without DATABASE_URL or REDIS_URL', () => {
        expect(() => parseWorkerEnv({ NODE_ENV: 'production' })).toThrow();
      });
    });

    describe('parseDatabaseEnv & parseMigrationEnv', () => {
      it('parses database environment correctly', () => {
        const dbEnv = parseDatabaseEnv({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgres://user:pass@db.floz.neon.tech/floz'
        });
        expect(dbEnv.DATABASE_URL).toBe('postgres://user:pass@db.floz.neon.tech/floz');
        expect(dbEnv.DB_POOL_MAX).toBe(1);
      });

      it('parses migration environment correctly', () => {
        const migEnv = parseMigrationEnv({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgres://user:pass@db.floz.neon.tech/floz'
        });
        expect(migEnv.DATABASE_URL).toBe('postgres://user:pass@db.floz.neon.tech/floz');
        expect(migEnv.DB_POOL_MAX).toBe(1);
      });
    });

    describe('parseWebEnv', () => {
      it('does not require DATABASE_URL, REDIS_URL, or auth secrets', () => {
        const webEnv = parseWebEnv({
          NODE_ENV: 'production',
          NEXT_PUBLIC_API_URL: 'https://api.floz.local'
        });
        expect(webEnv.NEXT_PUBLIC_API_URL).toBe('https://api.floz.local');
      });

      it('rejects non-HTTPS NEXT_PUBLIC_API_URL in production', () => {
        expect(() => parseWebEnv({
          NODE_ENV: 'production',
          NEXT_PUBLIC_API_URL: 'http://api.floz.local'
        })).toThrow();
      });
    });
  });
});
