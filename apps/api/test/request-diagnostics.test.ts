import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { requestDiagnostics } from '../src/request-diagnostics.js';

const run = (rawHeaders: string[], path = '/api/v1/workspaces/secret/tasks?password=secret') => {
  const req = Object.assign(new EventEmitter(), { rawHeaders, method: 'GET', path, route: { path: '/workspaces/:workspaceId/tasks' } });
  const res = Object.assign(new EventEmitter(), { statusCode: 200, setHeader: vi.fn() });
  const logger = { info: vi.fn() };
  requestDiagnostics(logger as never, () => 10)(req as never, res as never, vi.fn());
  return { req, res, logger };
};

describe('request diagnostics', () => {
  it('preserves one valid raw request id and emits one safe completion', () => {
    const { res, logger } = run(['X-Request-Id', 'safe-id']);
    res.emit('finish');
    res.emit('close');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'safe-id');
    expect(logger.info).toHaveBeenCalledOnce();
    expect(logger.info.mock.calls[0]?.[0]).toEqual({ requestId: 'safe-id', method: 'GET', route: '/workspaces/:workspaceId/tasks', statusCode: 200, durationMs: 0, event: 'request.completed' });
  });

  it('replaces duplicate raw request ids and logs abort without attacker URL', () => {
    const { res, logger } = run(['X-Request-Id', 'first', 'x-request-id', 'second']);
    res.emit('close');
    expect(res.setHeader.mock.calls[0]?.[1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(logger.info.mock.calls[0]?.[0]).toMatchObject({ route: '[unmatched]', event: 'request.aborted' });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('secret');
  });

  it.each([
    ['a', 'a'],
    ['a'.repeat(128), 'a'.repeat(128)]
  ])('preserves valid request id length', (value, expected) => {
    const { res } = run(['X-Request-Id', value]);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', expected);
  });

  it.each(['', 'a'.repeat(129), 'bad id', 'ümlaut'])('replaces invalid request id', (value) => {
    const { res } = run(['X-Request-Id', value]);
    expect(res.setHeader.mock.calls[0]?.[1]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('does not emit sensitive fields in serialized diagnostics', () => {
    const { res, logger } = run(['X-Request-Id', 'safe-id'], '/api/v1/tasks?token=secret');
    res.emit('finish');
    const line = JSON.stringify(logger.info.mock.calls[0]?.[0]);
    expect(line).not.toMatch(/secret|token|authorization|cookie|password|sql/i);
  });

  it('excludes health probes', () => {
    const { res, logger } = run([], '/api/v1/health');
    res.emit('finish');
    expect(logger.info).not.toHaveBeenCalled();
  });
});
