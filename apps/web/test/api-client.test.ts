import { describe, expect, it, vi, beforeEach } from 'vitest';
import { api, apiFetch, ApiError } from '../lib/api-client';
import { notificationRoute, taskRoute } from '../lib/task-route';

describe('taskRoute', () => {
  it('builds the canonical selected task route', () => {
    expect(taskRoute('workspace-1', 'task-1')).toBe('/workspaces/workspace-1/tasks?selected_task_id=task-1');
  });

  it('preserves notification context routes and falls back to the task route', () => {
    expect(notificationRoute('workspace-1', 'task-1', '/custom/context')).toBe('/custom/context');
    expect(notificationRoute('workspace-1', 'task-1')).toBe('/workspaces/workspace-1/tasks?selected_task_id=task-1');
  });
});

describe('apiFetch client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('correctly appends /api/v1 prefix and executes fetch', async () => {
    const mockResponse = { ok: true, status: 200, json: async () => ({ data: 'ok' }) };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response);

    const result = await apiFetch('/test-route');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/test-route'),
      expect.objectContaining({ credentials: 'include' })
    );
    expect(result).toEqual({ data: 'ok' });
  });

  it('calls profile, password, and provisioning endpoints', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: {} }) } as Response);
    await api.auth.updateProfile({ full_name: 'Worker', timezone: 'UTC', locale: 'en-US', avatar_url: null });
    await api.auth.changePassword({ current_password: 'old-password', new_password: 'new-password' });
    await api.workspaces.provisionAccount('workspace-1', { email: 'worker@example.com', full_name: 'Worker' });
    expect(fetchSpy.mock.calls.map(([url, options]) => [String(url), options?.method])).toEqual([
      [expect.stringContaining('/api/v1/me'), 'PATCH'],
      [expect.stringContaining('/api/v1/me/password'), 'PATCH'],
      [expect.stringContaining('/api/v1/workspaces/workspace-1/accounts'), 'POST'],
    ]);
  });

  it('creates recurring tasks with the idempotency header', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: {} }),
    } as Response);
    const input = {
      name: 'Daily report',
      frequency: 'DAILY' as const,
      interval_value: 1,
      timezone: 'Asia/Jakarta',
      start_at: '2026-08-31T02:00:00.000Z',
      title: 'Daily report',
      status_id: 'status-1',
    };

    await api.tasks.createRecurring('workspace-1', input, 'attempt-1');

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/workspaces/workspace-1/recurring-tasks'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(input),
        headers: expect.any(Headers),
      })
    );
    const headers = fetchSpy.mock.calls[0][1]?.headers as Headers;
    expect(headers.get('Idempotency-Key')).toBe('attempt-1');
  });

  it('builds Task 6 reporting client routes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: {} }) } as Response);
    await api.workspaces.myWork('workspace-1', '2026-08-31');
    await api.workspaces.dashboardMember('workspace-1');
    await api.workspaces.dashboardManager('workspace-1', { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z', team_id: 'team-1' });
    await api.workspaces.kpis('workspace-1', { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z', assignee_id: 'user-1' });
    expect(fetchSpy.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining('/api/v1/workspaces/workspace-1/my-work?date=2026-08-31'),
      expect.stringContaining('/api/v1/workspaces/workspace-1/dashboard/member'),
      expect.stringContaining('/api/v1/workspaces/workspace-1/dashboard/manager?from=2026-08-01T00%3A00%3A00.000Z&to=2026-09-01T00%3A00%3A00.000Z&team_id=team-1'),
      expect.stringContaining('/api/v1/workspaces/workspace-1/reports/kpis?from=2026-08-01T00%3A00%3A00.000Z&to=2026-09-01T00%3A00%3A00.000Z&assignee_id=user-1')
    ]);
  });

  it('maps network errors to ApiError exception details', async () => {
    const mockErrResponse = {
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: async () => ({ code: 'VERSION_CONFLICT', message: 'Task modified by another user' }),
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockErrResponse as Response);

    await expect(apiFetch('/test-route')).rejects.toThrowError(
      new ApiError(409, 'VERSION_CONFLICT', 'Task modified by another user')
    );
  });
});
