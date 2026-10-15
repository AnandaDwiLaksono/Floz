'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '../../../../../lib/auth-context';
import { api, ApiError, Team, WorkspaceMember } from '../../../../../lib/api-client';
import { SettingsNav } from '../../../../../components/settings-nav';
import { Users2, Plus, AlertCircle, Loader2, X } from 'lucide-react';

export default function TeamsSettingsPage() {
  const { workspaceId } = useParams() as { workspaceId: string };
  const { activeWorkspace, workspaceResolving } = useAuth();
  const isAdmin = !workspaceResolving && activeWorkspace?.id === workspaceId && activeWorkspace.role === 'ADMIN';

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
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (isAdmin) void loadData();
  }, [isAdmin, loadData]);

  if (!isAdmin) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <SettingsNav workspaceId={workspaceId} />
        <div className="p-8 text-center text-danger font-semibold bg-danger/10 border border-danger/20 rounded-xl">
          Akses ditolak. Khusus admin.
        </div>
      </div>
    );
  }

  const managers = members.filter((m) => m.status === 'ACTIVE' && (m.role === 'ADMIN' || m.role === 'MANAGER'));
  const filtered = teams.filter((t) => filter === 'all' || (filter === 'active' ? t.isActive : !t.isActive));

  const handleToggleActive = async (team: Team) => {
    setError(null);
    try {
      await api.workspaces.updateTeam(workspaceId, team.id, { is_active: !team.isActive });
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed.');
    }
  };

  const handleManagerChange = async (team: Team, managerId: string) => {
    setError(null);
    try {
      await api.workspaces.updateTeam(workspaceId, team.id, { manager_user_id: managerId || null });
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed.');
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreateSaving(true);
    try {
      await api.workspaces.createTeam(workspaceId, {
        name: createName,
        description: createDesc || undefined,
        manager_user_id: createManager || null,
      });
      setCreateOpen(false);
      setCreateName('');
      setCreateDesc('');
      setCreateManager('');
      await loadData();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Create failed.');
    } finally {
      setCreateSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 px-4 sm:px-6 pb-12">
      <SettingsNav workspaceId={workspaceId} />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Tim & Unit</h1>
          <p className="text-sm text-muted-foreground">Kelompokkan anggota ke dalam departemen, unit, dan tim.</p>
        </div>
        <button
          onClick={() => {
            setCreateOpen(true);
            setCreateError(null);
          }}
          className="px-4 py-2 text-sm font-semibold text-primary-foreground bg-primary hover:bg-primary/90 rounded-lg transition shadow-sm inline-flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          Buat tim
        </button>
      </div>

      <div className="flex items-center gap-2 border-b border-border pb-3">
        {(['all', 'active', 'archived'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
              filter === f
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            {{ all: 'Semua', active: 'Aktif', archived: 'Diarsipkan' }[f]}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-danger/20 bg-danger/10 p-4 text-sm text-danger flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16 bg-surface border border-border rounded-xl">
          <Loader2 className="animate-spin h-8 w-8 text-primary" />
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((team) => (
            <div
              key={team.id}
              className={`bg-surface border rounded-xl p-5 shadow-sm transition-all ${
                !team.isActive ? 'opacity-65 border-dashed border-border' : 'border-border'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <Users2 className="w-4 h-4 text-muted-foreground" />
                    <span className="font-semibold text-foreground text-base">{team.name}</span>
                    <span
                      className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                        team.isActive
                          ? 'bg-success/10 text-success border border-success/20'
                          : 'bg-muted text-muted-foreground border border-border'
                      }`}
                    >
                      {team.isActive ? 'Aktif' : 'Diarsipkan'}
                    </span>
                  </div>
                  {team.description && <p className="text-sm text-muted-foreground pl-6.5">{team.description}</p>}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span>Manajer:</span>
                    <select
                      aria-label={`Manager for ${team.name}`}
                      value={team.manager_user_id ?? ''}
                      onChange={(e) => handleManagerChange(team, e.target.value)}
                      className="text-xs border border-border rounded-lg px-2.5 py-1.5 bg-surface text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    >
                      <option value="">Tanpa manajer</option>
                      {managers.map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.full_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={() => handleToggleActive(team)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                      team.isActive
                        ? 'border border-border bg-surface hover:bg-muted text-foreground'
                        : 'bg-primary text-primary-foreground hover:bg-primary/90'
                    }`}
                  >
                    {team.isActive ? 'Arsipkan' : 'Pulihkan'}
                  </button>
                </div>
              </div>
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="text-center py-12 bg-surface border border-border rounded-xl">
              <p className="text-sm text-muted-foreground">Belum ada tim.</p>
            </div>
          )}
        </div>
      )}

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-overlay backdrop-blur-sm" onClick={() => setCreateOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Create Team"
            className="relative w-full max-w-md bg-surface border border-border p-6 rounded-xl shadow-xl space-y-4"
          >
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <h3 className="text-lg font-bold text-foreground">Buat tim</h3>
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="p-1 text-muted-foreground hover:text-foreground rounded transition"
                  aria-label="Close dialog"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {createError && (
                <div role="alert" className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-danger">
                  {createError}
                </div>
              )}

              <div>
                <label htmlFor="team_name" className="mb-1.5 block text-sm font-medium text-foreground">
                  Nama
                </label>
                <input
                  id="team_name"
                  type="text"
                  required
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  className="w-full rounded-lg border border-border px-3.5 py-2 text-sm bg-surface text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                />
              </div>

              <div>
                <label htmlFor="team_desc" className="mb-1.5 block text-sm font-medium text-foreground">
                  Deskripsi
                </label>
                <textarea
                  id="team_desc"
                  value={createDesc}
                  onChange={(e) => setCreateDesc(e.target.value)}
                  className="w-full rounded-lg border border-border px-3.5 py-2 text-sm bg-surface text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring h-20"
                />
              </div>

              <div>
                <label htmlFor="team_manager" className="mb-1.5 block text-sm font-medium text-foreground">
                  Manajer
                </label>
                <select
                  id="team_manager"
                  value={createManager}
                  onChange={(e) => setCreateManager(e.target.value)}
                  className="w-full rounded-lg border border-border px-3.5 py-2 text-sm bg-surface text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                  <option value="">Tanpa manajer</option>
                  {managers.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.full_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition font-medium"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={createSaving}
                  className="px-4 py-2 text-sm font-bold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition disabled:opacity-50"
                >
                  {createSaving ? 'Membuat...' : 'Buat'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
