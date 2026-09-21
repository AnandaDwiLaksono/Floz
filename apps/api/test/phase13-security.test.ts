import { describe, it, expect } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { CookieOriginGuard } from '../src/cookie-origin.guard';

describe('Phase 13 Security Guards & Invariant Protection', () => {
  it('CookieOriginGuard rejects unsafe mutation without Origin header', () => {
    const guard = new CookieOriginGuard();
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          path: '/api/v1/workspace-joins',
          headers: {}
        })
      })
    } as unknown as ExecutionContext;

    expect(() => guard.canActivate(mockContext)).toThrow('FORBIDDEN');
  });

  it('CookieOriginGuard allows mutation with valid Origin header', () => {
    const guard = new CookieOriginGuard();
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          path: '/api/v1/workspace-joins',
          headers: { origin: 'http://localhost:3000' }
        })
      })
    } as unknown as ExecutionContext;

    expect(guard.canActivate(mockContext)).toBe(true);
  });
});
