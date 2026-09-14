import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, test } from 'vitest';
import { createBackup } from '../backup/backup.mjs';

const recipient = 'age1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const child = (output: string, code = 0) => {
  const process = new EventEmitter() as EventEmitter & { stdout: PassThrough; stdin: PassThrough };
  process.stdout = new PassThrough(); process.stdin = new PassThrough();
  queueMicrotask(() => { process.stdout.end(output); process.emit('close', code); });
  return process;
};
const options = (stage: string, overrides = {}) => ({ backupId: 'b1', environment: 'test', recipient, remote: 'fixture/backups', endpoint: 'http://minio:9000', accessKey: 'fixture-upload', secretKey: 'fixture-secret', stage, databaseUrl: 'postgres://fixture:fixture@db:5432/fixture', spawnChild: (command: string) => child(command === 'pg_dump' ? 'dump' : ''), upload: async () => {}, download: async () => readFile(stage), journal: async () => ({ migration: '0001' }), ...overrides });

describe('backup pipeline', () => {
  test('streams pg_dump stdout into age and removes encrypted stage after verified download', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'floz-backup-')); const stage = join(dir, 'backup.dump.age'); const published: string[] = [];
    const result = await createBackup(options(stage, { publishMetadata: async () => { published.push('metadata'); }, publishLastSuccess: async () => { published.push('last-success'); }, retain: async () => { published.push('retention'); } }) as never);
    expect(result.encryptedSha256).toHaveLength(64); expect(result).not.toHaveProperty('databaseUrl'); expect(result).not.toHaveProperty('accessKey'); expect(result).not.toHaveProperty('secretKey'); expect(published).toEqual(['metadata', 'last-success', 'retention']);
    await expect(stat(stage)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('does not publish last-success after metadata failure and cleans encrypted files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'floz-backup-')); const stage = join(dir, 'backup.dump.age'); const published: string[] = [];
    await expect(createBackup(options(stage, { publishMetadata: async () => { throw new Error('metadata failed'); }, publishLastSuccess: async () => { published.push('last-success'); } }) as never)).rejects.toThrow('metadata failed');
    expect(published).toEqual([]); await expect(stat(stage)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('does not publish metadata or last-success after downloaded-byte hash mismatch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'floz-backup-')); const stage = join(dir, 'backup.dump.age'); const published: string[] = [];
    await expect(createBackup(options(stage, { download: async () => Buffer.from('corrupt'), publishMetadata: async () => { published.push('metadata'); }, publishLastSuccess: async () => { published.push('last-success'); } }) as never)).rejects.toThrow('hash mismatch');
    expect(published).toEqual([]); await expect(stat(stage)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('rejects unsafe endpoints and production-looking credentials before spawning', async () => {
    await expect(createBackup({ environment: 'test', recipient, remote: 'fixture/backups', endpoint: 'https://r2.example', accessKey: 'production-key', secretKey: 'secret' } as never)).rejects.toThrow('unsafe backup target');
  });

  test.each(['pg_dump', 'age', 'upload', 'download', 'metadata', 'last-success'])('does not publish last-success when %s fails', async (failure) => {
    const dir = await mkdtemp(join(tmpdir(), 'floz-backup-')); const stage = join(dir, 'backup.dump.age'); const published: string[] = [];
    const failed = () => { throw new Error(`${failure} failed`); };
    const overrides = failure === 'pg_dump' || failure === 'age' ? { spawnChild: (command: string) => child(command === 'pg_dump' ? 'dump' : '', command === failure ? 42 : 0), upload: async () => {}, download: async () => readFile(stage), publishMetadata: async () => {}, publishLastSuccess: async () => { published.push('last-success'); } } : {
      upload: failure === 'upload' ? failed : async () => {},
      download: failure === 'download' ? failed : async () => readFile(stage),
      publishMetadata: failure === 'metadata' ? failed : async () => {},
      publishLastSuccess: failure === 'last-success' ? failed : async () => { published.push('last-success'); },
    };
    await expect(createBackup(options(stage, overrides) as never)).rejects.toThrow(`${failure} failed`);
    expect(published).toEqual([]); await expect(stat(stage)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('pins PostgreSQL 16 client through verified PGDG repository key', () => {
    const dockerfile = readFileSync(join(process.cwd(), 'docker/backup.Dockerfile'), 'utf8');
    expect(dockerfile).toMatch(/postgresql-client-16=16\./);
    expect(dockerfile).toContain('ACCC4CF8');
    expect(dockerfile).toContain('apt.postgresql.org');
  });

  test('uses PostgreSQL 16 fixture digest and grants distinct non-admin backup and retention actors', () => {
    const script = readFileSync(join(process.cwd(), '../scripts/test-phase12-backup.ps1'), 'utf8');
    expect(script).toContain("postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685");
    expect(script).toMatch(/BACKUP_ACCESS_KEY='fixture-upload'/);
    expect(script).not.toMatch(/BACKUP_ACCESS_KEY='fixture-admin'/);
    expect(script).toContain('backup-upload');
    expect(script).toContain('backup-retention');
    expect(script).toContain('fixture-retention');
    expect(script).not.toMatch(/fixture-admin[^\n]*BACKUP_ACCESS_KEY/);
    expect(script).toContain('sslmode=verify-full');
    expect(script).toContain('sslrootcert=/tls/ca.crt');
    expect(script).not.toContain('sslmode=disable');
    expect(script).toContain('DNS:phase12-backup-postgres');
    expect(script).toContain('TLS bad CA rejected');
    expect(script).toContain('TLS hostname mismatch rejected');
    expect(script).toContain('/app/infra/backup/retention.mjs');
    expect(script).toContain('Retention list failure rejected');
    expect(script).toContain('Retention delete failure rejected');
    expect(script).toMatch(/Remove-Item[^\n]*TlsDir/);
  });

  test('fails when encrypted-stage cleanup fails after a successful backup', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'floz-backup-')); const stage = join(dir, 'backup.dump.age');
    await expect(createBackup(options(stage, { publishMetadata: async () => {}, publishLastSuccess: async () => {}, removeStage: async () => { throw new Error('cleanup failed'); } }) as never)).rejects.toThrow('cleanup failed');
  });
});
