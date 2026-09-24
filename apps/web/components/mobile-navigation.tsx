'use client';

import React, { useEffect, useRef } from 'react';
import { LogOut, X } from 'lucide-react';
import { BrandLogo } from './brand-logo';
import { ShellNavigation } from './shell-navigation';
import { WorkspaceSwitcher } from './workspace-switcher';
import type { WorkspaceMembershipInfo } from '../lib/api-client';

export function MobileNavigation({ open, onClose, workspace, workspaces, setActiveWorkspace, pathname, logout }: { open: boolean; onClose: () => void; workspace: WorkspaceMembershipInfo | null; workspaces: WorkspaceMembershipInfo[]; setActiveWorkspace: (workspace: WorkspaceMembershipInfo) => void; pathname: string; logout: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]') ?? []);
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index === 0) { event.preventDefault(); items.at(-1)?.focus(); }
      if (!event.shiftKey && index === items.length - 1) { event.preventDefault(); items[0]?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [open, onClose]);
  if (!open) return null;
  return <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigasi"><div aria-hidden="true" className="absolute inset-0 bg-overlay" onMouseDown={onClose} /><div ref={dialogRef} className="relative flex h-full w-[min(22rem,85vw)] flex-col gap-4 bg-surface p-4"><div className="flex min-h-11 items-center justify-between"><BrandLogo /><button ref={closeRef} type="button" aria-label="Tutup navigasi" onClick={onClose} className="grid min-h-11 min-w-11 place-items-center rounded-md hover:bg-surface-subtle"><X /></button></div>{workspace && <WorkspaceSwitcher workspace={workspace} workspaces={workspaces} setActiveWorkspace={(entry) => { setActiveWorkspace(entry); onClose(); }} />}{workspace && <ShellNavigation workspaceId={workspace.id} role={workspace.role} pathname={pathname} onNavigate={onClose} />}<button type="button" aria-label="Keluar" onClick={logout} className="mt-auto flex min-h-11 items-center gap-3 rounded-md px-3 text-left text-danger hover:bg-surface-subtle"><LogOut className="h-5 w-5" />Keluar</button></div></div>;
}
