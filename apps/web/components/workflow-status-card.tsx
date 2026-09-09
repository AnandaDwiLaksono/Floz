'use client';

import React from 'react';
import { WorkflowStatus } from '../lib/api-client';

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
    <div role="group" aria-label={s.name} data-status-id={s.id} draggable={s.is_active && !locked} {...drag} className="flex flex-wrap items-center gap-2 rounded bg-gray-50 p-2 text-sm dark:bg-gray-800">
      <span className="font-medium">{s.name}</span>
      <span className="text-xs text-gray-500">{s.code}</span>
      <span>Position {s.position}</span>
      <span className="rounded bg-gray-200 px-1.5 dark:bg-gray-700">{s.category}</span>
      {s.is_initial && <span>Initial</span>}
      {s.is_terminal && <span>Terminal</span>}
      {!s.is_active && <span>Archived</span>}
      <div className="ml-auto flex items-center gap-2">
        {s.is_active ? <>
          <button data-reorder="true" aria-label={`Reorder ${s.name}`} aria-disabled={locked} onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); if (!locked) onMove(e.key === 'ArrowUp' ? -1 : 1); }
          }}>⠿</button>
          <button data-reorder="true" aria-label={`Move ${s.name} up`} aria-disabled={locked || index === 0} onClick={() => { if (!locked && index > 0) onMove(-1); }}>↑</button>
          <button data-reorder="true" aria-label={`Move ${s.name} down`} aria-disabled={locked || index === count - 1} onClick={() => { if (!locked && index < count - 1) onMove(1); }}>↓</button>
          {!s.is_initial && !s.is_terminal && (s.category === 'TODO' || s.category === 'IN_PROGRESS') && <button disabled={locked} onClick={onInitial}>Set Initial</button>}
          <button disabled={locked} onClick={onEdit}>Edit</button>
          <button disabled={locked || s.is_initial} aria-describedby={s.is_initial ? `archive-blocked-${s.id}` : undefined} onClick={onArchive}>Archive</button>
          {s.is_initial && <span id={`archive-blocked-${s.id}`} className="text-xs text-gray-500">Cannot archive the initial status. Choose another initial status first.</span>}
        </> : <button disabled={locked} onClick={onRestore}>Restore</button>}
      </div>
    </div>
  );
}
