'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../../../../lib/auth-context';
import { api, ApiError, Team, WorkspaceMember } from '../../../../../lib/api-client';

export default function TeamsSettingsPage() {
  const { workspaceId } = useParams() as { workspaceId: string };
  const { activeWorkspace } = useAuth();
  const isAdmin = activeWorkspace?.role === 'ADMIN';
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'archived'>('all');
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createManager, setCreateManager] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSaving, setCreateSaving] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [t, m] = await Promise.all([api.workspaces.teams(workspaceId), api.workspaces.members(workspaceId)]);
      setTeams(t.data);
      setMembers(m.data);
    } finally { setLoading(false); }
  }, [workspaceId]);

  useEffect(() => { loadData(); }, [loadData]);

  if (!isAdmin) return <div className="p-6 text-center text-red-600 font-semibold">Access denied. Admin only.</div>;

  const managers = members.filter((m) => m.status === 'ACTIVE' && (m.role === 'ADMIN' || m.role === 'MANAGER'));
  const filtered = teams.filter((t) => filter === 'all' || (filter === 'active' ? t.isActive : !t.isActive));

  const handleToggleActive = async (team: Team) => {
    setError(null);
    try {
      await api.workspaces.updateTeam(workspaceId, team.id, { is_active: !team.isActive });
      loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed.');
    }
  };

  const handleManagerChange = async (team: Team, managerId: string) => {
    setError(null);
    try {
      await api.workspaces.updateTeam(workspaceId, team.id, { manager_user_id: managerId || null });
      loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed.');
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreateSaving(true);
    try {
      await api.workspaces.createTeam(workspaceId, { name: createName, description: createDesc || undefined, manager_user_id: createManager || null });
      setCreateOpen(false);
      setCreateName('');
      setCreateDesc('');
      setCreateManager('');
      loadData();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Create failed.');
    } finally { setCreateSaving(false); }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-800 pb-3">
        <Link href={`/workspaces/${workspaceId}/settings/profile`} className="px-3 py-1.5 text-sm font-medium rounded hover:bg-gray-100 dark:hover:bg-gray-800">Profile</Link>
        <Link href={`/workspaces/${workspaceId}/settings/workspace`} className="px-3 py-1.5 text-sm font-medium rounded hover:bg-gray-100 dark:hover:bg-gray-800">Workspace</Link>
        <Link href={`/workspaces/${workspaceId}/settings/members`} className="px-3 py-1.5 text-sm font-medium rounded hover:bg-gray-100 dark:hover:bg-gray-800">Members</Link>
        <Link href={`/workspaces/${workspaceId}/settings/teams`} className="px-3 py-1.5 text-sm font-semibold rounded bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">Teams</Link>
        <Link href={`/workspaces/${workspaceId}/settings/workflows`} className="px-3 py-1.5 text-sm font-medium rounded hover:bg-gray-100 dark:hover:bg-gray-800">Workflows</Link>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="text-2xl font-bold">Teams</h2>
        <button onClick={() => { setCreateOpen(true); setCreateError(null); }} className="px-4 py-2 text-sm font-bold text-white bg-blue-600 rounded hover:bg-blue-700">New Team</button>
      </div>

      <div className="flex gap-2">
        {(['all', 'active', 'archived'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 text-sm rounded font-medium ${filter === f ? 'bg-blue-50 text-blue-600 font-semibold' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}>{f.charAt(0).toUpperCase() + f.slice(1)}</button>
        ))}
      </div>

      {error && <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
      ) : (
        <div className="space-y-3">
          {filtered.map((team) => (
            <div key={team.id} className={`bg-white dark:bg-gray-900 border rounded-lg p-4 ${!team.isActive ? 'opacity-60' : ''} border-gray-200 dark:border-gray-800`}>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{team.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${team.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>{team.isActive ? 'Active' : 'Archived'}</span>
                  </div>
                  {team.description && <p className="text-sm text-gray-500 mt-1">{team.description}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <select aria-label={`Manager for ${team.name}`} value={team.manager_user_id ?? ''} onChange={(e) => handleManagerChange(team, e.target.value)} className="text-xs border rounded px-2 py-1 dark:bg-gray-800">
                    <option value="">No manager</option>
                    {managers.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
                  </select>
                  <button onClick={() => handleToggleActive(team)} className={`px-3 py-1 text-xs font-bold rounded ${team.isActive ? 'bg-gray-200 text-gray-700 hover:bg-gray-300' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>{team.isActive ? 'Archive' : 'Restore'}</button>
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <p className="text-center text-gray-500 py-8">No teams found.</p>}
        </div>
      )}

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => setCreateOpen(false)} />
          <div role="dialog" aria-modal="true" aria-label="Create Team" className="relative w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6 rounded-lg shadow-xl">
            <form onSubmit={handleCreate} className="space-y-4">
              <h3 className="text-lg font-bold">New Team</h3>
              {createError && <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{createError}</div>}
              <div>
                <label htmlFor="team_name" className="mb-1 block text-sm font-medium">Name</label>
                <input id="team_name" type="text" required value={createName} onChange={(e) => setCreateName(e.target.value)} className="w-full rounded border px-3 py-2 dark:bg-gray-800" />
              </div>
              <div>
                <label htmlFor="team_desc" className="mb-1 block text-sm font-medium">Description</label>
                <textarea id="team_desc" value={createDesc} onChange={(e) => setCreateDesc(e.target.value)} className="w-full rounded border px-3 py-2 dark:bg-gray-800 h-20" />
              </div>
              <div>
                <label htmlFor="team_manager" className="mb-1 block text-sm font-medium">Manager</label>
                <select id="team_manager" value={createManager} onChange={(e) => setCreateManager(e.target.value)} className="w-full rounded border px-3 py-2 dark:bg-gray-800">
                  <option value="">None</option>
                  {managers.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setCreateOpen(false)} className="px-4 py-2 text-sm border rounded hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={createSaving} className="px-4 py-2 text-sm font-bold bg-blue-600 text-white rounded disabled:opacity-50">{createSaving ? 'Creating...' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
