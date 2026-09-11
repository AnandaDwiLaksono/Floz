import { describe, expect, it } from 'vitest';
import { createDatabase } from '../src/index.js';
import postgres from 'postgres';

describe('Task 3 — PostgreSQL Resource Bounds & Connection Timeout Policy', () => {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/floz';

  it('configures server-side statement_timeout and lock_timeout on client options', async () => {
    const { sql } = createDatabase(databaseUrl);
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

    const statementResult = await sql`SHOW statement_timeout`;
    expect(statementResult[0].statement_timeout).toBe('10s');

    const lockResult = await sql`SHOW lock_timeout`;
    expect(lockResult[0].lock_timeout).toBe('3s');

    await sql.end();
  });

  it('cancels statement execution if statement_timeout is exceeded', async () => {
    // Override statement_timeout to a very low value so we don't wait 10 seconds for the test
    const { sql } = createDatabase(databaseUrl);
    await sql`SET statement_timeout = 100`;

    let error: { code?: string } | undefined;
    try {
      await sql`SELECT pg_sleep(1)`;
    } catch (e) {
      error = e as { code?: string };
    }

    expect(error).toBeDefined();
    expect(error?.code).toBe('57014'); // query_canceled
    await sql.end();
  });

  it('cancels lock acquisition if lock_timeout is exceeded', async () => {
    const dbInit = createDatabase(databaseUrl);
    await dbInit.sql`CREATE TABLE IF NOT EXISTS test_lock_timeout_table (id int)`;
    await dbInit.sql.end();

    const db1 = createDatabase(databaseUrl);
    const db2 = createDatabase(databaseUrl);

    // Run connection 1 to grab the lock
    const p1 = db1.sql.begin(async (tx) => {
      await tx`LOCK TABLE test_lock_timeout_table IN EXCLUSIVE MODE`;
      await tx`SELECT pg_sleep(1)`;
    });

    // Wait 100ms to ensure db1 has acquired the lock
    await new Promise((r) => setTimeout(r, 100));

    // Run connection 2 to attempt to grab the lock, which should timeout
    let error: { code?: string } | undefined;
    try {
      await db2.sql.begin(async (tx) => {
        await tx`SET lock_timeout = 100`;
        await tx`LOCK TABLE test_lock_timeout_table IN EXCLUSIVE MODE`;
      });
    } catch (e) {
      error = e as { code?: string };
    }

    expect(error).toBeDefined();
    expect(error?.code).toBe('55P03'); // lock_not_available

    await p1;
    await db1.sql.end();
    await db2.sql.end();
  });
});

