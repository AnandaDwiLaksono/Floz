'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth-context';
import { api, ApiError } from '../../lib/api-client';

export default function OnboardingPage() {
  const { user, loading, logout, refetchUser } = useAuth();
  const router = useRouter();
  const [resending, setResending] = useState(false);
  const [resendStatus, setResendStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
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
      setResendStatus('Verification email sent. Please check your inbox.');
    } catch (err) {
      setResendStatus('Failed to send verification email.');
    } finally {
      setResending(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-12 dark:bg-gray-950">
      <div className="mx-auto max-w-2xl space-y-8">
        <header className="space-y-2 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Welcome to Floz, {user.full_name}!</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Let&apos;s get you started. You can create your own workspace, join an existing team, or view pending invitations.
          </p>
        </header>

        {!isVerified && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">Verify your email address</p>
                <p className="text-sm">Please verify your email to create or join workspaces.</p>
              </div>
              <button
                onClick={handleResend}
                disabled={resending}
                className="rounded bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {resending ? 'Sending...' : 'Resend Email'}
              </button>
            </div>
            {resendStatus && <p className="mt-2 text-xs font-medium">{resendStatus}</p>}
          </div>
        )}

        <div className="grid gap-6 sm:grid-cols-2">
          {/* Card 1: Create Workspace */}
          <div className="flex flex-col justify-between rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="space-y-2">
              <div className="text-2xl">🏢</div>
              <h2 className="text-xl font-bold">Create Workspace</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Start a fresh workspace for your team or organization. You&apos;ll be the Workspace Admin.
              </p>
            </div>
            <div className="pt-6">
              <Link
                href={isVerified ? '/onboarding/create-workspace' : '#'}
                className={`block w-full rounded py-2.5 text-center text-sm font-semibold text-white transition ${
                  isVerified ? 'bg-blue-600 hover:bg-blue-700' : 'cursor-not-allowed bg-gray-400'
                }`}
              >
                Create Workspace
              </Link>
            </div>
          </div>

          {/* Card 2: Join Workspace */}
          <div className="flex flex-col justify-between rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="space-y-2">
              <div className="text-2xl">🔗</div>
              <h2 className="text-xl font-bold">Join Workspace</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Join an existing workspace using a Join Code, Join Link, or exact Workspace ID.
              </p>
            </div>
            <div className="pt-6">
              <Link
                href={isVerified ? '/join' : '#'}
                className={`block w-full rounded border border-gray-300 py-2.5 text-center text-sm font-semibold transition dark:border-gray-700 ${
                  isVerified ? 'hover:bg-gray-100 dark:hover:bg-gray-800' : 'cursor-not-allowed opacity-50'
                }`}
              >
                Join with Code or ID
              </Link>
            </div>
          </div>
        </div>

        <div className="flex justify-center gap-4 text-sm text-gray-600 dark:text-gray-400">
          <button onClick={() => void logout()} className="hover:underline">
            Sign out
          </button>
        </div>
      </div>
    </main>
  );
}
