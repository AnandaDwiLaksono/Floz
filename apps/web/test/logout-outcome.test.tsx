import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../lib/auth-context';
import { ApiError, api } from '../lib/api-client';

const push = vi.fn();
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push }) }));
vi.mock('../lib/api-client', async (load) => {
  const actual = await load<typeof import('../lib/api-client')>();
  return { ...actual, api: { auth: { me: vi.fn(), login: vi.fn(), logout: vi.fn() } } };
});

const user = { id: 'user-1', email: 'user@example.com', full_name: 'User', timezone: 'UTC', locale: 'en', avatar_url: null, is_active: true, workspaces: [] };

function Probe() {
  const auth = useAuth();
  return <><span>{auth.user?.email ?? 'signed out'}</span><span>{auth.authOutcome}</span><button onClick={() => void auth.logout()}>Log out</button><button onClick={() => void auth.checkSession()}>Check session</button></>;
}

describe('auth outcome recovery', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.auth.me).mockResolvedValue({ data: user }); });

  it('clears the local session only after confirmed logout success', async () => {
    vi.mocked(api.auth.logout).mockResolvedValue(undefined);
    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText('user@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await screen.findByText('signed out');
    expect(screen.getByText('signed-out')).toBeInTheDocument();
  });

  it('preserves the session on explicit server failure', async () => {
    vi.mocked(api.auth.logout).mockRejectedValue(new ApiError(503, 'UNAVAILABLE', 'Try later'));
    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText('user@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await screen.findByText('failure');
    expect(screen.getByText('user@example.com')).toBeInTheDocument();
  });

  it('keeps an unknown transport outcome until one manual session read resolves it', async () => {
    vi.mocked(api.auth.logout).mockRejectedValue(new TypeError('Failed to fetch'));
    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText('user@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await screen.findByText('unknown');
    expect(api.auth.logout).toHaveBeenCalledTimes(1);
    vi.mocked(api.auth.me).mockRejectedValueOnce(new ApiError(401, 'UNAUTHORIZED', 'Signed out'));
    fireEvent.click(screen.getByRole('button', { name: 'Check session' }));
    await screen.findByText('signed out');
    expect(api.auth.logout).toHaveBeenCalledTimes(1);
  });

  it('restores a session on manual 200 and leaves network recovery unknown', async () => {
    vi.mocked(api.auth.logout).mockRejectedValue(new TypeError('Failed to fetch'));
    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText('user@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await screen.findByText('unknown');
    vi.mocked(api.auth.me).mockRejectedValueOnce(new TypeError('offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Check session' }));
    await waitFor(() => expect(screen.getByText('unknown')).toBeInTheDocument());
    vi.mocked(api.auth.me).mockResolvedValueOnce({ data: user });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Check session' })));
    expect(screen.getByText('authenticated')).toBeInTheDocument();
  });
});
