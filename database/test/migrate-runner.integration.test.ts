import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { migrateDatabase, migrationAdvisoryKey } from '../src/migrate.js';

const baseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/postgres';
const database = `migrate_${randomUUID().replaceAll('-', '')}`;
const url = new URL(baseUrl);
url.pathname = `/${database}`;
const databaseUrl = url.toString();
const adminUrl = new URL(baseUrl);
adminUrl.pathname = '/postgres';
const migrationsDir = new URL('../drizzle/', import.meta.url);
const migrationBytes = async () => Promise.all((await readdir(migrationsDir))
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => [file, createHash('sha256').update(readFileSync(new URL(file, migrationsDir))).digest('hex')]));
const advisoryKey = (environment: string) => migrationAdvisoryKey(environment, database);

const runCompiled = async (environment: string) => {
  const child = spawn(process.execPath, ['dist/migrate.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: environment },
    stdio: 'ignore'
  });
  const [code] = await once(child, 'exit') as [number | null];
  return code;
};

describe('compiled session-locked migrator', () => {
  const admin = postgres(adminUrl.toString(), { max: 1 });

  beforeAll(async () => {
    await admin.unsafe(`create database "${database}"`);
  });

  afterAll(async () => {
    await admin.unsafe(`drop database if exists "${database}" with (force)`);
    await admin.end();
  });

  it('applies checked-in migrations to a clean database', async () => {
    expect(await runCompiled('test')).toBe(0);
    const sql = postgres(databaseUrl, { max: 1 });
    const rows = await sql`select count(*)::int as count from drizzle.__drizzle_migrations`;
    expect(rows[0].count).toBe(9);
    await sql.end();
  });

  it('rejects invalid NODE_ENV before connecting', async () => {
    expect(await runCompiled('invalid')).not.toBe(0);
    await expect(migrateDatabase(databaseUrl, { nodeEnv: 'invalid' as never })).rejects.toThrow();
  });

  it('applies the latest migration to a valid populated pre-latest database', async () => {
    const sql = postgres(databaseUrl, { max: 1 });
    await sql.unsafe('drop index if exists task_statuses_workflow_name_lower_idx, task_statuses_active_initial_idx, workflows_active_workspace_default_idx, workflows_active_team_default_idx');
    await sql`alter table task_statuses drop column is_active`;
    await sql`alter table workflows drop column version`;
    await sql`delete from drizzle.__drizzle_migrations where created_at = 1788879047610`;
    await migrateDatabase(databaseUrl, { nodeEnv: 'test' });
    const latest = await sql`select count(*)::int as count from drizzle.__drizzle_migrations where created_at = 1788879047610`;
    expect(latest[0].count).toBe(1);
    await sql.end();
  });

  it('reruns without changing valid populated data or the migration journal', async () => {
    const sql = postgres(databaseUrl, { max: 1 });
    await sql`insert into roles(id, code, name) values (${randomUUID()}, 'KEEP', 'Keep')`;
    const before = await sql`select count(*)::int as count from drizzle.__drizzle_migrations`;
    await migrateDatabase(databaseUrl, { nodeEnv: 'test' });
    const after = await sql`select count(*)::int as count from drizzle.__drizzle_migrations`;
    const kept = await sql`select count(*)::int as count from roles where name = 'Keep'`;
    expect(after).toEqual(before);
    expect(kept[0].count).toBe(1);
    await sql.end();
  });

  it('fails closed when the exact environment/database lock is held', async () => {
    const competitor = postgres(databaseUrl, { max: 1 });
    await competitor.unsafe(`select pg_advisory_lock(${advisoryKey('test')})`);
    try {
      await expect(migrateDatabase(databaseUrl, { nodeEnv: 'test' })).rejects.toThrow('advisory lock unavailable');
    } finally {
      await competitor.unsafe(`select pg_advisory_unlock(${advisoryKey('test')})`);
      await competitor.end();
    }
  });

  it('keeps one PID through lock, journal, transaction, and unlock', async () => {
    const pids: number[] = [];
    const stages: string[] = [];
    await migrateDatabase(databaseUrl, { nodeEnv: 'test', onBackendPid: (pid, stage) => { pids.push(pid); stages.push(stage); } });
    expect(stages).toEqual(['connected', 'locked', 'journal', 'transaction', 'migrated', 'unlocking']);
    expect(new Set(pids).size).toBe(1);
  });

  it('fails fatally after session loss before journal access', async () => {
    await expect(migrateDatabase(databaseUrl, {
      nodeEnv: 'test',
      outerTimeoutMs: 1000,
      onBackendPid: async (pid, stage) => {
        if (stage === 'locked') await admin`select pg_terminate_backend(${pid})`;
      }
    })).rejects.toThrow();
  });

  it('fails when its outer timeout expires without continuing migration work', async () => {
    const before = await migrationBytes();
    await expect(migrateDatabase(databaseUrl, { nodeEnv: 'test', outerTimeoutMs: 0 })).rejects.toThrow('timed out');
    expect(await migrationBytes()).toEqual(before);
  });

  it('does not alter checked-in migration bytes', async () => {
    const before = await migrationBytes();
    await migrateDatabase(databaseUrl, { nodeEnv: 'test' });
    expect(await migrationBytes()).toEqual(before);
  });
});
