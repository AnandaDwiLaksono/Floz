'use client';

import React from 'react';
import { LogOut } from 'lucide-react';
import { BrandLogo } from './brand-logo';
import { ShellNavigation } from './shell-navigation';
import { WorkspaceSwitcher } from './workspace-switcher';
import type { WorkspaceMembershipInfo } from '../lib/api-client';

export function AppSidebar({ workspace, workspaces, setActiveWorkspace, pathname, name, email, logout }: { workspace: WorkspaceMembershipInfo | null; workspaces: WorkspaceMembershipInfo[]; setActiveWorkspace: (workspace: WorkspaceMembershipInfo) => void; pathname: string; name?: string | null; email?: string | null; logout: () => void }) {
  return <aside className="hidden h-full w-64 shrink-0 flex-col border-r border-border bg-surface lg:flex"><div className="flex h-16 items-center border-b border-border px-5"><BrandLogo /></div><div className="p-4">{workspace && <WorkspaceSwitcher workspace={workspace} workspaces={workspaces} setActiveWorkspace={setActiveWorkspace} />}</div><div className="flex-1 overflow-y-auto px-4">{workspace && <ShellNavigation workspaceId={workspace.id} role={workspace.role} pathname={pathname} />}</div><div className="flex items-center gap-3 border-t border-border p-4"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{name}</p><p className="truncate text-xs text-muted-foreground">{email}</p></div><button type="button" aria-label="Keluar" title="Keluar" onClick={logout} className="grid min-h-11 min-w-11 place-items-center rounded-md text-danger hover:bg-surface-subtle"><LogOut className="h-5 w-5" /></button></div></aside>;
}
