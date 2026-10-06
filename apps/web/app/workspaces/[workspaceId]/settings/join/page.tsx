'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '../../../../../lib/auth-context';
import { api, ApiError } from '../../../../../lib/api-client';
import { SettingsNav } from '../../../../../components/settings-nav';
import { KeyRound, AlertCircle } from 'lucide-react';

const policies = ['INVITE_ONLY', 'JOIN_CODE', 'APPROVAL_REQUIRED'] as const;

export default function JoinSettingsPage() {
  const { workspaceId } = useParams() as { workspaceId: string };
  const { activeWorkspace, workspaceResolving } = useAuth();
  const [policy, setPolicy] = useState('INVITE_ONLY');
  const [hasCode, setHasCode] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [requests, setRequests] = useState<{ id: string; userName: string; userEmail: string; status: string; requestedAt: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = !workspaceResolving && activeWorkspace?.id === workspaceId && activeWorkspace.role === 'ADMIN';

  const load = useCallback(async () => {
    const [settings, requestList] = await Promise.all([
      api.join.getSettings(workspaceId),
      api.join.listRequests(workspaceId),
    ]);
    setPolicy(settings.data.join_policy);
    setHasCode(settings.data.has_active_code);
    setRequests(requestList.data);
  }, [workspaceId]);

  useEffect(() => {
    if (isAdmin) void load().catch((err) => setError(err instanceof ApiError ? err.message : 'Gagal memuat pengaturan bergabung.'));
  }, [isAdmin, load]);

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

  const updatePolicy = async (value: string) => {
    setPolicy(value);
    await api.join.updateSettings(workspaceId, value);
  };

  const generate = async () => {
    const result = await api.join.generateCode(workspaceId);
    setCode(result.data.join_code);
    setHasCode(true);
  };

  const revoke = async () => {
    await api.join.revokeCode(workspaceId);
    setCode(null);
    setHasCode(false);
  };

  const review = async (id: string, approve: boolean) => {
    await (approve ? api.join.approveRequest(workspaceId, id) : api.join.rejectRequest(workspaceId, id));
    await load();
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <SettingsNav workspaceId={workspaceId} />

      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Kebijakan Bergabung & Akses</h1>
        <p className="text-sm text-muted-foreground">Atur cara anggota baru meminta akses atau bergabung ke workspace ini.</p>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="bg-surface border border-border rounded-xl p-6 shadow-sm space-y-5">
        <div className="flex items-center gap-2 border-b border-border pb-4">
          <KeyRound className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Kebijakan Bergabung Workspace</h3>
        </div>

        <div>
          <label htmlFor="join_policy" className="block text-sm font-semibold text-foreground mb-1.5">
            Kebijakan bergabung
          </label>
          <select
            id="join_policy"
            value={policy}
            onChange={(e) => void updatePolicy(e.target.value)}
            className="w-full sm:w-80 rounded-lg border border-input px-3.5 py-2.5 bg-surface text-foreground text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {policies.map((value) => (
              <option key={value} value={value}>
                {value === 'INVITE_ONLY' ? 'Hanya undangan' : value === 'JOIN_CODE' ? 'Kode bergabung' : 'Perlu persetujuan'}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground mt-1.5">
            {policy === 'INVITE_ONLY' && 'Hanya pengguna yang diundang yang dapat bergabung.'}
            {policy === 'JOIN_CODE' && 'Pengguna dengan kode bergabung aktif dapat langsung bergabung.'}
            {policy === 'APPROVAL_REQUIRED' && 'Pengguna dapat meminta bergabung; admin harus menyetujui setiap permintaan.'}
          </p>
        </div>

        {policy === 'JOIN_CODE' && (
          <div className="space-y-3 pt-3 border-t border-border">
            <p className="text-sm text-muted-foreground">{hasCode ? 'Kode bergabung aktif tersedia.' : 'Tidak ada kode bergabung aktif.'}</p>
            {code && (
              <div className="p-3 bg-muted/60 border border-border rounded-lg inline-block">
                <p className="font-mono font-bold text-base tracking-wider text-foreground">{code}</p>
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void generate()}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition shadow-sm"
              >
                Buat / Ganti kode
              </button>
              {hasCode && (
                <button
                  type="button"
                  onClick={() => void revoke()}
                  className="rounded-lg border border-input bg-surface px-4 py-2 text-sm font-medium hover:bg-muted transition"
                >
                  Cabut kode
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <section className="space-y-3 pt-2">
        <h3 className="text-lg font-bold text-foreground">Permintaan bergabung tertunda</h3>
        <div className="rounded-xl border border-border bg-surface overflow-hidden shadow-sm">
          {requests.filter((request) => request.status === 'PENDING').length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">Tidak ada permintaan bergabung yang menunggu ditinjau.</p>
          ) : (
            requests
              .filter((request) => request.status === 'PENDING')
              .map((request) => (
                <div
                  key={request.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4 last:border-b-0 hover:bg-muted/20 transition-colors"
                >
                  <div>
                    <p className="font-medium text-foreground">{request.userName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{request.userEmail}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void review(request.id, true)}
                      className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition"
                    >
                      Setujui
                    </button>
                    <button
                      type="button"
                      onClick={() => void review(request.id, false)}
                      className="rounded-lg border border-input bg-surface px-3 py-1.5 text-xs font-medium hover:bg-muted transition"
                    >
                      Tolak
                    </button>
                  </div>
                </div>
              ))
          )}
        </div>
      </section>
    </div>
  );
}
