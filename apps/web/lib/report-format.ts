export function formatRatio(value: string | null | undefined) {
  return value == null || !Number.isFinite(Number(value)) ? '—' : `${Number((Number(value) * 100).toFixed(2))}%`;
}

export function formatDuration(value: string | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const totalMinutes = Math.max(0, Math.round(Number(value) / 60));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor(totalMinutes % 1440 / 60);
  const minutes = totalMinutes % 60;
  return [days && `${days} hari`, hours && `${hours} jam`, (!days && !hours || minutes) && `${minutes} menit`].filter(Boolean).join(' ');
}
