// Centralized presentation-layer localization helpers.
// API/backend enum values are NOT changed; only display labels are mapped here.

const STATUS_LABEL_MAP: Record<string, string> = {
  'To do': 'Belum dimulai',
  'To Do': 'Belum dimulai',
  'TODO': 'Belum dimulai',
  'Open': 'Belum dimulai',
  'OPEN': 'Belum dimulai',
  'UNSTARTED': 'Belum dimulai',
  'In progress': 'Sedang dikerjakan',
  'In Progress': 'Sedang dikerjakan',
  'IN_PROGRESS': 'Sedang dikerjakan',
  'DOING': 'Sedang dikerjakan',
  'Done': 'Selesai',
  'DONE': 'Selesai',
  'COMPLETED': 'Selesai',
  'Cancelled': 'Dibatalkan',
  'CANCELLED': 'Dibatalkan',
};

// ponytail: static map; add new entries when new canonical status names/codes are added
export function formatStatusName(name?: string | null): string {
  if (!name) return '';
  return STATUS_LABEL_MAP[name] ?? STATUS_LABEL_MAP[name.trim()] ?? name;
}

/** "Mulai dikerjakan" for In Progress, "Ke {label}" otherwise */
export function formatTransitionLabel(name?: string | null): string {
  const label = formatStatusName(name);
  if (label === 'Sedang dikerjakan') return 'Mulai dikerjakan';
  return `Ke ${label}`;
}

/** '2026-09-25' → '25 Sep 2026' */
export function formatDateDisplay(dateStr?: string | null): string {
  if (!dateStr) return '';
  const d = new Date(/\d{2}:\d{2}/.test(dateStr) ? dateStr.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00') : `${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

/** ISO datetime string → '18 Agu 2026, 17.00' (no seconds) */
export function formatDateTimeDisplay(dateStr?: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
}
