'use client';

import React, { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
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
        .catch((err) => setError(err instanceof ApiError ? err.message : 'Invalid or expired invitation token.'))
        .finally(() => setLoading(false));
    } else {
      setError('No invitation token provided.');
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
      setError(err instanceof ApiError ? err.message : 'Failed to accept invitation.');
    } finally {
      setAccepting(false);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="flex flex-col items-center justify-center space-y-4 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
        <p className="text-sm text-gray-600 dark:text-gray-300">Loading invitation details...</p>
      </div>
    );
  }

  if (error || !preview) {
    return (
      <div className="space-y-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300">
          ⚠️
        </div>
        <h1 className="text-2xl font-bold">Invitation Error</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {error || 'Could not load invitation.'}
        </p>
        <div className="pt-2">
          <Link href="/login" className="inline-block rounded bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700">
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  const isEmailMatch = user && user.email.toLowerCase() === preview.invited_email.toLowerCase();

  return (
    <div className="space-y-6">
      <header className="space-y-2 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-2xl dark:bg-blue-900">
          🏢
        </div>
        <h1 className="text-2xl font-bold">You&apos;re invited!</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          You have been invited to join <strong className="text-gray-900 dark:text-white">{preview.workspace_name}</strong> as <span className="font-semibold text-blue-600 dark:text-blue-400">{preview.role}</span>.
        </p>
      </header>

      {!user ? (
        <div className="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-center dark:border-gray-800 dark:bg-gray-800/50">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            To accept this invitation, please sign in or register with <strong>{preview.invited_email}</strong>.
          </p>
          <div className="flex gap-3 pt-2">
            <Link href={`/login?redirect=/invitations/accept?token=${token}`} className="flex-1 rounded bg-blue-600 py-2 text-center text-sm font-semibold text-white hover:bg-blue-700">
              Sign In
            </Link>
            <Link href={`/register?email=${encodeURIComponent(preview.invited_email)}`} className="flex-1 rounded border border-gray-300 py-2 text-center text-sm font-semibold transition hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800">
              Register
            </Link>
          </div>
        </div>
      ) : !isEmailMatch ? (
        <div role="alert" className="rounded border border-amber-300 bg-amber-50 p-4 text-center text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          You are currently logged in as <strong>{user.email}</strong>, but this invitation was sent to <strong>{preview.invited_email}</strong>. Please switch accounts to accept.
        </div>
      ) : (
        <div className="space-y-4">
          <button
            onClick={handleAccept}
            disabled={accepting}
            className="w-full rounded bg-blue-600 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {accepting ? 'Joining workspace...' : `Accept & Join ${preview.workspace_name}`}
          </button>
        </div>
      )}
    </div>
  );
}

export default function AcceptInvitationPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10 dark:bg-gray-950">
      <div className="w-full max-w-md space-y-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto w-36"><BrandLogo /></div>
        <Suspense fallback={<div className="text-center">Loading...</div>}>
          <AcceptInvitationContent />
        </Suspense>
      </div>
    </main>
  );
}
