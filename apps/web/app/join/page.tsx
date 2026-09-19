'use client';

import React, { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth-context';
import { api, ApiError } from '../../lib/api-client';

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
      setError(err instanceof ApiError ? err.message : 'Invalid code or workspace ID.');
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
      setSuccess('Successfully joined workspace!');
      router.push(`/workspaces/${res.data.workspace_id}/tasks`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to join workspace.');
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
      setSuccess('Join request submitted! Please wait for a workspace administrator to approve.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit join request.');
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return <div className="text-center">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2 text-center">
        <h1 className="text-2xl font-bold">Join a Workspace</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Enter a Join Code (e.g. FLOZ-XXXX-XXXX-XXXX) or exact Workspace ID.
        </p>
      </header>

      {error ? (
        <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {success ? (
        <div role="status" className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
          {success}
        </div>
      ) : null}

      <div className="space-y-4">
        <div>
          <label htmlFor="join_input" className="mb-1 block text-sm font-medium">Join Code or Workspace ID</label>
          <div className="flex gap-2">
            <input
              id="join_input"
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
              placeholder="FLOZ-XXXX-XXXX-XXXX"
            />
            <button
              onClick={() => handlePreview(inputVal)}
              disabled={loading || !inputVal.trim()}
              className="rounded border border-gray-300 px-4 py-2 text-sm font-semibold transition hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              {loading ? 'Checking...' : 'Check'}
            </button>
          </div>
        </div>

        {preview && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3 dark:border-gray-800 dark:bg-gray-800/50">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Workspace</p>
              <p className="text-lg font-bold text-gray-900 dark:text-white">{preview.workspace_name}</p>
            </div>

            {preview.action === 'JOIN' && (
              <button
                onClick={handleJoin}
                disabled={submitting || !user}
                className="w-full rounded bg-blue-600 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? 'Joining...' : !user ? 'Please Sign In to Join' : `Join as Member`}
              </button>
            )}

            {preview.action === 'REQUEST_APPROVAL' && (
              <button
                onClick={handleRequestApproval}
                disabled={submitting || !user}
                className="w-full rounded bg-blue-600 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? 'Submitting request...' : !user ? 'Please Sign In to Request' : 'Request to Join'}
              </button>
            )}

            {preview.action === 'JOIN_CODE_REQUIRED' && (
              <p className="text-sm text-amber-700 dark:text-amber-300">
                This workspace requires a valid Join Code. Please enter the full code above.
              </p>
            )}

            {preview.action === 'INVITATION_REQUIRED' && (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                This workspace is invitation-only. Please contact a workspace administrator for an invitation.
              </p>
            )}
          </div>
        )}
      </div>

      <footer className="text-center text-sm">
        <Link href="/onboarding" className="text-gray-600 hover:underline dark:text-gray-400">
          Back to Onboarding
        </Link>
      </footer>
    </div>
  );
}

export default function JoinPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10 dark:bg-gray-950">
      <div className="w-full max-w-md space-y-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <Suspense fallback={<div className="text-center">Loading...</div>}>
          <JoinContent />
        </Suspense>
      </div>
    </main>
  );
}
