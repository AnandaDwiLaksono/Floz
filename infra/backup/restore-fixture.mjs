import { createHash } from 'node:crypto';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';

const hashFile = async (path) => {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
};

const identity = (url) => {
  const value = new URL(url);
  return `${value.hostname.toLowerCase()}:${value.port || '5432'}/${value.pathname.slice(1)}`;
};

const tlsUrl = (url) => {
  const value = new URL(url);
  if (value.searchParams.get('sslmode') !== 'verify-full' || !value.searchParams.get('sslrootcert')) throw new Error('restore TLS must use verify-full with a CA');
  return value.toString();
};

const realRun = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: 'ignore' });
  child.once('error', reject).once('close', (code) => code === 0 ? resolve() : reject(new Error(`${command} failed`)));
});
const capture = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
  child.once('error', reject).once('close', (code) => code === 0 ? resolve(output.trim()) : reject(new Error(`${command} failed`)));
});

const mcSession = async ({ endpoint, accessKey, secretKey }) => {
  if (endpoint !== 'http://minio:9000' || !/^fixture-restore/.test(accessKey || '') || /backup|retention|admin|production|r2/i.test(accessKey + secretKey)) throw new Error('unsafe restore endpoint or credentials');
  const configDir = await mkdtemp(join(tmpdir(), 'floz-restore-mc-'));
  await chmod(configDir, 0o700);
  try {
    await realRun('mc', ['--config-dir', configDir, 'alias', 'set', 'fixture', endpoint, accessKey, secretKey, '--api', 'S3v4', '--path', 'on']);
    return { configDir, close: () => rm(configDir, { recursive: true, force: true }) };
  } catch (error) {
    await rm(configDir, { recursive: true, force: true });
    throw error;
  }
};

export async function restoreFixture({ backupId, remote, endpoint, accessKey, secretKey, encryptedSha256, snapshotStartedAt, source, target, identity: ageIdentity, download, run = realRun, integrity, sourceFingerprint, targetIsolated, remove = rm, now = () => Date.now() }) {
  const startedAt = now();
  if (!backupId || !/^fixture\/[a-z0-9][a-z0-9._-]*$/i.test(remote || '') || endpoint !== 'http://minio:9000' || !/^fixture-restore/.test(accessKey || '') || /backup|retention|admin|production|r2/i.test(accessKey + secretKey)) throw new Error('unsafe restore endpoint or credentials');
  if (!ageIdentity) throw new Error('missing age identity');
  const snapshotTime = new Date(snapshotStartedAt).getTime();
  if (!Number.isFinite(snapshotTime) || snapshotTime > startedAt) throw new Error('invalid snapshot start');
  if (identity(source) === identity(target)) throw new Error('source and target database identity match');
  tlsUrl(source); tlsUrl(target);
  if (!await targetIsolated()) throw new Error('unsafe restore target');
  const before = await sourceFingerprint();
  const directory = await mkdtemp(join(tmpdir(), 'floz-restore-'));
  const encrypted = join(directory, `${backupId}.dump.age`);
  const archive = join(directory, `${backupId}.dump`);
  let failure;
  try {
    await chmod(directory, 0o700);
    await download(encrypted, { endpoint, accessKey, secretKey, object: `${remote}/postgres/fixture/${backupId}.dump.age` });
    if (await hashFile(encrypted) !== encryptedSha256) throw new Error('encrypted backup hash mismatch');
    await run('age', ['--decrypt', '--identity', ageIdentity, '--output', archive, encrypted]);
    await chmod(archive, 0o600);
    await run('pg_restore', ['--exit-on-error', '--no-owner', '--no-privileges', `--dbname=${tlsUrl(target)}`, archive]);
    const checks = await integrity();
    if (!checks.journal || !checks.relations || !checks.constraints || !checks.auth || !checks.workspaceIsolation || !checks.tasks || !checks.outbox || !checks.notificationDedup) throw new Error('integrity mismatch');
    if (await sourceFingerprint() !== before) throw new Error('source changed during restore');
    const completedAt = now();
    const ageMs = completedAt - snapshotTime;
    return { success: true, elapsedMs: completedAt - startedAt, snapshotAgeMs: ageMs, rpoWithin24Hours: ageMs <= 24 * 60 * 60 * 1000 };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      await remove(directory, { recursive: true, force: true });
    } catch (cleanup) {
      if (!failure) throw cleanup;
    }
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const backupId = process.env.RESTORE_BACKUP_ID;
  const remote = process.env.BACKUP_REMOTE;
  const endpoint = process.env.BACKUP_ENDPOINT;
  const accessKey = process.env.RESTORE_ACCESS_KEY;
  const secretKey = process.env.RESTORE_SECRET_KEY;
  const source = process.env.DATABASE_URL;
  const target = process.env.RESTORE_DATABASE_URL;
  const ageIdentity = process.env.RESTORE_AGE_IDENTITY;
  const encryptedSha256 = process.env.RESTORE_ENCRYPTED_SHA256;
  const snapshotStartedAt = process.env.RESTORE_SNAPSHOT_STARTED_AT;
  if (!backupId || !remote || !endpoint || !accessKey || !secretKey || !source || !target || !ageIdentity || !encryptedSha256 || !snapshotStartedAt) throw new Error('missing restore fixture environment');
  const session = await mcSession({ endpoint, accessKey, secretKey });
  try {
    const result = await restoreFixture({
      backupId, remote, endpoint, accessKey, secretKey, encryptedSha256, snapshotStartedAt, source, target, identity: ageIdentity,
      download: (path, { object }) => realRun('mc', ['--config-dir', session.configDir, 'cp', object, path]),
      sourceFingerprint: () => capture('psql', [source, '--tuples-only', '--no-align', '--command', "select md5(string_agg(t::text,'|' order by t::text)) from (select table_name,(xpath('/row/count/text()',query_to_xml(format('select count(*) as count from %I',table_name),false,true,'')))[1]::text from information_schema.tables where table_schema='public') t"]),
      targetIsolated: async () => identity(source) !== identity(target),
      integrity: async () => {
        const value = await capture('psql', [target, '--tuples-only', '--no-align', '--command', "select json_build_object('journal',(select count(*)>0 from __drizzle_migrations),'relations',(select count(*)=0 from tasks t left join workspaces w on w.id=t.workspace_id where w.id is null),'constraints',(select count(*)>0 from pg_constraint where contype='f'),'auth',(select count(*)>0 from users) and (select count(*)>0 from accounts) and (select count(*)>0 from sessions),'workspaceIsolation',(select count(distinct workspace_id)=2 from tasks),'tasks',(select count(*)>=2 from tasks),'outbox',(select count(*)>0 from outbox_events),'notificationDedup',(select count(*)>0 from notification_dedup_ledger))"]);
        return JSON.parse(value);
      },
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await session.close();
  }
}
