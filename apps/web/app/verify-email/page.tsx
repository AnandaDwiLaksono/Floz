'use client';

import React, { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { api, ApiError } from '../../lib/api-client';
import { BrandLogo } from '../../components/brand-logo';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const email = searchParams.get('email');

  const [loading, setLoading] = useState(Boolean(token && email));
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [resendEmail, setResendEmail] = useState(email || '');

  useEffect(() => {
    if (token && email) {
      api.auth.verifyEmail({ token, email })
        .then(() => setSuccess(true))
        .catch((err) => setError(err instanceof ApiError ? err.message : 'Verifikasi email gagal.'))
        .finally(() => setLoading(false));
    }
  }, [token, email]);

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resendEmail) return;
    setResending(true);
    setError(null);
    try {
      await api.auth.resendVerification({ email: resendEmail });
      setResendSuccess(true);
    } catch {
      // generic success for anti-enumeration
      setResendSuccess(true);
    } finally {
      setResending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center space-y-4 py-8 text-center" aria-live="polite">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Memverifikasi alamat email Anda...</p>
      </div>
    );
  }

  if (success) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
          <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">Email Terverifikasi!</h1>
        <p className="text-sm text-muted-foreground">
          Email Anda berhasil diverifikasi. Silakan masuk ke akun Anda untuk melanjutkan.
        </p>
        <div className="pt-2">
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-xs transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Masuk ke Akun
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2 text-center">
        <h1 className="text-2xl font-bold text-foreground">Verifikasi Email</h1>
        <p className="text-sm text-muted-foreground">
          {error ? 'Tautan verifikasi tidak valid atau telah kedaluwarsa.' : 'Masukkan email Anda untuk menerima tautan verifikasi baru.'}
        </p>
      </header>

      {error ? (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {resendSuccess ? (
        <div role="status" className="rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success">
          Jika akun belum terverifikasi terdaftar dengan email tersebut, tautan verifikasi telah dikirimkan.
        </div>
      ) : (
        <form className="space-y-4" onSubmit={handleResend}>
          <div>
            <label htmlFor="resend_email" className="mb-1 block text-sm font-semibold text-foreground">
              Alamat email
            </label>
            <input
              id="resend_email"
              type="email"
              required
              disabled={resending}
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
              className="block min-h-11 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              placeholder="andi@perusahaan.com"
            />
          </div>

          <button
            type="submit"
            disabled={resending}
            className="flex min-h-11 w-full items-center justify-center rounded-md bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-xs transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {resending ? 'Sedang mengirim tautan...' : 'Kirim Ulang Tautan Verifikasi'}
          </button>
        </form>
      )}

      <footer className="text-center text-sm">
        <Link href="/login" className="font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Kembali ke Masuk
        </Link>
      </footer>
    </div>
  );
}

export default function VerifyEmailPage() {
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
          <VerifyEmailContent />
        </Suspense>
      </div>
    </main>
  );
}
