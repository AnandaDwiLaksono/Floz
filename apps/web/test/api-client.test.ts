import { describe, expect, it, vi, beforeEach } from 'vitest';
import { api, apiFetch, ApiError } from '../lib/api-client';

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
