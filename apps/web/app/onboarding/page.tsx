'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Building2, Link as LinkIcon } from 'lucide-react';
import { useAuth } from '../../lib/auth-context';
import { api } from '../../lib/api-client';
import { formatDateDisplay } from '../../lib/i18n-labels';
import { BrandLogo } from '../../components/brand-logo';

export default function OnboardingPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const [resending, setResending] = useState(false);
  const [resendStatus, setResendStatus] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<{ id: string; workspaceName: string; role: string; expiresAt: string }[]>([]);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
    if (!loading && user) {
      api.invitations.myPending().then((res) => setInvitations(res.data)).catch(() => setInvitations([]));
    }
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md space-y-4 text-center" aria-live="polite">
          <div className="h-8 w-3/4 mx-auto animate-pulse rounded bg-surface-subtle" />
          <div className="h-20 w-full animate-pulse rounded bg-surface-subtle" />
        </div>
      </div>
    );
  }

  // Check if user is email-verified (or fallback if email_verified not in user object)
  const isVerified = (user as unknown as { email_verified?: boolean; emailVerified?: boolean }).email_verified ?? (user as unknown as { email_verified?: boolean; emailVerified?: boolean }).emailVerified ?? true;

  const handleResend = async () => {
    setResending(true);
    setResendStatus(null);
    try {
      await api.auth.resendVerification({ email: user.email });
      setResendStatus('Email verifikasi telah dikirim. Silakan periksa kotak masuk Anda.');
    } catch {
      setResendStatus('Gagal mengirim email verifikasi.');
    } finally {
      setResending(false);
    }
  };

  return (
    <main className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-2xl space-y-8">
        <header className="space-y-2 text-center">
          <div className="mx-auto w-36"><BrandLogo /></div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">Selamat datang di Floz, {user.full_name}!</h1>
          <p className="text-sm text-muted-foreground">
            Mari mulai penyiapan akun Anda. Anda dapat membuat workspace baru, bergabung dengan tim, atau meninjau undangan.
          </p>
        </header>

        {!isVerified && (
          <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-warning">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="font-semibold text-foreground">Verifikasi alamat email Anda</p>
                <p className="text-sm text-muted-foreground">Silakan verifikasi email Anda untuk dapat membuat atau bergabung dengan workspace.</p>
              </div>
              <button
                type="button"
                onClick={handleResend}
                disabled={resending}
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-warning px-3 py-1.5 text-xs font-semibold text-warning-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {resending ? 'Sedang mengirim...' : 'Kirim Ulang Email'}
              </button>
            </div>
            {resendStatus && <p className="mt-2 text-xs font-medium">{resendStatus}</p>}
          </div>
        )}

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-foreground">Undangan Tertunda</h2>
          {invitations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-surface-subtle/50 p-6 text-center text-sm text-muted-foreground">
              Tidak ada undangan yang tertunda saat ini.
            </div>
          ) : (
            <div className="space-y-2">
              {invitations.map((invitation) => (
                <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4 shadow-xs">
                  <div>
                    <p className="font-semibold text-foreground">{invitation.workspaceName}</p>
                    <p className="text-sm text-muted-foreground">{invitation.role} · Kedaluwarsa {formatDateDisplay(invitation.expiresAt)}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">Gunakan tautan pada email undangan untuk menerima</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="grid gap-6 sm:grid-cols-2">
          {/* Card 1: Create Workspace */}
          <div className="flex flex-col justify-between rounded-xl border border-border bg-surface p-6 shadow-xs">
            <div className="space-y-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Building2 className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="text-lg font-bold text-foreground">Buat Ruang Kerja</h2>
              <p className="text-sm text-muted-foreground">
                Mulai ruang kerja baru untuk tim atau organisasi Anda. Anda akan menjadi Administrator Ruang Kerja.
              </p>
            </div>
            <div className="pt-6">
              <Link
                href={isVerified ? '/onboarding/create-workspace' : '#'}
                className={`flex min-h-11 w-full items-center justify-center rounded-md py-2.5 text-center text-sm font-semibold transition ${
                  isVerified
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs'
                    : 'cursor-not-allowed bg-muted text-muted-foreground opacity-50'
                }`}
              >
                Buat Ruang Kerja
              </Link>
            </div>
          </div>

          {/* Card 2: Join Workspace */}
          <div className="flex flex-col justify-between rounded-xl border border-border bg-surface p-6 shadow-xs">
            <div className="space-y-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <LinkIcon className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="text-lg font-bold text-foreground">Gabung ke Ruang Kerja</h2>
              <p className="text-sm text-muted-foreground">
                Gabung ke ruang kerja yang sudah ada menggunakan Kode Gabung atau ID Ruang Kerja.
              </p>
            </div>
            <div className="pt-6">
              <Link
                href={isVerified ? '/join' : '#'}
                className={`flex min-h-11 w-full items-center justify-center rounded-md border border-border py-2.5 text-center text-sm font-semibold text-foreground transition ${
                  isVerified ? 'hover:bg-surface-subtle shadow-xs' : 'cursor-not-allowed opacity-50'
                }`}
              >
                Gabung dengan Kode atau ID
              </Link>
            </div>
          </div>
        </div>

        <div className="flex justify-center gap-4 text-sm text-muted-foreground">
          <button
            type="button"
            onClick={() => void logout()}
            className="hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            Keluar
          </button>
        </div>
      </div>
    </main>
  );
}
