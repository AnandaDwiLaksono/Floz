'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '../../../../../lib/auth-context';
import { api, ApiError } from '../../../../../lib/api-client';
import { SettingsNav } from '../../../../../components/settings-nav';
import { Building2, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

export default function WorkspaceSettingsPage() {
  const { workspaceId } = useParams() as { workspaceId: string };
  const { activeWorkspace, workspaceResolving, refetchUser } = useAuth();
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isAdmin = !workspaceResolving && activeWorkspace?.id === workspaceId && activeWorkspace.role === 'ADMIN';

  useEffect(() => {
    if (!isAdmin) return;
    api.workspaces
      .get(workspaceId)
      .then((res) => {
        setName(res.data.name);
        setTimezone(res.data.timezone);
      })
      .finally(() => setLoading(false));
  }, [isAdmin, workspaceId]);

  if (!isAdmin) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <SettingsNav workspaceId={workspaceId} />
        <div className="p-8 text-center text-destructive font-semibold bg-destructive/10 border border-destructive/20 rounded-xl">
          Akses ditolak. Khusus admin.
        </div>
      </div>
    );
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      await api.workspaces.update(workspaceId, { name: name.trim(), timezone });
      await refetchUser();
      setSuccess('Workspace diperbarui.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Pembaruan gagal.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <SettingsNav workspaceId={workspaceId} />

      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Konfigurasi Workspace</h1>
        <p className="text-sm text-muted-foreground">Kelola nama organisasi, zona waktu default, dan metadata workspace.</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 bg-surface border border-border rounded-xl">
          <Loader2 className="animate-spin h-8 w-8 text-primary" />
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl p-6 shadow-sm space-y-6">
          <form onSubmit={handleSave} className="space-y-5">
            <div className="flex items-center gap-2 border-b border-border pb-4">
              <Building2 className="w-5 h-5 text-primary" />
              <h3 className="text-lg font-semibold text-foreground">Pengaturan Workspace</h3>
            </div>

            {error && (
              <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3.5 text-sm text-destructive flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {success && (
              <div role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3.5 text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <span>{success}</span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="ws_name" className="mb-1.5 block text-sm font-medium text-foreground">
                  Nama workspace
                </label>
                <input
                  id="ws_name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-input px-3.5 py-2.5 bg-surface text-foreground text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              <div>
                <label htmlFor="ws_timezone" className="mb-1.5 block text-sm font-medium text-foreground">
                  Zona waktu
                </label>
                <input
                  id="ws_timezone"
                  type="text"
                  required
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="Asia/Jakarta"
                  className="w-full rounded-lg border border-input px-3.5 py-2.5 bg-surface text-foreground text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition shadow-sm disabled:opacity-50"
              >
                {saving ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
