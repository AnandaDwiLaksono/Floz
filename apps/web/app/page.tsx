'use client';

import React, { useEffect } from 'react';
import { useAuth } from '../lib/auth-context';
import { useRouter } from 'next/navigation';

export default function RootPage() {
  const { user, activeWorkspace, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.push('/login');
      } else if (activeWorkspace) {
        router.push(`/workspaces/${activeWorkspace.id}/tasks`);
      } else if (user.workspaces && user.workspaces.length > 0) {
        router.push(`/workspaces/${user.workspaces[0].id}/tasks`);
      }
    }
  }, [user, activeWorkspace, loading, router]);

  return (
    <div className="flex items-center justify-center min-h-[300px]">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  );
}
