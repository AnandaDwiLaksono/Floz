import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../lib/auth-context';
import { api, ApiError, CurrentUser } from '../lib/api-client';

const navigation = vi.hoisted(() => ({ pathname: '/workspaces/ws-1/settings/members', push: vi.fn(), replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push, replace: navigation.replace }),
}));

vi.mock('../lib/api-client', async (load) => {
  const actual = await load<typeof import('../lib/api-client')>();
  return { ...actual, api: { ...actual.api, auth: { ...actual.api.auth, me: vi.fn() } } };
});

const membership = (id: string, role: 'ADMIN' | 'MANAGER' | 'MEMBER') => ({ id, name: `Workspace ${id}`, role, membership_status: 'ACTIVE' });
const currentUser = (workspaces: CurrentUser['workspaces']): CurrentUser => ({ id: 'user-1', email: 'user@example.com', full_name: 'User', avatar_url: null, timezone: 'UTC', locale: 'en-US', is_active: true, workspaces });

function Probe() {
  const { activeWorkspace, workspaceResolving } = useAuth();
  return <span>{workspaceResolving ? 'resolving' : activeWorkspace ? `${activeWorkspace.id}:${activeWorkspace.role}` : 'none'}</span>;
}

describe('AuthProvider workspace route resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.pathname = '/workspaces/ws-1/settings/members';
    vi.mocked(api.auth.me).mockResolvedValue({ data: currentUser([membership('ws-2', 'MEMBER'), membership('ws-1', 'ADMIN')]) });
  });

  it('selects the route workspace instead of the first membership during hydration', async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText('ws-1:ADMIN')).toBeInTheDocument());
    expect(api.auth.me).toHaveBeenCalledTimes(1);
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('selects the route workspace with inverse membership order', async () => {
    navigation.pathname = '/workspaces/ws-2/tasks';
    vi.mocked(api.auth.me).mockResolvedValue({ data: currentUser([membership('ws-1', 'ADMIN'), membership('ws-2', 'MEMBER')]) });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText('ws-2:MEMBER')).toBeInTheDocument());
  });

  it('clears invalid route context and replaces with canonical tasks route', async () => {
    navigation.pathname = '/workspaces/missing/settings/members';
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText('none')).toBeInTheDocument());
    expect(navigation.replace).toHaveBeenCalledWith('/workspaces/ws-2/tasks');
  });

  it('redirects malformed workspace route encoding without throwing or looping', async () => {
    navigation.pathname = '/workspaces/%E0%A4/tasks';
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/workspaces/ws-2/tasks'));
    expect(navigation.replace).toHaveBeenCalledTimes(1);
  });

  it('replaces with onboarding when the user has no workspace', async () => {
    vi.mocked(api.auth.me).mockResolvedValue({ data: currentUser([]) });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/onboarding'));
    expect(screen.getByText('none')).toBeInTheDocument();
  });

  it('does not redirect when authentication outcome is unknown', async () => {
    vi.mocked(api.auth.me).mockRejectedValue(new ApiError(503, 'UNAVAILABLE', 'Unavailable'));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(api.auth.me).toHaveBeenCalledTimes(1));
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('resolves pathname navigation without refetching the user', async () => {
    const view = render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText('ws-1:ADMIN')).toBeInTheDocument());
    navigation.pathname = '/workspaces/ws-2/tasks';
    await act(async () => view.rerender(<AuthProvider><Probe /></AuthProvider>));
    await waitFor(() => expect(screen.getByText('ws-2:MEMBER')).toBeInTheDocument());
    expect(api.auth.me).toHaveBeenCalledTimes(1);
  });
});
