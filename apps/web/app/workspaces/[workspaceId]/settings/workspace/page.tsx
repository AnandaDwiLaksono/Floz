'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../../../../lib/auth-context';
import { api, ApiError } from '../../../../../lib/api-client';

export default function WorkspaceSettingsPage() {
  const { workspaceId } = useParams() as { workspaceId: string };
  const { activeWorkspace, refetchUser } = useAuth();
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isAdmin = activeWorkspace?.role === 'ADMIN';

  useEffect(() => {
    api.workspaces.get(workspaceId).then((res) => {
      setName(res.data.name);
      setTimezone(res.data.timezone);
    }).finally(() => setLoading(false));
  }, [workspaceId]);

  if (!isAdmin) return <div className="p-6 text-center text-red-600 font-semibold">Access denied. Admin only.</div>;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      await api.workspaces.update(workspaceId, { name: name.trim(), timezone });
      await refetchUser();
      setSuccess('Workspace updated.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-800 pb-3">
        <Link href={`/workspaces/${workspaceId}/settings/profile`} className="px-3 py-1.5 text-sm font-medium rounded hover:bg-gray-100 dark:hover:bg-gray-800">Profile</Link>
        <Link href={`/workspaces/${workspaceId}/settings/workspace`} className="px-3 py-1.5 text-sm font-semibold rounded bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">Workspace</Link>
        <Link href={`/workspaces/${workspaceId}/settings/members`} className="px-3 py-1.5 text-sm font-medium rounded hover:bg-gray-100 dark:hover:bg-gray-800">Members</Link>
        <Link href={`/workspaces/${workspaceId}/settings/teams`} className="px-3 py-1.5 text-sm font-medium rounded hover:bg-gray-100 dark:hover:bg-gray-800">Teams</Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
          <form onSubmit={handleSave} className="space-y-4">
            <h3 className="text-lg font-semibold">Workspace Settings</h3>
            {error && <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
            {success && <div role="status" className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-700">{success}</div>}
            <div>
              <label htmlFor="ws_name" className="mb-1 block text-sm font-medium">Workspace name</label>
              <input id="ws_name" type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded border px-3 py-2 dark:bg-gray-800" />
            </div>
            <div>
              <label htmlFor="ws_timezone" className="mb-1 block text-sm font-medium">Timezone</label>
              <input id="ws_timezone" type="text" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Asia/Jakarta" className="w-full rounded border px-3 py-2 dark:bg-gray-800" />
            </div>
            <button type="submit" disabled={saving} className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
          </form>
        </div>
      )}
    </div>
  );
}
