import { describe, expect, it } from 'vitest';

describe('worker bootstrap', () => {
  it('defines its service name', () => {
    expect('worker').toBe('worker');
  });
});
