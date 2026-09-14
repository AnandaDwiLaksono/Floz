import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const run = (command, args, input) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const output = [];
  const errors = [];
  child.stdout.on('data', (chunk) => output.push(chunk));
  child.stderr.on('data', (chunk) => errors.push(chunk));
  child.on('error', reject);
  child.on('close', (code) => code === 0 ? resolve(Buffer.concat(output)) : reject(new Error(`${command} failed: ${Buffer.concat(errors)}`)));
  child.stdin.end(input);
});

export async function createBackup({ backupId, environment, recipient, stage, dump = () => run('pg_dump', ['--format=custom', `--dbname=${process.env.DATABASE_URL} sslmode=verify-full`]), encrypt = (input) => run('age', ['--recipient', recipient], input), upload = (path) => run('mc', ['cp', path, `${process.env.BACKUP_REMOTE}/postgres/${environment}/${backupId}.dump.age`]), download = () => run('mc', ['cat', `${process.env.BACKUP_REMOTE}/postgres/${environment}/${backupId}.dump.age`]), journal = () => ({}), publish = async () => undefined }) {
  if (!recipient || !/^[a-z0-9]+$/i.test(recipient)) throw new Error('invalid age recipient');
  await mkdir(dirname(stage), { recursive: true, mode: 0o700 });
  await chmod(dirname(stage), 0o700);
  try {
    const encrypted = await encrypt(await dump({ format: 'custom', sslmode: 'verify-full' }), recipient);
    await writeFile(stage, encrypted, { mode: 0o600 });
    const digest = sha256(encrypted);
    const metadata = { backupId, environment, snapshotStartedAt: new Date().toISOString(), completedAt: new Date().toISOString(), encryptedBytes: encrypted.length, sha256: digest, journal: await journal(), recipientId: recipient };
    await upload(stage, metadata);
    const remote = await download(backupId);
    if (sha256(remote) !== digest) throw new Error('encrypted backup hash mismatch');
    await publish(metadata);
    return metadata;
  } finally {
    await rm(stage, { force: true });
  }
}

export { sha256 };
