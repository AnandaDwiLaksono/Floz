import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { createBackup } from '../backup/backup.mjs';

test('publishes last success only after encrypted download hash verification', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'floz-backup-'));
  const stage = join(dir, 'backup.dump.age');
  const calls: string[] = [];
  const result = await createBackup({
    backupId: 'b1', environment: 'test', recipient: 'age1public', stage,
    dump: async () => Buffer.from('custom-dump'),
    encrypt: async (input: Buffer) => Buffer.concat([Buffer.from('age:'), input]),
    upload: async () => calls.push('upload'),
    download: async () => Buffer.from('age:custom-dump'),
    journal: async () => ({ version: '0001' }),
    publish: async () => { calls.push('publish'); },
  });
  expect(result.encryptedBytes).toBe(15);
  expect(result.journal).toEqual({ version: '0001' });
  expect(calls).toEqual(['upload', 'publish']);
  await expect(stat(stage)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('cleans encrypted staging and preserves last success on failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'floz-backup-'));
  const stage = join(dir, 'backup.dump.age');
  const published: string[] = [];
  await expect(createBackup({
    backupId: 'b1', environment: 'test', recipient: 'age1public', stage,
    dump: async () => Buffer.from('custom-dump'), encrypt: async () => Buffer.from('encrypted'),
    upload: async () => undefined, download: async () => Buffer.from('corrupt'),
    journal: async () => ({}), publish: async () => { published.push('published'); },
  })).rejects.toThrow('encrypted backup hash mismatch');
  expect(published).toEqual([]);
  await expect(stat(stage)).rejects.toMatchObject({ code: 'ENOENT' });
});
