'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '../../../../../lib/auth-context';
import { api, ApiError } from '../../../../../lib/api-client';
import { SettingsNav } from '../../../../../components/settings-nav';
import { User, Lock, CheckCircle2, AlertCircle } from 'lucide-react';

export default function ProfileSettingsPage() {
  const { workspaceId } = useParams() as { workspaceId: string };
  const { user, refetchUser } = useAuth();
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
      setProfileSuccess('Profil diperbarui.');
    } catch (err) {
      setProfileError(err instanceof ApiError ? err.message : 'Pembaruan gagal.');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) {
      setPwError('Kedua kolom wajib diisi.');
      return;
    }
    setPwError(null);
    setPwSuccess(null);
    setPwSaving(true);
    try {
      await api.auth.changePassword({ current_password: currentPassword, new_password: newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setPwSuccess('Kata sandi diubah.');
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : 'Gagal mengubah kata sandi.');
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <SettingsNav workspaceId={workspaceId} />

      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Pengaturan Akun & Profil</h1>
        <p className="text-sm text-muted-foreground">Kelola informasi profil, preferensi bahasa dan wilayah, serta kredensial login.</p>
      </div>

      <div className="bg-surface border border-border rounded-xl p-6 shadow-sm space-y-6">
        <div className="flex items-center space-x-4 pb-6 border-b border-border">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary border border-primary/20 text-2xl font-bold ring-4 ring-background">
            {user?.full_name?.charAt(0).toUpperCase() || 'U'}
          </div>
          <div>
            <p className="text-lg font-bold text-foreground">{user?.full_name || 'Pengguna Floz'}</p>
            <p className="text-sm text-muted-foreground">{user?.email}</p>
          </div>
        </div>

        <form onSubmit={handleProfileSave} className="space-y-5">
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-semibold text-foreground">Profil</h3>
          </div>

          {profileError && (
            <div role="alert" className="rounded-lg border border-danger/20 bg-danger/10 p-3.5 text-sm text-danger flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{profileError}</span>
            </div>
          )}
          {profileSuccess && (
            <div role="status" className="rounded-lg border border-success/20 bg-success/10 p-3.5 text-sm text-success flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>{profileSuccess}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="profile_email" className="mb-1.5 block text-sm font-medium text-foreground">
                Email
              </label>
              <input
                id="profile_email"
                type="email"
                value={user?.email ?? ''}
                readOnly
                className="w-full rounded-lg border border-border px-3.5 py-2.5 bg-muted/60 text-muted-foreground cursor-not-allowed text-sm focus:outline-none"
              />
              <p className="text-xs text-muted-foreground mt-1">Email utama dikelola oleh administrator.</p>
            </div>

            <div>
              <label htmlFor="profile_name" className="mb-1.5 block text-sm font-medium text-foreground">
                Nama lengkap
              </label>
              <input
                id="profile_name"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-lg border border-border px-3.5 py-2.5 bg-surface text-foreground text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              />
            </div>

            <div>
              <label htmlFor="profile_timezone" className="mb-1.5 block text-sm font-medium text-foreground">
                Zona waktu
              </label>
              <input
                id="profile_timezone"
                type="text"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="Asia/Jakarta"
                className="w-full rounded-lg border border-border px-3.5 py-2.5 bg-surface text-foreground text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              />
            </div>

            <div>
              <label htmlFor="profile_locale" className="mb-1.5 block text-sm font-medium text-foreground">
                Bahasa & wilayah
              </label>
              <select
                id="profile_locale"
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
                className="w-full rounded-lg border border-border px-3.5 py-2.5 bg-surface text-foreground text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                <option value="id-ID">id-ID (Bahasa Indonesia)</option>
                <option value="en-US">en-US (Bahasa Inggris)</option>
              </select>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition shadow-sm disabled:opacity-50"
            >
              {saving ? 'Menyimpan...' : 'Simpan profil'}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-surface border border-border rounded-xl p-6 shadow-sm space-y-5">
        <form onSubmit={handleChangePassword} className="space-y-5">
          <div className="flex items-center gap-2">
            <Lock className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-semibold text-foreground">Ubah Kata Sandi</h3>
          </div>

          {pwError && (
            <div role="alert" className="rounded-lg border border-danger/20 bg-danger/10 p-3.5 text-sm text-danger flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{pwError}</span>
            </div>
          )}
          {pwSuccess && (
            <div role="status" className="rounded-lg border border-success/20 bg-success/10 p-3.5 text-sm text-success flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>{pwSuccess}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="pw_current" className="mb-1.5 block text-sm font-medium text-foreground">
                Kata sandi saat ini
              </label>
              <input
                id="pw_current"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full rounded-lg border border-border px-3.5 py-2.5 bg-surface text-foreground text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              />
            </div>
            <div>
              <label htmlFor="pw_new" className="mb-1.5 block text-sm font-medium text-foreground">
                Kata sandi baru
              </label>
              <input
                id="pw_new"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-lg border border-border px-3.5 py-2.5 bg-surface text-foreground text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={pwSaving}
              className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition shadow-sm disabled:opacity-50"
            >
              {pwSaving ? 'Menyimpan...' : 'Ubah kata sandi'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
