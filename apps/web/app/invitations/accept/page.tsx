'use client';

import React, { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { AlertCircle, Building2 } from 'lucide-react';
import { useAuth } from '../../../lib/auth-context';
import { api, ApiError } from '../../../lib/api-client';
import { BrandLogo } from '../../../components/brand-logo';

function AcceptInvitationContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const router = useRouter();
  const { user, loading: authLoading, refetchUser } = useAuth();

  const [preview, setPreview] = useState<{ workspace_name: string; invited_email: string; role: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token) {
      api.invitations.preview(token)
        .then((res) => setPreview(res.data))
        .catch((err) => setError(err instanceof ApiError ? err.message : 'Token undangan tidak valid atau telah kedaluwarsa.'))
        .finally(() => setLoading(false));
    } else {
      setError('Token undangan tidak ditemukan.');
      setLoading(false);
    }
  }, [token]);

  const handleAccept = async () => {
    if (!token) return;
    setAccepting(true);
    setError(null);
    try {
      const res = await api.invitations.accept(token);
      await refetchUser();
      router.push(`/workspaces/${res.data.workspace_id}/tasks`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menerima undangan.');
    } finally {
      setAccepting(false);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="space-y-4 py-8 text-center" aria-live="polite">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto" />
        <p className="text-sm text-muted-foreground">Memuat rincian undangan...</p>
      </div>
    );
  }

  if (error || !preview) {
    return (
      <div className="space-y-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-danger/10 text-danger">
          <AlertCircle className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">Kendala Undangan</h1>
        <p className="text-sm text-muted-foreground">
          {error || 'Detail undangan tidak dapat dimuat.'}
        </p>
        <div className="pt-2">
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-xs transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            Ke Halaman Masuk
          </Link>
        </div>
      </div>
    );
  }

  const isEmailMatch = user && user.email.toLowerCase() === preview.invited_email.toLowerCase();

  return (
    <div className="space-y-6">
      <header className="space-y-2 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Building2 className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">Anda diundang!</h1>
        <p className="text-sm text-muted-foreground">
          Anda diundang untuk bergabung ke <strong className="text-foreground">{preview.workspace_name}</strong> sebagai <span className="font-semibold text-primary">{preview.role}</span>.
        </p>
      </header>

      {!user ? (
        <div className="space-y-4 rounded-xl border border-border bg-surface-subtle p-4 text-center">
          <p className="text-sm text-muted-foreground">
            Untuk menerima undangan ini, silakan masuk atau daftar dengan email <strong>{preview.invited_email}</strong>.
          </p>
          <div className="flex gap-3 pt-2">
            <Link
              href={`/login?redirect=/invitations/accept?token=${token}`}
              className="flex min-h-11 flex-1 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              Masuk
            </Link>
            <Link
              href={`/register?email=${encodeURIComponent(preview.invited_email)}`}
              className="flex min-h-11 flex-1 items-center justify-center rounded-md border border-border bg-surface text-sm font-semibold text-foreground transition hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              Daftar
            </Link>
          </div>
        </div>
      ) : !isEmailMatch ? (
        <div role="alert" className="rounded-md border border-warning/30 bg-warning/10 p-4 text-center text-sm text-warning font-medium">
          Anda sedang masuk sebagai <strong>{user.email}</strong>, tetapi undangan ini dikirim ke <strong>{preview.invited_email}</strong>. Silakan ganti akun untuk menerima.
        </div>
      ) : (
        <div className="space-y-4">
          <button
            type="button"
            onClick={handleAccept}
            disabled={accepting}
            className="flex min-h-11 w-full items-center justify-center rounded-md bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-xs transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50"
          >
            {accepting ? 'Sedang bergabung ke workspace...' : `Terima & Gabung ke ${preview.workspace_name}`}
          </button>
        </div>
      )}
    </div>
  );
}

export default function AcceptInvitationPage() {
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
          <AcceptInvitationContent />
        </Suspense>
      </div>
    </main>
  );
}
