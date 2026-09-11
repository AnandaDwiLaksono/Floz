import { describe, expect, it } from 'vitest';
import { createDatabase } from '../src/index.js';

describe('Task 3 — PostgreSQL Resource Bounds & Connection Timeout Policy', () => {
  it('configures server-side statement_timeout and lock_timeout on client options', () => {
    const { sql } = createDatabase('postgres://postgres:postgres@localhost:5432/floz');
    const options = (sql as unknown as {
      options: {
        max: number;
        connect_timeout: number;
        idle_timeout: number;
        connection: { statement_timeout: number; lock_timeout: number };
      };
    }).options;

    expect(options.max).toBe(1);
    expect(options.connect_timeout).toBe(5);
    expect(options.idle_timeout).toBe(20);
    expect(options.connection.statement_timeout).toBe(10000);
    expect(options.connection.lock_timeout).toBe(3000);

    void sql.end();
  });
});
