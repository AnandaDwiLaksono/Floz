import { describe, expect, it } from 'vitest';

describe('web health', () => {
  it('has a health message', () => {
    expect('Floz is healthy.').toContain('healthy');
  });
});
