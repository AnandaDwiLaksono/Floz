'use client';

import React, { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
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
        .catch((err) => setError(err instanceof ApiError ? err.message : 'Verification failed.'))
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
      <div className="flex flex-col items-center justify-center space-y-4 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
        <p className="text-sm text-gray-600 dark:text-gray-300">Verifying your email address...</p>
      </div>
    );
  }

  if (success) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-300">
          ✓
        </div>
        <h1 className="text-2xl font-bold">Email Verified!</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Your email has been successfully verified. You can now sign in to your account.
        </p>
        <div className="pt-2">
          <Link href="/login" className="inline-block rounded bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700">
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2 text-center">
        <h1 className="text-2xl font-bold">Email Verification</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {error ? 'Your verification link is invalid or has expired.' : 'Enter your email to receive a new verification link.'}
        </p>
      </header>

      {error ? (
        <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {resendSuccess ? (
        <div role="status" className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
          If an unverified account exists with that email, a verification link has been sent.
        </div>
      ) : (
        <form className="space-y-4" onSubmit={handleResend}>
          <div>
            <label htmlFor="resend_email" className="mb-1 block text-sm font-medium">Email address</label>
            <input
              id="resend_email"
              type="email"
              required
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
              placeholder="andi@example.com"
            />
          </div>

          <button
            type="submit"
            disabled={resending}
            className="w-full rounded bg-blue-600 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {resending ? 'Sending link...' : 'Resend Verification Email'}
          </button>
        </form>
      )}

      <footer className="text-center text-sm text-gray-600 dark:text-gray-400">
        <Link href="/login" className="font-semibold text-blue-600 hover:underline dark:text-blue-400">
          Back to Sign In
        </Link>
      </footer>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10 dark:bg-gray-950">
      <div className="w-full max-w-md space-y-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto w-36"><BrandLogo /></div>
        <Suspense fallback={<div className="text-center">Loading...</div>}>
          <VerifyEmailContent />
        </Suspense>
      </div>
    </main>
  );
}
