'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth-context';
import { api, ApiError } from '../lib/api-client';
import { useRouter } from 'next/navigation';

export default function RootPage() {
  const { user, activeWorkspace, loading, logout, refetchUser } = useAuth();
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading) {
      if (!user) router.push('/login');
      else if (activeWorkspace) router.push(`/workspaces/${activeWorkspace.id}/tasks`);
      else if (user.workspaces && user.workspaces.length > 0) router.push(`/workspaces/${user.workspaces[0].id}/tasks`);
    }
  }, [user, activeWorkspace, loading, router]);

  if (loading || !user) {
    return <div className="flex items-center justify-center min-h-[300px]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  }

  if (activeWorkspace || (user.workspaces && user.workspaces.length > 0)) {
    return <div className="flex items-center justify-center min-h-[300px]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) {
      setError('Current password and new password are required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await api.auth.changePassword({ current_password: currentPassword, new_password: newPassword });
      await refetchUser();
      setCurrentPassword('');
      setNewPassword('');
      setSuccess('Password changed.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Password change failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10 dark:bg-gray-950">
      <div className="mx-auto max-w-lg space-y-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold">No workspace access yet</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300">You can sign in, change your password, or log out. Workspace access must be granted by an administrator.</p>
        </header>

        <section className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
          <p className="text-sm"><strong>Email:</strong> {user.email}</p>
          <p className="text-sm"><strong>Name:</strong> {user.full_name}</p>
        </section>

        <form className="space-y-4" onSubmit={handleChangePassword}>
          <h2 className="text-lg font-semibold">Change Password</h2>
          {error ? <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
          {success ? <div role="status" className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-700">{success}</div> : null}
          <div>
            <label htmlFor="current_password" className="mb-1 block text-sm font-medium">Current password</label>
            <input id="current_password" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="w-full rounded border px-3 py-2 dark:bg-gray-800" />
          </div>
          <div>
            <label htmlFor="new_password" className="mb-1 block text-sm font-medium">New password</label>
            <input id="new_password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full rounded border px-3 py-2 dark:bg-gray-800" />
          </div>
          <button type="submit" disabled={submitting} className="rounded bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{submitting ? 'Saving...' : 'Change Password'}</button>
        </form>

        <div className="flex gap-3">
          <button type="button" onClick={() => document.getElementById('current_password')?.focus()} className="rounded border px-4 py-2 text-sm font-medium">Change Password</button>
          <button type="button" onClick={() => void logout()} className="rounded border px-4 py-2 text-sm font-medium">Log out</button>
        </div>
      </div>
    </main>
  );
}
