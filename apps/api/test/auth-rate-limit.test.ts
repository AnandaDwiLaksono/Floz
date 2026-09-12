import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module.js';
import { ErrorFilter } from '../src/error.filter.js';
import { AuthRateLimitGuard } from '../src/auth-rate-limit.guard.js';

process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/floz';
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? 'test-secret-at-least-32-characters-long';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000,http://127.0.0.1:3000';

describe('Task 5 — AuthRateLimitGuard Verification', () => {
  let app: INestApplication;
  let rateLimitGuard: AuthRateLimitGuard;
  let mockTime = 100000;

  beforeEach(async () => {
    mockTime = 100000;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalFilters(new ErrorFilter());

    rateLimitGuard = app.get(AuthRateLimitGuard);
    rateLimitGuard.reset();
    rateLimitGuard.setTimeProvider(() => mockTime);

    await app.init();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('admits requests 1-10 and rejects call 11 with 429 and Retry-After header', async () => {
    for (let i = 1; i <= 10; i += 1) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:3000')
        .send({ email: 'fake@example.com', password: 'wrong' });
      expect(res.status).toBe(401);
    }

    const res11 = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email: 'fake@example.com', password: 'wrong' });

    expect(res11.status).toBe(429);
    expect(res11.headers['retry-after']).toBe('60');
    expect(res11.body).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests.',
        details: []
      }
    });
  });

  it('resets quota after 60-second window expiry', async () => {
    for (let i = 1; i <= 10; i += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:3000')
        .send({ email: 'fake@example.com', password: 'wrong' });
    }

    const res11 = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email: 'fake@example.com', password: 'wrong' });
    expect(res11.status).toBe(429);

    // Advance time past 60s
    mockTime += 60001;

    const resReset = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email: 'fake@example.com', password: 'wrong' });
    expect(resReset.status).toBe(401);
  });

  it('shares quota across protected routes (login, logout, password, provisioning)', async () => {
    // 3 logins
    for (let i = 0; i < 3; i += 1) {
      await request(app.getHttpServer()).post('/api/v1/auth/login').set('Origin', 'http://localhost:3000').send({});
    }
    // 3 logouts
    for (let i = 0; i < 3; i += 1) {
      await request(app.getHttpServer()).post('/api/v1/auth/logout').set('Origin', 'http://localhost:3000');
    }
    // 3 password changes
    for (let i = 0; i < 3; i += 1) {
      await request(app.getHttpServer()).patch('/api/v1/me/password').set('Origin', 'http://localhost:3000').send({});
    }
    // 1 provisioning
    await request(app.getHttpServer()).post('/api/v1/workspaces/wid/accounts').set('Origin', 'http://localhost:3000').send({});

    // 11th request to any protected route is rate limited
    const res11 = await request(app.getHttpServer()).post('/api/v1/auth/login').set('Origin', 'http://localhost:3000').send({});
    expect(res11.status).toBe(429);
  });

  it('requests rejected by CookieOriginGuard do NOT consume rate-limit quota', async () => {
    // 10 calls rejected by CookieOriginGuard due to missing Origin
    for (let i = 0; i < 10; i += 1) {
      const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({});
      expect(res.status).toBe(403);
    }

    // Now send 10 valid calls with approved Origin
    for (let i = 0; i < 10; i += 1) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:3000')
        .send({ email: 'a@b.com', password: 'p' });
      expect(res.status).toBe(401);
    }

    // 11th valid call is 429
    const res11 = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({});
    expect(res11.status).toBe(429);
  });

  it('does not rate-limit health probes, OPTIONS, or non-protected routes', async () => {
    for (let i = 0; i < 15; i += 1) {
      const resHealth = await request(app.getHttpServer()).get('/api/v1/health');
      expect(resHealth.status).toBe(200);

      const resMe = await request(app.getHttpServer()).get('/api/v1/me');
      expect(resMe.status).toBe(401);
      expect(resMe.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('calculates Retry-After correctly for 1ms, 1001ms, and 60000ms remaining duration', async () => {
    for (let i = 0; i < 10; i += 1) {
      await request(app.getHttpServer()).post('/api/v1/auth/login').set('Origin', 'http://localhost:3000').send({});
    }

    // 60000ms remaining -> Retry-After = 60
    mockTime = 100000;
    const res60 = await request(app.getHttpServer()).post('/api/v1/auth/login').set('Origin', 'http://localhost:3000').send({});
    expect(res60.status).toBe(429);
    expect(res60.headers['retry-after']).toBe('60');

    // 1001ms remaining -> Retry-After = 2 (ceil(1.001) = 2)
    mockTime = 100000 + 60000 - 1001;
    const res2 = await request(app.getHttpServer()).post('/api/v1/auth/login').set('Origin', 'http://localhost:3000').send({});
    expect(res2.status).toBe(429);
    expect(res2.headers['retry-after']).toBe('2');

    // 1ms remaining -> Retry-After = 1 (ceil(0.001) = 1)
    mockTime = 100000 + 60000 - 1;
    const res1 = await request(app.getHttpServer()).post('/api/v1/auth/login').set('Origin', 'http://localhost:3000').send({});
    expect(res1.status).toBe(429);
    expect(res1.headers['retry-after']).toBe('1');
  });

  it('enforces 10,000 key capacity limit and fails closed without active key eviction', () => {
    // Directly exercise rateLimitGuard map to fill 10,000 active keys
    const internalGuard = rateLimitGuard as any;
    internalGuard.reset();

    for (let i = 0; i < 10000; i += 1) {
      internalGuard.ipMap.set(`10.0.${Math.floor(i / 256)}.${i % 256}`, {
        count: 1,
        windowStart: mockTime
      });
    }

    expect(internalGuard.ipMap.size).toBe(10000);

    // Context mock for 10,001st key
    const mockContext = (ip: string) => ({
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', path: '/api/v1/auth/login', headers: {}, socket: { remoteAddress: ip } }),
        getResponse: () => ({ setHeader: vi.fn() })
      })
    }) as any;

    // 10,001st key fails closed with 429
    expect(() => internalGuard.canActivate(mockContext('192.168.1.1'))).toThrow();
    expect(internalGuard.ipMap.size).toBe(10000);
    expect(internalGuard.ipMap.has('192.168.1.1')).toBe(false);

    // Advance time to expire keys
    mockTime += 60001;

    // Now new key can be admitted
    expect(internalGuard.canActivate(mockContext('192.168.1.1'))).toBe(true);
    expect(internalGuard.ipMap.has('192.168.1.1')).toBe(true);
  });

  it('ignores X-Forwarded-For header from an untrusted peer socket IP', () => {
    const internalGuard = rateLimitGuard as any;
    const mockContext = (socketIp: string, forwardedFor?: string) => ({
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          path: '/api/v1/auth/login',
          headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
          socket: { remoteAddress: socketIp }
        }),
        getResponse: () => ({ setHeader: vi.fn() })
      })
    }) as any;

    // Untrusted peer socket IP (203.0.113.1) sends spoofed X-Forwarded-For: 1.1.1.1
    const ip = internalGuard.getClientIp(mockContext('203.0.113.1', '1.1.1.1').switchToHttp().getRequest());
    expect(ip).toBe('203.0.113.1');

    // Trusted proxy socket IP (127.0.0.1) sends X-Forwarded-For: 203.0.113.5
    const ipTrusted = internalGuard.getClientIp(mockContext('127.0.0.1', '203.0.113.5').switchToHttp().getRequest());
    expect(ipTrusted).toBe('203.0.113.5');
  });

  it('normalizes IPv4-mapped IPv6 addresses consistently', () => {
    const internalGuard = rateLimitGuard as any;
    expect(internalGuard.normalizeIp('::ffff:203.0.113.4')).toBe('203.0.113.4');
    expect(internalGuard.normalizeIp('127.0.0.1')).toBe('127.0.0.1');
    expect(internalGuard.normalizeIp('::1')).toBe('::1');
  });
});
