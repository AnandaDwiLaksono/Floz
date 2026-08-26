'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { api, CurrentUser, WorkspaceMembershipInfo, ApiError } from './api-client';

interface AuthContextType {
  user: CurrentUser | null;
  loading: boolean;
  activeWorkspace: WorkspaceMembershipInfo | null;
  setActiveWorkspace: (ws: WorkspaceMembershipInfo) => void;
  login: (email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
  refetchUser: () => Promise<CurrentUser | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeWorkspace, setActiveWorkspaceState] = useState<WorkspaceMembershipInfo | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  const refetchUser = useCallback(async () => {
    try {
      const res = await api.auth.me();
      setUser(res.data);
      if (res.data.workspaces && res.data.workspaces.length > 0) {
        setActiveWorkspaceState((prev) => {
          if (prev && res.data.workspaces.some((w) => w.id === prev.id)) {
            return prev;
          }
          return res.data.workspaces[0];
        });
      }
      return res.data;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
        setActiveWorkspaceState(null);
      }
      return null;
    }
  }, []);

  useEffect(() => {
    refetchUser().finally(() => setLoading(false));
  }, [refetchUser]);

  useEffect(() => {
    if (!loading) {
      if (!user && pathname !== '/login') {
        router.push('/login');
      } else if (user && pathname === '/login') {
        if (activeWorkspace) {
          router.push(`/workspaces/${activeWorkspace.id}/tasks`);
        } else if (user.workspaces && user.workspaces.length > 0) {
          router.push(`/workspaces/${user.workspaces[0].id}/tasks`);
        } else {
          router.push('/');
        }
      }
    }
  }, [user, loading, pathname, router, activeWorkspace]);

  const login = async (email: string, pass: string) => {
    await api.auth.login({ email, password: pass });
    const fetchedUser = await refetchUser();
    if (fetchedUser && fetchedUser.workspaces && fetchedUser.workspaces.length > 0) {
      const firstWs = fetchedUser.workspaces[0];
      setActiveWorkspaceState(firstWs);
      router.push(`/workspaces/${firstWs.id}/tasks`);
    } else {
      router.push('/');
    }
  };

  const logout = async () => {
    try {
      await api.auth.logout();
    } finally {
      setUser(null);
      setActiveWorkspaceState(null);
      router.push('/login');
    }
  };

  const setActiveWorkspace = (ws: WorkspaceMembershipInfo) => {
    setActiveWorkspaceState(ws);
    router.push(`/workspaces/${ws.id}/tasks`);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        activeWorkspace,
        setActiveWorkspace,
        login,
        logout,
        refetchUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
