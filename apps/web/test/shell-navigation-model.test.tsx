import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  isNavigationItemActive,
  navigationGroups,
  ShellNavigation,
  visibleNavigationItems,
} from '../components/shell-navigation';

const expected = [
  ['Ringkasan', '/workspaces/ws-1/dashboard'],
  ['Pekerjaan Saya', '/workspaces/ws-1/my-work'],
  ['Dasbor Manajer', '/workspaces/ws-1/manager-dashboard'],
  ['Tugas', '/workspaces/ws-1/tasks'],
  ['Persetujuan', '/workspaces/ws-1/approvals'],
  ['Kanban', '/workspaces/ws-1/kanban'],
  ['Kalender', '/workspaces/ws-1/calendar'],
  ['Pengaturan', '/workspaces/ws-1/settings'],
] as const;

describe('canonical shell navigation model', () => {
  it('provides every Indonesian workspace route once from one model', () => {
    const managerItems = visibleNavigationItems('MANAGER');
    expect(managerItems.map((item) => item.label)).toEqual(expected.map(([label]) => label));
    expect(managerItems.filter((item) => item.label === 'Pengaturan')).toHaveLength(1);
    expect(managerItems.some((item) => item.label === 'Kanban')).toBe(true);
    expect(navigationGroups.flatMap((group) => group.items)).toEqual(managerItems);

    render(<ShellNavigation workspaceId="ws-1" role="MANAGER" pathname="/workspaces/ws-1/tasks" />);
    expected.forEach(([label, href]) => expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href));
  });

  it('shows manager navigation to MANAGER and ADMIN only', () => {
    expect(visibleNavigationItems('MEMBER').map((item) => item.label)).not.toContain('Dasbor Manajer');
    expect(visibleNavigationItems('MANAGER').map((item) => item.label)).toContain('Dasbor Manajer');
    expect(visibleNavigationItems('ADMIN').map((item) => item.label)).toContain('Dasbor Manajer');
  });

  it('matches exact routes and segment descendants without substring collisions', () => {
    const tasks = visibleNavigationItems('MEMBER').find((item) => item.label === 'Tugas')!;
    expect(isNavigationItemActive('/workspaces/ws-1/tasks', 'ws-1', tasks)).toBe(true);
    expect(isNavigationItemActive('/workspaces/ws-1/tasks/task-1', 'ws-1', tasks)).toBe(true);
    expect(isNavigationItemActive('/workspaces/ws-1/tasks-old', 'ws-1', tasks)).toBe(false);
    expect(isNavigationItemActive('/workspaces/ws-2/tasks', 'ws-1', tasks)).toBe(false);
  });
});
