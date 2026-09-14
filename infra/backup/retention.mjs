const weekOf = (value) => {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
};

export async function applyRetention(archives, { replacement, deleteArchive }) {
  if (!replacement?.successful || !replacement?.verified) return [];
  const retained = new Set(selectRetention([...archives, replacement]).map(({ id }) => id));
  const deleted = [];
  for (const { id } of archives) if (!retained.has(id)) { await deleteArchive(id); deleted.push(id); }
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
