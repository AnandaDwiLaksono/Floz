import { describe, expect, it } from 'vitest';
import { createLogger, requestId, sanitizeError } from '../src/index.js';

const serialized = (value: unknown) => {
  const lines: string[] = [];
  const logger = createLogger('test', 'info', { write: (line: string) => lines.push(line) });
  logger.info(value);
  return lines.join('');
};

describe('observability', () => {
  it('keeps exactly one valid request id and replaces invalid or duplicate values', () => {
    expect(requestId('abc-_.:123')).toBe('abc-_.:123');
    expect(requestId(['abc', 'def'])).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestId('bad/value')).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reduces errors to allow-listed type and code', () => {
    expect(sanitizeError({ name: 'DatabaseError', code: '23505', message: 'postgres://u:p@db/x?secret=1', stack: 'secret' })).toEqual({
      type: 'DatabaseError',
      code: '23505'
    });
    expect(sanitizeError(new Error('password=secret'))).toEqual({ type: 'Error', code: 'INTERNAL_ERROR' });
  });

  it('serializes canaries without URLs, secrets, raw error data, or request content', () => {
    const output = serialized({
      req: { headers: { authorization: 'Bearer secret', cookie: 'sid=secret', 'set-cookie': 'sid=secret' } },
      res: { headers: { 'set-cookie': 'sid=secret' } },
      password: 'secret', token: 'secret', data: { password: 'secret' },
      err: { name: 'Error', code: 'INTERNAL_ERROR', message: 'secret', stack: 'secret', cause: 'secret' },
      url: 'https://db.test/path?q=secret', body: 'secret', query: 'secret'
    });
    for (const canary of ['https://db.test', 'secret', 'sid=', 'Bearer', 'password', 'stack', 'cause', 'query', 'body']) {
      expect(output).not.toContain(canary);
    }
    expect(output).toContain('time');
    expect(output).toContain('level');
  });
});
