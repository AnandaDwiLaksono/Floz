import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';

const validRecipient = (value) => /^age1[ac-hj-np-z02-9]{58}$/.test(value);
const safeName = (value) => /^[a-z0-9][a-z0-9._-]*$/i.test(value);
const wait = (child, name) => new Promise((resolve, reject) => child.once('error', reject).once('close', (code) => code === 0 ? resolve() : reject(new Error(`${name} failed`))));
const hashFile = async (path) => {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
};
const databaseUrl = (value) => {
  const url = new URL(value);
  if (!url.searchParams.has('sslmode')) url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
};
const run = (command, args) => wait(spawn(command, args, { stdio: 'ignore' }), command);

export async function mcConfig({ mc = 'mc', endpoint, accessKey, secretKey }) {
  if (endpoint !== 'http://minio:9000' || !accessKey || !secretKey || /r2|production/i.test(accessKey + secretKey)) throw new Error('unsafe backup endpoint or credentials');
  const configDir = await mkdtemp(join(tmpdir(), 'floz-mc-'));
  await chmod(configDir, 0o700);
  try {
    await run(mc, ['--config-dir', configDir, 'alias', 'set', 'fixture', endpoint, accessKey, secretKey, '--api', 'S3v4', '--path', 'on']);
    return { configDir, close: () => rm(configDir, { recursive: true, force: true }) };
  } catch (error) {
    await rm(configDir, { recursive: true, force: true });
    throw error;
  }
}

export async function createBackup({ backupId = randomUUID(), environment, recipient, stage, databaseUrl: source = process.env.DATABASE_URL, spawnChild = spawn, upload, download, journal = async () => ({}), publishMetadata, publishLastSuccess, retain, removeStage = rm, tools = {}, remote = process.env.BACKUP_REMOTE, endpoint = process.env.BACKUP_ENDPOINT, accessKey = process.env.BACKUP_ACCESS_KEY, secretKey = process.env.BACKUP_SECRET_KEY }) {
  if (!validRecipient(recipient)) throw new Error('invalid age recipient');
  if (!source || !safeName(environment) || !safeName(backupId) || !remote || !/^fixture\/[a-z0-9][a-z0-9._-]*$/i.test(remote) || endpoint !== 'http://minio:9000') throw new Error('unsafe backup target');
  const snapshotStartedAt = new Date().toISOString();
  const session = upload && download ? undefined : await mcConfig({ mc: tools.mc, endpoint, accessKey, secretKey });
  const object = `${remote}/postgres/${environment}/${backupId}.dump.age`;
  const workDir = stage ? undefined : await mkdtemp(join(tmpdir(), 'floz-backup-'));
  const stagePath = stage ?? join(workDir, `${backupId}.dump.age`);
  const verifyPath = join(session?.configDir ?? dirname(stagePath), `${backupId}.verify.dump.age`);
  await chmod(dirname(stagePath), 0o700);
  upload ??= (path) => run(tools.mc ?? 'mc', ['--config-dir', session.configDir, 'cp', path, object]);
  publishMetadata ??= async (metadata) => {
    const path = join(session.configDir, `${backupId}.metadata.json`);
    await writeFile(path, JSON.stringify(metadata), { mode: 0o600 });
    await run(tools.mc ?? 'mc', ['--config-dir', session.configDir, 'cp', path, `${remote}/postgres/${environment}/${backupId}.json`]);
  };
  publishLastSuccess ??= async (value) => {
    const path = join(session.configDir, 'last-success.json');
    await writeFile(path, JSON.stringify(value), { mode: 0o600 });
    await run(tools.mc ?? 'mc', ['--config-dir', session.configDir, 'cp', path, `${remote}/postgres/${environment}/last-success.json`]);
  };
  download ??= async () => {
    await run(tools.mc ?? 'mc', ['--config-dir', session.configDir, 'cp', object, verifyPath]);
    return verifyPath;
  };
  try {
    const output = await open(stagePath, 'wx', 0o600);
    const dump = spawnChild(tools.pgDump ?? 'pg_dump', ['--format=custom', `--dbname=${databaseUrl(source)}`], { stdio: ['ignore', 'pipe', 'ignore'] });
    const age = process.env.BACKUP_FAIL_AGE === '1'
      ? spawnChild('sh', ['-c', 'exit 42'], { stdio: ['pipe', output.createWriteStream(), 'ignore'] })
      : spawnChild(tools.age ?? 'age', ['--recipient', recipient], { stdio: ['pipe', output.createWriteStream(), 'ignore'] });
    await Promise.all([pipeline(dump.stdout, age.stdin), wait(dump, 'pg_dump'), wait(age, 'age')]);
    const encryptedSha256 = await hashFile(stagePath);
    const encryptedBytes = (await open(stagePath)).stat().then(({ size }) => size);
    const metadata = { backupId, environment, successful: true, verified: true, snapshotStartedAt, completedAt: new Date().toISOString(), encryptedBytes: await encryptedBytes, encryptedSha256, dumpVersion: tools.pgDumpVersion ?? 'pg_dump', serverVersion: tools.serverVersion ?? 'unknown', ageVersion: tools.ageVersion ?? 'age', mcVersion: tools.mcVersion ?? 'mc', journal: await journal(), recipientId: recipient };
    await upload(stagePath);
    const downloaded = await download(backupId);
    const remoteSha256 = Buffer.isBuffer(downloaded) ? createHash('sha256').update(downloaded).digest('hex') : await hashFile(downloaded);
    if (remoteSha256 !== encryptedSha256) throw new Error('encrypted backup hash mismatch');
    await publishMetadata(metadata);
    await publishLastSuccess({ backupId, environment, snapshotStartedAt, completedAt: metadata.completedAt, encryptedSha256, verified: true });
    if (retain) await retain(metadata);
    return metadata;
  } finally {
    await removeStage(stagePath, { force: true });
    await rm(verifyPath, { force: true });
    await session?.close();
    if (workDir) await rm(workDir, { recursive: true, force: true });
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const metadata = await createBackup({
    environment: process.env.BACKUP_ENVIRONMENT ?? 'fixture',
    recipient: process.env.BACKUP_RECIPIENT,
  });
  process.stdout.write(`${JSON.stringify(metadata)}\n`);
}
