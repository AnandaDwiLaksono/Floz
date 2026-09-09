'use client';

import React, { useState } from 'react';
import { WorkflowStatus } from '../lib/api-client';

export default function WorkflowTransitionMobileList({ statuses, isEdge, onToggle }: { statuses: WorkflowStatus[]; isEdge: (from: string, to: string) => boolean; onToggle: (from: string, to: string) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return <div className="space-y-1">{statuses.map(from => <section key={from.id} className="rounded border"><button className="w-full p-3 text-left" aria-expanded={expanded === from.id} aria-controls={`transitions-${from.id}`} onClick={() => setExpanded(expanded === from.id ? null : from.id)}>{from.name}{!from.is_active && ' (Archived)'}</button>{expanded === from.id && <div id={`transitions-${from.id}`} className="p-3">{statuses.map(to => {
    const self = from.id === to.id, dormant = !to.is_active, checked = isEdge(from.id, to.id);
    if (self) return <div key={to.id} aria-label={`Transition from ${from.name} to ${to.name}: self-loop not allowed`}>Self-loop to {to.name} is not allowed.</div>;
    return <label key={to.id} className="flex gap-2"><input type="checkbox" checked={checked} disabled={dormant} onChange={() => onToggle(from.id, to.id)} aria-label={`Transition from ${from.name} to ${to.name}${dormant ? ', inactive target' : ''}`} />{to.name}{dormant && ' (Archived target; stored transition cannot be changed)'}</label>;
  })}</div>}</section>)}</div>;
}
