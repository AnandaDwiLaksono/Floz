'use client';

import React from 'react';
import { WorkflowStatus } from '../lib/api-client';

function getCategoryLabel(category: string) {
  const cat = (category || '').toUpperCase();
  if (cat === 'TODO' || cat === 'OPEN') return 'Belum dimulai';
  if (cat === 'IN_PROGRESS' || cat === 'ACTIVE') return 'Sedang dikerjakan';
  if (cat === 'DONE') return 'Selesai';
  if (cat === 'CANCELLED') return 'Dibatalkan';
  return category;
}

function isInitialEligible(category: string) {
  const cat = (category || '').toUpperCase();
  return cat === 'TODO' || cat === 'OPEN' || cat === 'IN_PROGRESS' || cat === 'ACTIVE';
}

export default function WorkflowStatusCard({ status, index, count, locked, onMove, onEdit, onInitial, onArchive, onRestore, ...drag }: {
  status: WorkflowStatus;
  index: number;
  count: number;
  locked: boolean;
  onMove: (direction: -1 | 1) => void;
  onEdit: () => void;
  onInitial: () => void;
  onArchive: () => void;
  onRestore: () => void;
} & Pick<React.HTMLAttributes<HTMLDivElement>, 'onDragStart' | 'onDragOver' | 'onDrop' | 'onDragEnd'>) {
  const s = status;
  return (
    <div role="group" aria-label={s.name} data-status-id={s.id} draggable={s.is_active && !locked} {...drag} className="flex flex-wrap items-center gap-2 rounded bg-surface-subtle p-2 text-sm">
      <span className="font-medium">{s.name}</span>
      <span className="text-xs text-muted-foreground">{s.code}</span>
      <span className="text-xs text-muted-foreground">Posisi {s.position}</span>
      <span className="rounded bg-muted px-1.5">{getCategoryLabel(s.category)}</span>
      {s.is_initial && <span className="text-xs font-semibold text-primary">Awal</span>}
      {s.is_terminal && <span className="text-xs font-semibold text-info">Akhir</span>}
      {!s.is_active && <span className="text-xs text-muted-foreground">Diarsipkan</span>}
      <div className="ml-auto flex items-center gap-2">
        {s.is_active ? <>
          <button data-reorder="true" aria-label={`Reorder ${s.name}`} aria-disabled={locked} onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); if (!locked) onMove(e.key === 'ArrowUp' ? -1 : 1); }
          }}>⠿</button>
          <button data-reorder="true" aria-label={`Move ${s.name} up`} aria-disabled={locked || index === 0} onClick={() => { if (!locked && index > 0) onMove(-1); }}>↑</button>
          <button data-reorder="true" aria-label={`Move ${s.name} down`} aria-disabled={locked || index === count - 1} onClick={() => { if (!locked && index < count - 1) onMove(1); }}>↓</button>
          {!s.is_initial && !s.is_terminal && isInitialEligible(s.category) && <button disabled={locked} onClick={onInitial} aria-label="Set Initial">Jadikan awal</button>}
          <button disabled={locked} onClick={onEdit} aria-label="Edit">Ubah</button>
          <button disabled={locked || s.is_initial} aria-describedby={s.is_initial ? `archive-blocked-${s.id}` : undefined} onClick={onArchive} aria-label="Archive">Arsipkan</button>
          {s.is_initial && <span id={`archive-blocked-${s.id}`} className="text-xs text-muted-foreground">Status awal tidak dapat diarsipkan. Pilih status awal lain terlebih dahulu.</span>}
        </> : <button disabled={locked} onClick={onRestore} aria-label="Restore">Pulihkan</button>}
      </div>
    </div>
  );
}
