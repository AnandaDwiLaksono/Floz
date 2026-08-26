import { describe, expect, it, vi, beforeEach } from 'vitest';
import { apiFetch, ApiError } from '../lib/api-client';

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
