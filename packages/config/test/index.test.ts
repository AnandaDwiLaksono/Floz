import { describe, expect, it } from 'vitest';
import { parseApiEnv, parseWebEnv } from '../src/index.js';

describe('environment validation', () => {
  it('uses local defaults without provider secrets', () => {
    expect(parseApiEnv({ NODE_ENV: 'test' }).API_PORT).toBe(3001);
    expect(parseWebEnv({ NODE_ENV: 'test' }).NEXT_PUBLIC_API_URL).toBe('http://localhost:3001');
  });

  it('rejects invalid ports', () => {
    expect(() => parseApiEnv({ API_PORT: 'none' })).toThrow();
  });
});
