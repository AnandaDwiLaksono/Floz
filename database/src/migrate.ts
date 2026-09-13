import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { normalizePostgresTls, parseMigrationEnv, type NodeEnv } from '@floz/config';
import postgres from 'postgres';

const migrationTimeoutMs = 60000;

export type MigrateOptions = {
  outerTimeoutMs?: number;
  onBackendPid?: (pid: number, stage: 'connected' | 'locked' | 'journal-before' | 'journal-after' | 'transaction-before' | 'transaction-after' | 'migrated' | 'unlocking-before' | 'unlocking-after') => void | Promise<void>;
  nodeEnv?: NodeEnv;
  dbSsl?: string;
  onQuery?: (query: string) => void;
  onMigrationTransaction?: (pid: number) => void | Promise<void>;
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
    debug: options.onQuery ? (_id, query) => options.onQuery?.(query) : false,
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
      let unlocked = false;
      try {
        await options.onBackendPid?.(Number((await sql`select pg_backend_pid() as pid`)[0].pid), 'locked');
        ensureOpen();
        const db = drizzle(sql);
        const migrationConfig = { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) };
        await options.onBackendPid?.(Number((await sql`select pg_backend_pid() as pid`)[0].pid), 'journal-before');
        const migrations = readMigrationFiles(migrationConfig);
        ensureOpen();
        await options.onBackendPid?.(Number((await sql`select pg_backend_pid() as pid`)[0].pid), 'journal-after');
        ensureOpen();
        await options.onBackendPid?.(Number((await sql`select pg_backend_pid() as pid`)[0].pid), 'transaction-before');
        const internal = db as unknown as { dialect: { migrate: (migrations: ReturnType<typeof readMigrationFiles>, session: unknown, config: typeof migrationConfig) => Promise<void> }; session: { transaction: (callback: (tx: unknown) => Promise<void>) => Promise<void> } };
        const transaction = internal.session.transaction.bind(internal.session);
        const session = options.onMigrationTransaction ? {
          ...internal.session,
          transaction: (callback: (tx: unknown) => Promise<void>) => transaction(async (tx) => {
            await options.onMigrationTransaction?.(pid);
            ensureOpen();
            await callback(tx);
          })
        } : internal.session;
        await internal.dialect.migrate(migrations, session, migrationConfig);
        ensureOpen();
        await options.onBackendPid?.(Number((await sql`select pg_backend_pid() as pid`)[0].pid), 'transaction-after');
        ensureOpen();
        await options.onBackendPid?.(Number((await sql`select pg_backend_pid() as pid`)[0].pid), 'migrated');
        await options.onBackendPid?.(Number((await sql`select pg_backend_pid() as pid`)[0].pid), 'unlocking-before');
        ensureOpen();
        await sql.unsafe(`select pg_advisory_unlock(${key})`);
        unlocked = true;
        ensureOpen();
        await options.onBackendPid?.(Number((await sql`select pg_backend_pid() as pid`)[0].pid), 'unlocking-after');
        return { backendPid: pid };
      } finally {
        if (!closed && !unlocked) await sql.unsafe(`select pg_advisory_unlock(${key})`);
      }
    } finally {
      await sql.end({ timeout: 5000 });
    }
  };
  let timedOut = false;
  let cleanup: Promise<unknown> | undefined;
  const timer = setTimeout(() => {
    timedOut = true;
    cleanup = sql.end({ timeout: 0 });
  }, options.outerTimeoutMs ?? migrationTimeoutMs);
  try {
    const result = await run();
    if (cleanup) await cleanup;
    if (timedOut) throw new Error('Database migration timed out');
    return result;
  } catch (error) {
    if (cleanup) await cleanup;
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
