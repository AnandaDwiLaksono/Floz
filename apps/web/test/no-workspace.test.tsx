import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RootPage from '../app/page';

const logout = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../lib/auth-context', () => ({ useAuth: () => ({ user: { full_name: 'Provisioned User', email: 'user@example.com', workspaces: [] }, activeWorkspace: null, loading: false, logout }) }));

describe('no workspace access', () => {
  it('offers change password and logout to an authenticated user without workspace access', () => {
    render(<RootPage />);
    expect(screen.getByRole('heading', { name: 'No workspace access yet' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Change Password' }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(logout).toHaveBeenCalled();
  });
});
