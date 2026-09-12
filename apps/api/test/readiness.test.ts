import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { ReadinessService } from '../src/readiness.service';

process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/floz';
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? 'test-secret-at-least-32-characters-long';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

describe('prefixed health probes', () => {
  let app: INestApplication;
  let readiness: ReadinessService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    readiness = app.get(ReadinessService);
    vi.spyOn(readiness, 'check');
  });

  afterAll(async () => { await app.close(); });

  it('serves only prefixed probes with no-store and no Origin', async () => {
    vi.mocked(readiness.check).mockResolvedValue(true);
    for (const path of ['/api/v1/health', '/api/v1/health/live', '/api/v1/health/ready']) {
      const response = await request(app.getHttpServer()).get(path);
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
    }
    await expect(request(app.getHttpServer()).get('/health')).resolves.toMatchObject({ status: 404 });
  });

  it('returns a sanitized 503 when PostgreSQL readiness fails', async () => {
    vi.mocked(readiness.check).mockResolvedValue(false);
    const response = await request(app.getHttpServer()).get('/api/v1/health/ready');

    expect(response.status).toBe(503);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable.', details: [] } });
  });
});
