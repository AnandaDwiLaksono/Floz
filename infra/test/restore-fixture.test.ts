import { createHash } from 'node:crypto';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { restoreFixture } from '../backup/restore-fixture.mjs';

const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const encrypted = Buffer.from('encrypted-fixture');
const source = 'postgres://source:pw@phase12-backup-postgres:5432/fixture?sslmode=verify-full&sslrootcert=/tls/ca.crt';
const target = 'postgres://restore:pw@phase12-backup-postgres:5432/fixture_restore?sslmode=verify-full&sslrootcert=/tls/ca.crt';

const options = async (overrides = {}) => {
  const dir = await mkdtemp(join(tmpdir(), 'floz-restore-'));
  const identity = join(dir, 'identity.txt');
  await writeFile(identity, 'AGE-SECRET-KEY-TEST', { mode: 0o600 });
  const calls: string[] = [];
  const clock = Date.now();
  const base = {
    backupId: 'b1', remote: 'fixture/backups', endpoint: 'http://minio:9000', accessKey: 'fixture-restore', secretKey: 'fixture-restore-secret', encryptedSha256: sha256(encrypted), snapshotStartedAt: new Date(clock - 24 * 60 * 60 * 1000).toISOString(), source, target, identity, download: async (path: string) => writeFile(path, encrypted), run: async (command: string, args: string[]) => { calls.push(`${command} ${args.join(' ')}`); if (command === 'age') await writeFile(args[args.indexOf('--output') + 1], Buffer.from('decrypted')); }, integrity: async () => ({ journal: true, relations: true, constraints: true, auth: true, workspaceIsolation: true, tasks: true, outbox: true, notificationDedup: true }), sourceFingerprint: async () => 'source-unchanged', targetIsolated: async () => true, now: () => clock, calls, dir
  };
  const merged = { ...base, ...overrides };
  if ('run' in overrides) {
    const injected = overrides.run as (command: string, args: string[]) => Promise<void>;
    merged.run = async (command: string, args: string[]) => { await base.run(command, args); await injected(command, args); };
  }
  return merged;
};

describe('isolated encrypted restore fixture', () => {
  test('downloads with restore-only credentials, verifies ciphertext before age decrypt, restores isolated TLS target, then cleans plaintext', async () => {
    const testClock = Date.now();
    const fixture = await options({ snapshotStartedAt: new Date(testClock - 24 * 60 * 60 * 1000 + 250).toISOString(), now: (() => { let calls = 0; return () => testClock + (calls++ ? 250 : 0); })() });
    const result = await restoreFixture(fixture as never);
    expect(result.success).toBe(true); expect(result.rpoWithin24Hours).toBe(true); expect(result.elapsedMs).toBe(250);
    expect(fixture.calls).toEqual([expect.stringMatching(/^age --decrypt --identity /), expect.stringMatching(/^pg_restore --exit-on-error --no-owner --no-privileges --dbname=postgres:\/\/restore:/)]);
    expect(fixture.calls).toHaveLength(2);
  });

  test.each([
    ['download failure', { download: async () => { throw new Error('download failed'); } }, 'download failed'],
    ['ciphertext hash mismatch', { encryptedSha256: sha256(Buffer.from('other')) }, 'encrypted backup hash mismatch'],
    ['missing identity', { identity: '' }, 'missing age identity'],
    ['wrong identity', { run: async (command: string) => { if (command === 'age') throw new Error('age failed'); } }, 'age failed'],
    ['decrypt failure', { run: async (command: string) => { if (command === 'age') throw new Error('decrypt failed'); } }, 'decrypt failed'],
    ['truncated archive', { run: async (command: string) => { if (command === 'pg_restore') throw new Error('pg_restore failed'); } }, 'pg_restore failed'],
    ['restore failure', { run: async (command: string) => { if (command === 'pg_restore') throw new Error('restore failed'); } }, 'restore failed'],
    ['integrity mismatch', { integrity: async () => ({ journal: false }) }, 'integrity mismatch'],
    ['non-isolated target', { targetIsolated: async () => false }, 'unsafe restore target'],
    ['cleanup failure', { remove: async () => { throw new Error('cleanup failed'); } }, 'cleanup failed'],
  ])('fails %s without reporting success or modifying source', async (_name, overrides, message) => {
    const fixture = await options(overrides);
    await expect(restoreFixture(fixture as never)).rejects.toThrow(message);
    expect(await fixture.sourceFingerprint()).toBe('source-unchanged');
  });

  test('refuses equal source and target host/database before download', async () => {
    const fixture = await options({ target: source });
    await expect(restoreFixture(fixture as never)).rejects.toThrow('source and target database identity match');
    expect(fixture.calls).toEqual([]);
  });

  test('fails when the source changes during restore', async () => {
    let reads = 0;
    const fixture = await options({ sourceFingerprint: async () => reads++ ? 'changed' : 'original' });
    await expect(restoreFixture(fixture as never)).rejects.toThrow('source changed during restore');
  });

  test('rejects invalid or future snapshot timestamps before download', async () => {
    for (const snapshotStartedAt of ['invalid', new Date(Date.now() + 1).toISOString()]) {
      const fixture = await options({ snapshotStartedAt, now: () => Date.now() });
      await expect(restoreFixture(fixture as never)).rejects.toThrow('invalid snapshot start');
      expect(fixture.calls).toEqual([]);
    }
  });

  test('restricts the decrypted archive and removes it after verification', async () => {
    let archive = '';
    const fixture = await options({ run: async (command: string, args: string[]) => { if (command === 'age') archive = args[args.indexOf('--output') + 1]; } });
    await restoreFixture(fixture as never);
    await expect(stat(archive)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test.each([
    ['exactly 24 hours', 24 * 60 * 60 * 1000, true],
    ['older than 24 hours', 24 * 60 * 60 * 1000 + 1, false],
  ])('measures RPO from snapshot start at %s', async (_name, age, expected) => {
    const clock = Date.now();
    const fixture = await options({ snapshotStartedAt: new Date(clock - age).toISOString(), now: () => clock });
    const result = await restoreFixture(fixture as never);
    expect(result.rpoWithin24Hours).toBe(expected);
  });
});
