'use client';

import React, { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth-context';
import { api, ApiError } from '../../lib/api-client';
import { BrandLogo } from '../../components/brand-logo';

function JoinContent() {
  const searchParams = useSearchParams();
  const urlCode = searchParams.get('code');
  const router = useRouter();
  const { user, loading: authLoading, refetchUser } = useAuth();

  const [inputVal, setInputVal] = useState(urlCode || '');
  const [preview, setPreview] = useState<{ workspace_id: string; workspace_name: string; action?: string; join_policy?: string } | null>(null);
  const [loading, setLoading] = useState(Boolean(urlCode));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (urlCode) {
      handlePreview(urlCode);
    }
  }, [urlCode]);

  const handlePreview = async (val: string) => {
    const trimmed = val.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed);
      const res = await api.join.preview(isUuid ? { workspace_id: trimmed } : { join_code: trimmed });
      setPreview(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kode atau ID Workspace tidak valid.');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!inputVal.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.join.joinByCode(inputVal.trim());
      await refetchUser();
      setSuccess('Berhasil bergabung dengan workspace!');
      router.push(`/workspaces/${res.data.workspace_id}/tasks`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal bergabung dengan workspace.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestApproval = async () => {
    if (!preview?.workspace_id) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.join.requestJoin(preview.workspace_id);
      setSuccess('Permohonan gabung telah dikirim! Silakan tunggu persetujuan administrator workspace.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal mengirim permohonan gabung.');
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="space-y-4 py-4" aria-live="polite">
        <div className="h-6 w-3/4 mx-auto animate-pulse rounded bg-surface-subtle" />
        <div className="h-10 w-full animate-pulse rounded bg-surface-subtle" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2 text-center">
        <h1 className="text-2xl font-bold text-foreground">Gabung Workspace</h1>
        <p className="text-sm text-muted-foreground">
          Masukkan Kode Gabung (contoh: FLOZ-XXXX-XXXX-XXXX) atau ID Workspace.
        </p>
      </header>

      {error ? (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {success ? (
        <div role="status" className="rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success">
          {success}
        </div>
      ) : null}

      <div className="space-y-4">
        <div>
          <label htmlFor="join_input" className="mb-1 block text-sm font-semibold text-foreground">
            Kode Gabung atau ID Workspace
          </label>
          <div className="flex gap-2">
            <input
              id="join_input"
              type="text"
              disabled={loading || submitting}
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              className="flex-1 min-h-11 rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50"
              placeholder="FLOZ-XXXX-XXXX-XXXX"
            />
            <button
              type="button"
              onClick={() => handlePreview(inputVal)}
              disabled={loading || submitting || !inputVal.trim()}
              className="flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50"
            >
              {loading ? 'Memeriksa...' : 'Periksa'}
            </button>
          </div>
        </div>

        {preview && (
          <div className="rounded-xl border border-border bg-surface-subtle p-4 space-y-3">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Workspace</p>
              <p className="text-lg font-bold text-foreground">{preview.workspace_name}</p>
            </div>

            {preview.action === 'JOIN' && (
              <button
                type="button"
                onClick={handleJoin}
                disabled={submitting || !user}
                className="flex min-h-11 w-full items-center justify-center rounded-md bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50"
              >
                {submitting ? 'Sedang bergabung...' : !user ? 'Silakan Masuk untuk Bergabung' : 'Gabung sebagai Anggota'}
              </button>
            )}

            {preview.action === 'REQUEST_APPROVAL' && (
              <button
                type="button"
                onClick={handleRequestApproval}
                disabled={submitting || !user}
                className="flex min-h-11 w-full items-center justify-center rounded-md bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50"
              >
                {submitting ? 'Sedang mengirim permohonan...' : !user ? 'Silakan Masuk untuk Meminta' : 'Kirim Permohonan Gabung'}
              </button>
            )}

            {preview.action === 'JOIN_CODE_REQUIRED' && (
              <p className="text-sm text-warning font-medium">
                Workspace ini memerlukan Kode Gabung yang valid. Silakan masukkan kode lengkap di atas.
              </p>
            )}

            {preview.action === 'INVITATION_REQUIRED' && (
              <p className="text-sm text-muted-foreground">
                Workspace ini hanya dapat diakses melalui undangan. Silakan hubungi administrator workspace.
              </p>
            )}
          </div>
        )}
      </div>

      <footer className="text-center text-sm">
        <Link href="/onboarding" className="text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
          Kembali ke Penyiapan
        </Link>
      </footer>
    </div>
  );
}

export default function JoinPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md space-y-6 rounded-xl border border-border bg-surface p-6 sm:p-8 shadow-xs">
        <div className="mx-auto w-36"><BrandLogo /></div>
        <Suspense fallback={
          <div className="space-y-4 py-6 text-center" aria-live="polite">
            <div className="h-6 w-3/4 mx-auto animate-pulse rounded bg-surface-subtle" />
            <div className="h-10 w-full animate-pulse rounded bg-surface-subtle" />
          </div>
        }>
          <JoinContent />
        </Suspense>
      </div>
    </main>
  );
}
