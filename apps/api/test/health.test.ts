import { describe, expect, it } from 'vitest';
import { HealthController } from '../src/health.controller';

describe('HealthController', () => {
  it('reports API health', () => {
    expect(new HealthController().health()).toEqual({ data: { status: 'ok', service: 'api' } });
  });
});
