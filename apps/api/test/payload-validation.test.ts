import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';

process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/floz';
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? 'test-secret-at-least-32-characters-long';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000,http://127.0.0.1:3000';

describe('Task 6 — Strict CORS, Logout, Validation and Payload Ingress', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('A. Strict Credentialed CORS & Preflight Contract', () => {
    it('sets exact allow-origin, credentials, and vary headers for approved origin', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('Origin', 'http://localhost:3000');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['vary']).toContain('Origin');
    });

    it('emits no CORS allow headers for unapproved origin', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('Origin', 'http://attacker-controlled.example');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('handles OPTIONS preflight with exact allowed methods and headers', async () => {
      const res = await request(app.getHttpServer())
        .options('/api/v1/auth/login')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type, X-Request-Id');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(res.headers['access-control-allow-credentials']).toBe('true');

      const allowMethods = res.headers['access-control-allow-methods']
        ?.split(',')
        .map((s: string) => s.trim().toUpperCase());
      expect(allowMethods).toEqual(expect.arrayContaining(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']));

      const allowHeaders = res.headers['access-control-allow-headers']
        ?.toLowerCase()
        .split(',')
        .map((s: string) => s.trim());
      expect(allowHeaders).toEqual(expect.arrayContaining(['content-type', 'x-request-id']));
    });

    it('denies preflight for unknown methods or unapproved headers', async () => {
      const res = await request(app.getHttpServer())
        .options('/api/v1/auth/login')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'TRACE');

      const allowMethods = res.headers['access-control-allow-methods']
        ?.split(',')
        .map((s: string) => s.trim().toUpperCase());
      expect(allowMethods).not.toContain('TRACE');
    });
  });

  describe('B. Runtime DTO Validation & Unknown Key Rejection', () => {
    it('rejects unknown top-level property with 400 VALIDATION_ERROR', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:3000')
        .send({ email: 'user@example.com', password: 'password123', unexpected_field: 'malicious' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'One or more fields are invalid.',
          details: []
        }
      });
    });

    it('rejects wrong property types without global implicit conversion', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:3000')
        .send({ email: 12345, password: true });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects unknown nested keys in complex DTO bodies', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/workspaces/00000000-0000-0000-0000-000000000001/workflows')
        .set('Origin', 'http://localhost:3000')
        .send({
          name: 'Custom Workflow',
          code: 'CUSTOM',
          statuses: [
            {
              name: 'To Do',
              code: 'TODO',
              category: 'TODO',
              is_initial: true,
              extra_unknown_status_key: 'invalid'
            }
          ],
          transitions: []
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('C. Body Limits and Malformed JSON Envelopes', () => {
    it('rejects payloads exceeding 1 MiB (1,048,576 bytes) with canonical 413 PAYLOAD_TOO_LARGE', async () => {
      // Create payload > 1,048,576 bytes (1 MiB + 1 byte)
      const largeString = 'a'.repeat(1048577);
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:3000')
        .set('Content-Type', 'application/json')
        .send(`{"email":"${largeString}"}`);

      expect(res.status).toBe(413);
      expect(res.body).toEqual({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Request body is too large.',
          details: []
        }
      });
    });

    it('rejects malformed JSON below 1 MiB with canonical 400 VALIDATION_ERROR', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:3000')
        .set('Content-Type', 'application/json')
        .send('{"email": "broken-json,');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'One or more fields are invalid.',
          details: []
        }
      });
    });
  });

  describe('D. Node / API-Owned Security Headers', () => {
    it('emits nosniff, DENY, strict-origin-when-cross-origin, and removes x-powered-by', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health');

      expect(res.status).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });
});
