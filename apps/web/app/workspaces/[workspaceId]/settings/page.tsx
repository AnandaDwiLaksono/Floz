'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function SettingsPage() {
  const { workspaceId } = useParams() as { workspaceId: string };
  const router = useRouter();
  useEffect(() => { router.replace(`/workspaces/${workspaceId}/settings/profile`); }, [workspaceId, router]);
  return null;
}
