'use client';

import React from 'react';
import { Bell, Menu } from 'lucide-react';
import { ThemeSwitcher } from './ui/theme-switcher';
import type { WorkspaceMembershipInfo } from '../lib/api-client';

export function AppHeader({ workspace, unreadCount, onMenu, onNotifications, notificationsOpen, notificationButtonRef, menuButtonRef }: { workspace: WorkspaceMembershipInfo | null; unreadCount: number; onMenu: () => void; onNotifications: () => void; notificationsOpen: boolean; notificationButtonRef: React.Ref<HTMLButtonElement>; menuButtonRef: React.Ref<HTMLButtonElement> }) {
  return <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-3 sm:h-16 sm:px-5"><div className="flex min-w-0 items-center gap-2 sm:gap-4"><button ref={menuButtonRef} type="button" aria-label="Buka navigasi" onClick={onMenu} className="grid min-h-11 min-w-11 place-items-center rounded-md hover:bg-surface-subtle lg:hidden"><Menu /></button><div className="min-w-0"><h1 className="truncate text-sm font-semibold sm:text-base">{workspace?.name ?? 'Ruang kerja Floz'}</h1>{workspace && <p className="truncate text-xs text-muted-foreground">Peran: {workspace.role}</p>}</div></div><div className="flex items-center gap-1 sm:gap-3"><ThemeSwitcher /><button type="button" ref={notificationButtonRef} aria-controls="notification-panel" aria-expanded={notificationsOpen} aria-label={`Notifikasi, ${unreadCount} belum dibaca`} onClick={onNotifications} className="relative grid min-h-11 min-w-11 place-items-center rounded-md hover:bg-surface-subtle"><Bell className="h-5 w-5" />{unreadCount > 0 && <span className="absolute right-1 top-1 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] text-primary-foreground">{unreadCount}</span>}</button></div></header>;
}
