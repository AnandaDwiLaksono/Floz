const weekOf = (value) => {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
};

export async function applyRetention(archives, { replacement, listArchives, deleteArchive }) {
  if (!replacement?.successful || !replacement?.verified) return [];
  const durable = listArchives ? await listArchives() : archives;
  const retained = new Set(selectRetention([...durable, replacement]).map(({ id }) => id));
  const deleted = [];
  for (const { id } of durable) if (!retained.has(id)) { await deleteArchive(id); deleted.push(id); }
  return deleted;
}

export function selectRetention(archives) {
  const eligible = archives.filter((archive) => archive.successful && archive.verified).sort((a, b) => b.snapshotStartedAt.localeCompare(a.snapshotStartedAt));
  const days = new Set();
  const weeks = new Set();
  const selected = [];
  for (const archive of eligible) {
    const day = archive.snapshotStartedAt.slice(0, 10);
    const week = weekOf(archive.snapshotStartedAt);
    const classes = [];
    if (days.size < 7 && !days.has(day)) { days.add(day); classes.push('daily'); }
    if (weeks.size < 4 && !weeks.has(week)) { weeks.add(week); classes.push('weekly'); }
    if (classes.length) selected.push({ ...archive, week, classes });
  }
  return selected;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const { BACKUP_REMOTE: remote, BACKUP_ACCESS_KEY: key, BACKUP_SECRET_KEY: secret, RETENTION_REPLACEMENT: replacement, RETENTION_REPLACEMENT_BASE64: replacementBase64 } = process.env;
  const replacementJson = replacementBase64 ? Buffer.from(replacementBase64, 'base64').toString() : replacement;
  if (!remote || !replacementJson || !key || !secret) throw new Error('retention configuration missing');
  const env = { ...process.env, MC_HOST_fixture: `http://${key}:${secret}@minio:9000` };
  const prefix = `fixture/${remote.split('/')[1]}/postgres/fixture`;
  const list = async () => {
    const { stdout } = await run('mc', ['--json', 'ls', '--recursive', `${remote}/postgres/fixture/`], { env });
    const records = stdout.trim().split('\n').filter(Boolean).map(JSON.parse).filter(({ key: name }) => name.endsWith('.json') && !name.endsWith('last-success.json'));
    return Promise.all(records.map(async ({ key: name }) => JSON.parse((await run('mc', ['cat', `${prefix}/${name}`], { env })).stdout)));
  };
  const deleteArchive = (id) => run('mc', ['rm', `${prefix}/${id}.json`], { env }).then(() => run('mc', ['rm', `${prefix}/${id}.dump.age`], { env }));
  const deleted = await applyRetention(undefined, { replacement: JSON.parse(replacementJson), listArchives: list, deleteArchive });
  process.stdout.write(`${JSON.stringify(deleted)}\n`);
}
