'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../../../../lib/auth-context';
import { api, ApiError } from '../../../../../lib/api-client';

export default function ProfileSettingsPage() {
  const { workspaceId } = useParams() as { workspaceId: string };
  const { user, activeWorkspace, refetchUser } = useAuth();
  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [timezone, setTimezone] = useState(user?.timezone ?? '');
  const [locale, setLocale] = useState(user?.locale ?? '');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState<string | null>(null);
  const [pwSaving, setPwSaving] = useState(false);

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    setProfileSuccess(null);
    setSaving(true);
    try {
      await api.auth.updateProfile({ full_name: fullName, timezone, locale });
      await refetchUser();
      setProfileSuccess('Profile updated.');
    } catch (err) {
      setProfileError(err instanceof ApiError ? err.message : 'Update failed.');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) { setPwError('Both fields are required.'); return; }
    setPwError(null);
    setPwSuccess(null);
    setPwSaving(true);
    try {
      await api.auth.changePassword({ current_password: currentPassword, new_password: newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setPwSuccess('Password changed.');
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : 'Password change failed.');
    } finally {
      setPwSaving(false);
    }
  };

  const isAdmin = activeWorkspace?.role === 'ADMIN';

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-800 pb-3">
        <Link href={`/workspaces/${workspaceId}/settings/profile`} className="px-3 py-1.5 text-sm font-semibold rounded bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">Profile</Link>
        {isAdmin && <Link href={`/workspaces/${workspaceId}/settings/workspace`} className="px-3 py-1.5 text-sm font-medium rounded hover:bg-gray-100 dark:hover:bg-gray-800">Workspace</Link>}
        {isAdmin && <Link href={`/workspaces/${workspaceId}/settings/members`} className="px-3 py-1.5 text-sm font-medium rounded hover:bg-gray-100 dark:hover:bg-gray-800">Members</Link>}
        {isAdmin && <Link href={`/workspaces/${workspaceId}/settings/teams`} className="px-3 py-1.5 text-sm font-medium rounded hover:bg-gray-100 dark:hover:bg-gray-800">Teams</Link>}
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 space-y-6">
        <div className="flex items-center space-x-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-600 text-white text-2xl font-bold">
            {user?.full_name?.charAt(0).toUpperCase() || 'U'}
          </div>
          <div>
            <p className="text-lg font-bold">{user?.full_name}</p>
            <p className="text-sm text-gray-500">{user?.email}</p>
          </div>
        </div>

        <form onSubmit={handleProfileSave} className="space-y-4">
          <h3 className="text-lg font-semibold">Profile</h3>
          {profileError && <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{profileError}</div>}
          {profileSuccess && <div role="status" className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-700">{profileSuccess}</div>}
          <div>
            <label htmlFor="profile_email" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Email</label>
            <input id="profile_email" type="email" value={user?.email ?? ''} readOnly className="w-full rounded border px-3 py-2 bg-gray-100 dark:bg-gray-800 text-gray-500 cursor-not-allowed" />
          </div>
          <div>
            <label htmlFor="profile_name" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Full name</label>
            <input id="profile_name" type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full rounded border px-3 py-2 dark:bg-gray-800" />
          </div>
          <div>
            <label htmlFor="profile_timezone" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Timezone</label>
            <input id="profile_timezone" type="text" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Asia/Jakarta" className="w-full rounded border px-3 py-2 dark:bg-gray-800" />
          </div>
          <div>
            <label htmlFor="profile_locale" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Locale</label>
            <select id="profile_locale" value={locale} onChange={(e) => setLocale(e.target.value)} className="w-full rounded border px-3 py-2 dark:bg-gray-800">
              <option value="id-ID">id-ID</option>
              <option value="en-US">en-US</option>
            </select>
          </div>
          <button type="submit" disabled={saving} className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving...' : 'Save Profile'}</button>
        </form>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
        <form onSubmit={handleChangePassword} className="space-y-4">
          <h3 className="text-lg font-semibold">Change Password</h3>
          {pwError && <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{pwError}</div>}
          {pwSuccess && <div role="status" className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-700">{pwSuccess}</div>}
          <div>
            <label htmlFor="pw_current" className="mb-1 block text-sm font-medium">Current password</label>
            <input id="pw_current" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="w-full rounded border px-3 py-2 dark:bg-gray-800" />
          </div>
          <div>
            <label htmlFor="pw_new" className="mb-1 block text-sm font-medium">New password</label>
            <input id="pw_new" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full rounded border px-3 py-2 dark:bg-gray-800" />
          </div>
          <button type="submit" disabled={pwSaving} className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{pwSaving ? 'Saving...' : 'Change Password'}</button>
        </form>
      </div>
    </div>
  );
}
