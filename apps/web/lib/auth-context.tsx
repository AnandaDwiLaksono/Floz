'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { api, CurrentUser, WorkspaceMembershipInfo, ApiError } from './api-client';

type AuthOutcome = 'authenticated' | 'signed-out' | 'failure' | 'unknown';

interface AuthContextType {
  user: CurrentUser | null;
  loading: boolean;
  authOutcome: AuthOutcome;
  activeWorkspace: WorkspaceMembershipInfo | null;
  workspaceResolving: boolean;
  setActiveWorkspace: (ws: WorkspaceMembershipInfo) => void;
  login: (email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
  checkSession: () => Promise<CurrentUser | null>;
  refetchUser: () => Promise<CurrentUser | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authOutcome, setAuthOutcome] = useState<AuthOutcome>('unknown');
  const [activeWorkspace, setActiveWorkspaceState] = useState<WorkspaceMembershipInfo | null>(null);
  const [workspaceResolving, setWorkspaceResolving] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const refetchUser = useCallback(async () => {
    try {
      const res = await api.auth.me();
      setUser(res.data);
      setAuthOutcome('authenticated');
      return res.data;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
        setActiveWorkspaceState(null);
        setAuthOutcome('signed-out');
      } else {
        setAuthOutcome('unknown');
      }
      return null;
    }
  }, []);

  useEffect(() => {
    refetchUser().finally(() => setLoading(false));
  }, [refetchUser]);

  useEffect(() => {
    if (authOutcome === 'authenticated' && user) {
      const match = pathname?.match(/^\/workspaces\/([^/]+)(?:\/|$)/);
      const routeWorkspaceId = match ? decodeURIComponent(match[1]) : null;
      setWorkspaceResolving(true);
      if (routeWorkspaceId) {
        setActiveWorkspaceState(null);
        const routeWorkspace = user.workspaces.find((workspace) => workspace.id === routeWorkspaceId);
        if (routeWorkspace) setActiveWorkspaceState(routeWorkspace);
        else if (user.workspaces[0]) router.replace(`/workspaces/${user.workspaces[0].id}/tasks`);
        else router.replace('/onboarding');
      } else {
        setActiveWorkspaceState((previous) => previous && user.workspaces.some((workspace) => workspace.id === previous.id) ? previous : user.workspaces[0] ?? null);
      }
      setWorkspaceResolving(false);
    } else if (authOutcome === 'signed-out') {
      setActiveWorkspaceState(null);
      setWorkspaceResolving(false);
    }
  }, [user, pathname, authOutcome, router]);

  useEffect(() => {
    if (!loading && authOutcome !== 'unknown' && authOutcome !== 'failure') {
      const publicRoutes = ['/login', '/register', '/verify-email', '/join', '/invitations/accept'];
      const isPublic = publicRoutes.some((route) => pathname === route || pathname?.startsWith(route));
      if (!user && !isPublic) router.push('/login');
      else if (user && pathname === '/login') {
        if (activeWorkspace) router.push(`/workspaces/${activeWorkspace.id}/tasks`);
        else if (user.workspaces?.length) router.push(`/workspaces/${user.workspaces[0].id}/tasks`);
        else router.push('/onboarding');
      }
    }
  }, [user, loading, pathname, router, activeWorkspace, authOutcome]);

  const login = async (email: string, pass: string) => {
    await api.auth.login({ email, password: pass });
    const fetchedUser = await refetchUser();
    if (fetchedUser?.workspaces?.length) {
      setActiveWorkspaceState(fetchedUser.workspaces[0]);
      router.push(`/workspaces/${fetchedUser.workspaces[0].id}/tasks`);
    } else router.push('/');
  };

  const logout = async () => {
    try {
      await api.auth.logout();
      setUser(null);
      setActiveWorkspaceState(null);
      setAuthOutcome('signed-out');
      router.push('/login');
    } catch (err) {
      setAuthOutcome(err instanceof ApiError ? 'failure' : 'unknown');
    }
  };

  const checkSession = useCallback(() => refetchUser(), [refetchUser]);
  const setActiveWorkspace = (ws: WorkspaceMembershipInfo) => {
    setActiveWorkspaceState(ws);
    router.push(`/workspaces/${ws.id}/tasks`);
  };

  return <AuthContext.Provider value={{ user, loading, authOutcome, activeWorkspace, workspaceResolving, setActiveWorkspace, login, logout, checkSession, refetchUser }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
