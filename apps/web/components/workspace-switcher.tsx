'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { Building2, ChevronDown } from 'lucide-react';
import type { WorkspaceMembershipInfo } from '../lib/api-client';

export function WorkspaceSwitcher({ workspace, workspaces, setActiveWorkspace }: { workspace: WorkspaceMembershipInfo; workspaces: WorkspaceMembershipInfo[]; setActiveWorkspace: (workspace: WorkspaceMembershipInfo) => void }) {
  const [open, setOpen] = useState(false);
  const menuId = `workspace-menu-${useId().replace(/:/g, '')}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const items = Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    items[0]?.focus();
    const close = (returnFocus = false) => { setOpen(false); if (returnFocus) triggerRef.current?.focus(); };
    const keydown = (event: KeyboardEvent) => {
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (event.key === 'ArrowDown') { event.preventDefault(); items[(index + 1 + items.length) % items.length]?.focus(); }
      if (event.key === 'ArrowUp') { event.preventDefault(); items[(index - 1 + items.length) % items.length]?.focus(); }
      if (event.key === 'Home') { event.preventDefault(); items[0]?.focus(); }
      if (event.key === 'End') { event.preventDefault(); items.at(-1)?.focus(); }
      if (event.key === 'Escape') { event.preventDefault(); close(true); }
    };
    const pointer = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) close(); };
    document.addEventListener('mousedown', pointer);
    menu?.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('mousedown', pointer); menu?.removeEventListener('keydown', keydown); };
  }, [open]);

  return <div ref={rootRef} className="relative min-w-0">
    <button ref={triggerRef} type="button" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((value) => !value)} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }} className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md border border-border bg-surface-subtle px-3 text-left text-sm">
      <Building2 className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} /><span className="min-w-0 flex-1 truncate">{workspace.name}</span><ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
    {open && <div ref={menuRef} id={menuId} role="menu" className="absolute left-0 top-full z-30 mt-2 w-full min-w-56 overflow-hidden rounded-md border border-border bg-surface-raised shadow-lg">
      {workspaces.map((entry) => <button key={entry.id} type="button" role="menuitem" onClick={() => { setActiveWorkspace(entry); setOpen(false); triggerRef.current?.focus(); }} className="flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left text-sm hover:bg-surface-subtle"><span className="truncate">{entry.name}</span><span className="shrink-0 text-xs text-muted-foreground">{entry.role}</span></button>)}
      <Link href="/onboarding/create-workspace" role="menuitem" className="flex min-h-11 items-center border-t border-border px-3 text-sm text-primary">Buat ruang kerja</Link>
      <Link href="/join" role="menuitem" className="flex min-h-11 items-center px-3 text-sm">Gabung ruang kerja</Link>
    </div>}
  </div>;
}
