import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Shell } from '../components/shell';

vi.mock('next/navigation', () => ({ usePathname: () => '/workspaces/workspace-1/my-work', useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../lib/auth-context', () => ({ useAuth: () => ({ user: { full_name: 'Member', email: 'member@example.com', workspaces: [] }, activeWorkspace: { id: 'workspace-1', name: 'Field Ops', role: 'MEMBER' }, loading: false, setActiveWorkspace: vi.fn(), logout: vi.fn() }) }));
vi.mock('../lib/hooks/use-notifications', () => ({ useUnreadCount: () => ({ unreadCount: 0, setUnreadCount: vi.fn() }), useNotifications: () => ({ notifications: [], loading: false, hasMore: false, error: '', loadMore: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn(), fetchNotifications: vi.fn() }) }));

describe('Task 8 shell navigation', () => {
  it('exposes dashboard/My Work links and labeled keyboard-closeable mobile navigation', () => {
    render(<Shell><p>Content</p></Shell>);
    expect(screen.getAllByRole('link', { name: 'Dashboard' })[0]).toHaveAttribute('href', '/workspaces/workspace-1/dashboard');
    expect(screen.getAllByRole('link', { name: 'My Work' })[0]).toHaveAttribute('href', '/workspaces/workspace-1/my-work');
    const open = screen.getByRole('button', { name: 'Open navigation' });
    fireEvent.click(open);
    const dialog = screen.getByRole('dialog', { name: 'Navigation' });
    expect(dialog).toBeInTheDocument();
    expect(dialog.contains(document.activeElement)).toBe(true);
    const close = screen.getByRole('button', { name: 'Close navigation' });
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getAllByRole('button', { name: 'Log out' })[1]);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(open);
  });
});
