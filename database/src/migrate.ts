import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { normalizePostgresTls, type NodeEnv } from '@floz/config';
import postgres from 'postgres';

const migrationTimeoutMs = 60000;

export type MigrateOptions = {
  outerTimeoutMs?: number;
  onBackendPid?: (pid: number, stage: 'connected' | 'locked' | 'migrated' | 'unlocking') => void | Promise<void>;
  nodeEnv?: NodeEnv;
  dbSsl?: string;
};

export const migrationAdvisoryKey = (environment: string, database: string) => createHash('sha256')
  .update(`floz:production-migration:${environment}:${database}`)
  .digest().readBigInt64BE();

export async function migrateDatabase(url: string, options: MigrateOptions = {}) {
  const nodeEnv = options.nodeEnv ?? (process.env.NODE_ENV ?? 'development') as NodeEnv;
  const { ssl } = normalizePostgresTls(url, options.dbSsl, nodeEnv);
  let closed = false;
  const sql = postgres(url, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 0,
    max_lifetime: null,
    ssl: ssl === false ? undefined : nodeEnv === 'production' ? { rejectUnauthorized: true } : ssl,
    connection: { statement_timeout: 10000, lock_timeout: 3000 },
    onclose: () => { closed = true; }
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
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          void sql.end({ timeout: 0 });
          reject(new Error('Database migration timed out'));
        }, options.outerTimeoutMs ?? migrationTimeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  await migrateDatabase(url, { nodeEnv: (process.env.NODE_ENV ?? 'production') as NodeEnv, dbSsl: process.env.DB_SSL });
}
