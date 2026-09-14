import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, test } from 'vitest';
import { createBackup } from '../backup/backup.mjs';

const recipient = 'age1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const child = (output: string) => {
  const process = new EventEmitter() as EventEmitter & { stdout: PassThrough; stdin: PassThrough };
  process.stdout = new PassThrough();
  process.stdin = new PassThrough();
  queueMicrotask(() => { process.stdout.end(output); process.emit('close', 0); });
  return process;
};

const options = (stage: string, download: () => Promise<Buffer>) => ({ backupId: 'b1', environment: 'test', recipient, remote: 'fixture/backups', endpoint: 'http://minio:9000', accessKey: 'fixture-upload', secretKey: 'fixture-secret', stage, databaseUrl: 'postgres://fixture:fixture@db:5432/fixture', spawnChild: (command: string) => child(command === 'pg_dump' ? 'dump' : ''), upload: async () => {}, download, journal: async () => ({ migration: '0001' }) });

describe('backup pipeline', () => {
  test('streams pg_dump stdout into age and removes encrypted stage after verified download', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'floz-backup-'));
    const stage = join(dir, 'backup.dump.age');
    const published: unknown[] = [];
    const result = await createBackup({ ...options(stage, async () => readFile(stage)), publishMetadata: async (value: unknown) => { published.push(value); }, publishLastSuccess: async (value: unknown) => { published.push(value); } } as never);
    expect(result.encryptedSha256).toHaveLength(64);
    expect(result).not.toHaveProperty('databaseUrl');
    expect(result).not.toHaveProperty('accessKey');
    expect(result).not.toHaveProperty('secretKey');
    expect(result.journal).toEqual({ migration: '0001' });
    expect(published).toHaveLength(2);
    await expect(stat(stage)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('preserves last success and removes encrypted stage after remote corruption', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'floz-backup-'));
    const stage = join(dir, 'backup.dump.age');
    const published: unknown[] = [];
    await expect(createBackup({ ...options(stage, async () => Buffer.from('corrupt')), publishLastSuccess: async (value: unknown) => { published.push(value); } } as never)).rejects.toThrow('hash mismatch');
    expect(published).toEqual([]);
    await expect(stat(stage)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('rejects unsafe endpoints and production-looking credentials before spawning', async () => {
    await expect(createBackup({ environment: 'test', recipient, remote: 'fixture/backups', endpoint: 'https://r2.example', accessKey: 'production-key', secretKey: 'secret' } as never)).rejects.toThrow('unsafe backup target');
  });
});
