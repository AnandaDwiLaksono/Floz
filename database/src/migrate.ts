import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { normalizePostgresTls, parseMigrationEnv, type NodeEnv } from '@floz/config';
import postgres from 'postgres';

const migrationTimeoutMs = 60000;

export type MigrateOptions = {
  outerTimeoutMs?: number;
  onBackendPid?: (pid: number, stage: 'connected' | 'locked' | 'journal' | 'transaction' | 'migrated' | 'unlocking') => void | Promise<void>;
  nodeEnv?: NodeEnv;
  dbSsl?: string;
};

export const migrationAdvisoryKey = (environment: string, database: string) => createHash('sha256')
  .update(`floz:production-migration:${environment}:${database}`)
  .digest().readBigInt64BE();

export async function migrateDatabase(url: string, options: MigrateOptions = {}) {
  const environment = parseMigrationEnv({
    ...process.env,
    NODE_ENV: options.nodeEnv ?? process.env.NODE_ENV,
    DATABASE_URL: url,
    DB_SSL: options.dbSsl ?? process.env.DB_SSL
  });
  const nodeEnv = environment.NODE_ENV;
  const { ssl } = normalizePostgresTls(url, environment.DB_SSL, nodeEnv);
  let closed = false;
  let sql: ReturnType<typeof postgres>;
  sql = postgres(url, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 0,
    max_lifetime: null,
    ssl: ssl === false ? undefined : nodeEnv === 'production' ? { rejectUnauthorized: true } : ssl,
    connection: { statement_timeout: 10000, lock_timeout: 3000 },
    onclose: () => {
      closed = true;
      void sql.end({ timeout: 0 });
    }
  });
  const ensureOpen = () => {
    if (closed) throw new Error('Database migration session was lost');
  };
  const run = async () => {
    try {
      ensureOpen();
      const session = await sql`select pg_backend_pid() as pid, current_database() as database`;
      const pid = Number(session[0].pid);
      const key = migrationAdvisoryKey(nodeEnv, String(session[0].database));
      await options.onBackendPid?.(pid, 'connected');
      ensureOpen();
      const locked = (await sql.unsafe(`select pg_try_advisory_lock(${key}) as locked`))[0].locked;
      if (!locked) throw new Error('Database migration advisory lock unavailable');
      try {
        await options.onBackendPid?.(Number((await sql`select pg_backend_pid() as pid`)[0].pid), 'locked');
        ensureOpen();
        await options.onBackendPid?.(Number((await sql`select pg_backend_pid() as pid`)[0].pid), 'journal');
        ensureOpen();
        await options.onBackendPid?.(Number((await sql`select pg_backend_pid() as pid`)[0].pid), 'transaction');
        ensureOpen();
        await migrate(drizzle(sql), { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
        ensureOpen();
        await options.onBackendPid?.(Number((await sql`select pg_backend_pid() as pid`)[0].pid), 'migrated');
        await options.onBackendPid?.(Number((await sql`select pg_backend_pid() as pid`)[0].pid), 'unlocking');
        return { backendPid: pid };
      } finally {
        if (!closed) await sql.unsafe(`select pg_advisory_unlock(${key})`);
      }
    } finally {
      await sql.end({ timeout: 5000 });
    }
  };
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void sql.end({ timeout: 0 });
  }, options.outerTimeoutMs ?? migrationTimeoutMs);
  try {
    const result = await run();
    if (timedOut) throw new Error('Database migration timed out');
    return result;
  } catch (error) {
    if (timedOut) throw new Error('Database migration timed out');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  await migrateDatabase(url, { nodeEnv: (process.env.NODE_ENV ?? 'production') as NodeEnv, dbSsl: process.env.DB_SSL });
}
