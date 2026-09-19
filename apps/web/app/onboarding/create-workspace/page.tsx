'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth-context';
import { api, ApiError } from '../../../lib/api-client';

export default function CreateWorkspacePage() {
  const router = useRouter();
  const { refetchUser } = useAuth();
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jakarta'
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Workspace name is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.workspaces.create({ name: name.trim(), timezone });
      await refetchUser();
      router.push(`/workspaces/${res.data.id}/tasks`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create workspace.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10 dark:bg-gray-950">
      <div className="w-full max-w-md space-y-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <header className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">Create New Workspace</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Set up your organization or team space.
          </p>
        </header>

        {error ? (
          <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="ws_name" className="mb-1 block text-sm font-medium">
              Workspace Name
            </label>
            <input
              id="ws_name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
              placeholder="e.g. Acme Corporation"
            />
          </div>

          <div>
            <label htmlFor="ws_tz" className="mb-1 block text-sm font-medium">
              Timezone
            </label>
            <input
              id="ws_tz"
              type="text"
              required
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded bg-blue-600 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Creating workspace...' : 'Create Workspace'}
          </button>
        </form>

        <footer className="text-center text-sm">
          <Link href="/onboarding" className="text-gray-600 hover:underline dark:text-gray-400">
            Back to Onboarding
          </Link>
        </footer>
      </div>
    </main>
  );
}
