import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { FlozService } from '../src/floz.service.js';

process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/floz';
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? 'test-secret-at-least-32-characters-long';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000,http://127.0.0.1:3000';

const unsafeInventory: Array<{ method: 'post' | 'put' | 'patch' | 'delete'; path: string; name: string }> = [
  { method: 'post', path: '/api/v1/auth/login', name: 'login' },
  { method: 'post', path: '/api/v1/auth/logout', name: 'logout' },
  { method: 'patch', path: '/api/v1/me', name: 'updateMe' },
  { method: 'patch', path: '/api/v1/me/password', name: 'changePassword' },
  { method: 'post', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/accounts', name: 'provisionAccount' },
  { method: 'patch', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001', name: 'patchWorkspace' },
  { method: 'post', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/members', name: 'addMember' },
  { method: 'patch', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/members/00000000-0000-0000-0000-000000000002', name: 'patchMember' },
  { method: 'post', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/teams', name: 'createTeam' },
  { method: 'patch', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/teams/00000000-0000-0000-0000-000000000003', name: 'updateTeam' },
  { method: 'post', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/teams/00000000-0000-0000-0000-000000000003/members', name: 'addTeamMember' },
  { method: 'delete', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/teams/00000000-0000-0000-0000-000000000003/members/00000000-0000-0000-0000-000000000002', name: 'removeTeamMember' },
  { method: 'post', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/workflows', name: 'createWorkflow' },
  { method: 'patch', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/workflows/00000000-0000-0000-0000-000000000004', name: 'updateWorkflow' },
  { method: 'post', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/workflows/00000000-0000-0000-0000-000000000004/set-default', name: 'setDefaultWorkflow' },
  { method: 'post', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/workflows/00000000-0000-0000-0000-000000000004/archive', name: 'archiveWorkflow' },
  { method: 'post', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/workflows/00000000-0000-0000-0000-000000000004/restore', name: 'restoreWorkflow' },
  { method: 'post', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/workflows/00000000-0000-0000-0000-000000000004/statuses', name: 'addWorkflowStatus' },
  { method: 'patch', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/workflows/00000000-0000-0000-0000-000000000004/statuses/00000000-0000-0000-0000-000000000005', name: 'updateWorkflowStatus' },
  { method: 'post', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/workflows/00000000-0000-0000-0000-000000000004/statuses/00000000-0000-0000-0000-000000000005/set-initial', name: 'setInitialWorkflowStatus' },
  { method: 'post', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/workflows/00000000-0000-0000-0000-000000000004/statuses/00000000-0000-0000-0000-000000000005/archive', name: 'archiveWorkflowStatus' },
  { method: 'post', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/workflows/00000000-0000-0000-0000-000000000004/statuses/00000000-0000-0000-0000-000000000005/restore', name: 'restoreWorkflowStatus' },
  { method: 'put', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/workflows/00000000-0000-0000-0000-000000000004/statuses/reorder', name: 'reorderWorkflowStatuses' },
  { method: 'put', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/workflows/00000000-0000-0000-0000-000000000004/transitions', name: 'replaceWorkflowTransitions' },
  { method: 'post', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/tasks', name: 'createTask' },
  { method: 'patch', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/tasks/00000000-0000-0000-0000-000000000006', name: 'updateTask' },
  { method: 'post', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/tasks/00000000-0000-0000-0000-000000000006/assignments', name: 'assignTask' },
  { method: 'delete', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/tasks/00000000-0000-0000-0000-000000000006', name: 'deleteTask' },
  { method: 'post', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/tasks/00000000-0000-0000-0000-000000000006/transitions', name: 'transitionTask' },
  { method: 'post', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/recurring-tasks', name: 'createRecurringTask' },
  { method: 'patch', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/recurrence-rules/00000000-0000-0000-0000-000000000007', name: 'updateRecurrenceRule' },
  { method: 'post', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/recurrence-rules/00000000-0000-0000-0000-000000000007/stop', name: 'stopRecurrenceRule' },
  { method: 'post', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/approval-requests', name: 'createApprovalRequest' },
  { method: 'post', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/approval-requests/00000000-0000-0000-0000-000000000008/steps/00000000-0000-0000-0000-000000000009/approve', name: 'approveApprovalStep' },
  { method: 'post', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/approval-requests/00000000-0000-0000-0000-000000000008/steps/00000000-0000-0000-0000-000000000009/reject', name: 'rejectApprovalStep' },
  { method: 'post', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/approval-requests/00000000-0000-0000-0000-000000000008/cancel', name: 'cancelApprovalRequest' },
  { method: 'post', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/tasks/00000000-0000-0000-0000-000000000006/comments', name: 'createComment' },
  { method: 'delete', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/tasks/00000000-0000-0000-0000-000000000006/comments/00000000-0000-0000-0000-000000000010', name: 'deleteComment' },
  { method: 'patch', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/notifications/00000000-0000-0000-0000-000000000011', name: 'markRead' },
  { method: 'post', path: '/api/v1/workspaces/00000000-0000-0000-0000-000000000001/notifications/mark-all-read', name: 'markAllRead' }
];

describe('Task 4 — CookieOriginGuard Exhaustive Ingress Verification', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('proves exactly 40 unsafe routes exist in the inventory', () => {
    expect(unsafeInventory).toHaveLength(40);
  });

  describe('Exhaustive 40-route origin rejection matrix', () => {
    for (const route of unsafeInventory) {
      it(`rejects missing Origin header for ${route.method.toUpperCase()} ${route.path} (${route.name})`, async () => {
        const req = request(app.getHttpServer())[route.method](route.path);
        const res = await req.send({});
        expect(res.status).toBe(403);
        expect(res.body).toEqual({
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have permission to perform this action.',
            details: []
          }
        });
      });

      it(`rejects Origin: null for ${route.method.toUpperCase()} ${route.path} (${route.name})`, async () => {
        const req = request(app.getHttpServer())[route.method](route.path);
        const res = await req.set('Origin', 'null').send({});
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });

      it(`rejects malformed Origin for ${route.method.toUpperCase()} ${route.path} (${route.name})`, async () => {
        const req = request(app.getHttpServer())[route.method](route.path);
        const res = await req.set('Origin', 'not-a-valid-url').send({});
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });

      it(`rejects path-bearing Origin for ${route.method.toUpperCase()} ${route.path} (${route.name})`, async () => {
        const req = request(app.getHttpServer())[route.method](route.path);
        const res = await req.set('Origin', 'http://localhost:3000/path').send({});
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });

      it(`rejects unapproved Origin for ${route.method.toUpperCase()} ${route.path} (${route.name})`, async () => {
        const req = request(app.getHttpServer())[route.method](route.path);
        const res = await req.set('Origin', 'http://attacker-controlled.example').send({});
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });
    }
  });

  describe('Non-browser cookie client rejection (no missing-Origin exemption)', () => {
    it('rejects cookie-authenticated mutation with missing Origin', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/me')
        .set('Cookie', 'floz_session=some-session-token')
        .send({ full_name: 'Attacker' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects cookie-authenticated mutation with unapproved Origin', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/me')
        .set('Cookie', 'floz_session=some-session-token')
        .set('Origin', 'http://evil.com')
        .send({ full_name: 'Attacker' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('Zero side-effects on rejected origins', () => {
    it('does not invoke service or auth methods when Origin is rejected', async () => {
      const flozService = app.get(FlozService);
      const updateUserSpy = vi.spyOn(flozService, 'updateUser');

      const res = await request(app.getHttpServer())
        .patch('/api/v1/me')
        .set('Origin', 'http://unapproved.example')
        .send({ full_name: 'New Name' });

      expect(res.status).toBe(403);
      expect(updateUserSpy).not.toHaveBeenCalled();
      updateUserSpy.mockRestore();
    });
  });

  describe('Safe probes and read-only routes exemption', () => {
    it('admits GET /api/v1/health without Origin header', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health');
      expect(res.status).toBe(200);
    });

    it('admits GET /api/v1/me without Origin header and returns auth failure (not origin 403)', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('admits OPTIONS preflight without Origin header', async () => {
      const res = await request(app.getHttpServer()).options('/api/v1/auth/login');
      expect(res.status).not.toBe(403);
    });
  });

  describe('Public signup route unmounted assertion', () => {
    it('returns 404 for public signup even with an approved Origin', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/sign-up/email')
        .set('Origin', 'http://localhost:3000')
        .send({ email: 'test@example.com', password: 'password123', name: 'Test' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('Approved origin admission & business semantics preservation', () => {
    it('admits POST /api/v1/auth/login with approved Origin and proceeds to validation/auth logic', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:3000')
        .send({ email: 'nonexistent@example.com', password: 'wrongpassword' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });
  });
});
