import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../components/shell';
import { WorkspaceSwitcher } from '../components/workspace-switcher';
import { ThemeProvider } from '../components/ui/theme-provider';

const state = vi.hoisted(() => ({ workspaceResolving: false, setActiveWorkspace: vi.fn(), logout: vi.fn(), fetchNotifications: vi.fn(), markRead: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/workspaces/workspace-1/my-work', useRouter: () => ({ push: state.push }) }));
vi.mock('../lib/auth-context', () => ({ useAuth: () => ({ user: { full_name: 'Manager', email: 'manager@example.com', workspaces: [{ id: 'workspace-1', name: 'Field Ops', role: 'MANAGER' }, { id: 'workspace-2', name: 'Back Office', role: 'ADMIN' }] }, activeWorkspace: { id: 'workspace-1', name: 'Field Ops', role: 'MANAGER' }, workspaceResolving: state.workspaceResolving, loading: false, authOutcome: 'authenticated', checkSession: vi.fn(), setActiveWorkspace: state.setActiveWorkspace, logout: state.logout }) }));
vi.mock('../lib/hooks/use-notifications', () => ({ useUnreadCount: () => ({ unreadCount: 2, setUnreadCount: vi.fn() }), useNotifications: () => ({ notifications: [{ id: 'notice-1', type: 'TASK_ASSIGNED', title: 'Tugas baru', body: 'Periksa tugas', entity_type: 'TASK', entity_id: 'task-1', is_read: false, read_at: null, created_at: '2026-09-23T10:00:00.000Z' }], loading: false, hasMore: false, error: '', loadMore: vi.fn(), markRead: state.markRead, markAllRead: vi.fn(), fetchNotifications: state.fetchNotifications }) }));

beforeEach(() => {
  state.workspaceResolving = false;
  vi.clearAllMocks();
});

describe('foundation shell navigation', () => {
  it('hides stale workspace identity and privileged navigation while resolving', () => {
    state.workspaceResolving = true;
    render(<ThemeProvider><Shell><p>Content</p></Shell></ThemeProvider>);
    expect(screen.queryByText('Field Ops')).not.toBeInTheDocument();
    expect(screen.queryByText('Role: MANAGER')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Pengaturan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Dasbor Manajer' })).not.toBeInTheDocument();
    state.workspaceResolving = false;
  });

  it('exposes dashboard/Pekerjaan Saya links and labeled keyboard-closeable mobile navigation', () => {
    render(<ThemeProvider><Shell><p>Content</p></Shell></ThemeProvider>);
    expect(screen.getAllByRole('link', { name: 'Ringkasan' })[0]).toHaveAttribute('href', '/workspaces/workspace-1/dashboard');
    expect(screen.getAllByRole('link', { name: 'Pekerjaan Saya' })[0]).toHaveAttribute('href', '/workspaces/workspace-1/my-work');
    expect(screen.getAllByRole('link', { name: 'Pengaturan' })).toHaveLength(1);
    const switcher = screen.getByRole('button', { name: /Field Ops/ });
    expect(switcher).toHaveAttribute('aria-expanded', 'false');
    expect(switcher.getAttribute('aria-controls')).toMatch(/^workspace-menu-/);
    fireEvent.keyDown(switcher, { key: 'ArrowDown' });
    const menu = screen.getByRole('menu');
    const menuItems = within(menu).getAllByRole('menuitem');
    expect(menuItems).toHaveLength(4);
    const item = within(menu).getByRole('menuitem', { name: /Field Ops/ });
    expect(document.activeElement).toBe(item);
    fireEvent.keyDown(item, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(menuItems[3]);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(item);
    fireEvent.keyDown(item, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(menuItems[1]);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(menuItems[2]);
    fireEvent.keyDown(item, { key: 'End' });
    expect(document.activeElement).toBe(menuItems[3]);
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(item);
    fireEvent.keyDown(item, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(switcher);
    const open = screen.getByRole('button', { name: 'Buka navigasi' });
    fireEvent.click(open);
    const dialog = screen.getByRole('dialog', { name: 'Navigasi' });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Dasbor Manajer' })).toHaveAttribute('href', '/workspaces/workspace-1/manager-dashboard');
    expect(dialog.contains(document.activeElement)).toBe(true);
    const close = within(dialog).getByRole('button', { name: 'Tutup navigasi' });
    expect(screen.getAllByRole('button', { name: 'Tutup navigasi' })).toHaveLength(1);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getAllByRole('button', { name: 'Keluar' })[1]);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Navigasi' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(open);
  });

  it('keeps workspace menu identifiers unique when shell variants coexist', () => {
    const workspace = { id: 'workspace-1', name: 'Field Ops', role: 'MANAGER' as const, membership_status: 'ACTIVE' };
    render(<WorkspaceSwitcher workspace={workspace} workspaces={[workspace]} setActiveWorkspace={vi.fn()} />);
    render(<WorkspaceSwitcher workspace={workspace} workspaces={[workspace]} setActiveWorkspace={vi.fn()} />);
    const triggers = screen.getAllByRole('button', { name: /Field Ops/ });
    fireEvent.click(triggers[0]);
    fireEvent.click(triggers[1]);
    const menuIds = screen.getAllByRole('menu').map((menu) => menu.id);
    expect(new Set(menuIds).size).toBe(menuIds.length);
    expect(triggers.map((trigger) => trigger.getAttribute('aria-controls'))).toEqual(menuIds);
  });

  it('opens notifications with Indonesian responsive semantics and preserves selection routing', () => {
    render(<ThemeProvider><Shell><p>Content</p></Shell></ThemeProvider>);
    const trigger = screen.getByRole('button', { name: /Notifikasi/i });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-controls', 'notification-panel');
    expect(screen.getByRole('region', { name: 'Notifikasi' })).toHaveAttribute('id', 'notification-panel');
    expect(screen.getByRole('heading', { name: 'Notifikasi' })).toBeInTheDocument();
    expect(screen.getByText('2 belum dibaca')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Tugas baru/ }));
    expect(state.markRead).toHaveBeenCalledWith('notice-1');
    expect(state.push).toHaveBeenCalledWith('/workspaces/workspace-1/tasks?selected_task_id=task-1');
  });
});
