'use client';

import React from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { Calendar, CheckSquare, ClipboardCheck, KanbanSquare, LayoutDashboard, Settings, UserRoundCheck, Briefcase } from 'lucide-react';

type Role = 'MEMBER' | 'MANAGER' | 'ADMIN' | 'FIELD_WORKER';
type Permission = 'ALL' | 'MANAGER';
type Group = 'utama';

export interface NavigationItem {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly segment: string;
  readonly permission: Permission;
  readonly group: Group;
  readonly activeMatcher: (pathname: string, workspaceId: string) => boolean;
}

const matchesSegment = (pathname: string, workspaceId: string, segment: string) => {
  const route = `/workspaces/${encodeURIComponent(workspaceId)}/${segment}`;
  return pathname === route || pathname.startsWith(`${route}/`);
};

const item = (label: string, icon: LucideIcon, segment: string, permission: Permission = 'ALL'): NavigationItem => Object.freeze({
  label,
  icon,
  segment,
  permission,
  group: 'utama',
  activeMatcher: (pathname: string, workspaceId: string) => matchesSegment(pathname, workspaceId, segment),
});

const items = Object.freeze([
  item('Ringkasan', LayoutDashboard, 'dashboard'),
  item('Pekerjaan Saya', Briefcase, 'my-work'),
  item('Dasbor Manajer', UserRoundCheck, 'manager-dashboard', 'MANAGER'),
  item('Tugas', CheckSquare, 'tasks'),
  item('Persetujuan', ClipboardCheck, 'approvals'),
  item('Kanban', KanbanSquare, 'kanban'),
  item('Kalender', Calendar, 'calendar'),
  item('Pengaturan', Settings, 'settings'),
]);

export const visibleNavigationItems = (role: Role) => items.filter(({ permission }) => permission === 'ALL' || role === 'MANAGER' || role === 'ADMIN');
export const navigationGroups = Object.freeze([{ id: 'utama' as const, label: 'Navigasi', items }]);
export const isNavigationItemActive = (pathname: string, workspaceId: string, navigationItem: NavigationItem) => navigationItem.activeMatcher(pathname, workspaceId);

export function ShellNavigation({ workspaceId, role, pathname, onNavigate }: { workspaceId: string; role: Role; pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Navigasi ruang kerja" className="space-y-1">
      {visibleNavigationItems(role).map((navigationItem) => {
        const Icon = navigationItem.icon;
        const active = isNavigationItemActive(pathname, workspaceId, navigationItem);
        return <Link key={navigationItem.segment} href={`/workspaces/${workspaceId}/${navigationItem.segment}`} onClick={onNavigate} aria-current={active ? 'page' : undefined} className={`flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium ${active ? 'bg-surface-subtle text-primary' : 'text-muted-foreground hover:bg-surface-subtle hover:text-foreground'}`}><Icon className="h-5 w-5 shrink-0" strokeWidth={1.75} /><span className="truncate">{navigationItem.label}</span></Link>;
      })}
    </nav>
  );
}
