'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '../../../../../lib/auth-context';
import { api, ApiError, WorkspaceMember } from '../../../../../lib/api-client';
import { SettingsNav } from '../../../../../components/settings-nav';
import { Search, UserPlus, UserCheck, Mail, Loader2, AlertCircle } from 'lucide-react';

export default function MembersSettingsPage() {
  const { workspaceId } = useParams() as { workspaceId: string };
  const { activeWorkspace, workspaceResolving } = useAuth();
  const isAdmin = !workspaceResolving && activeWorkspace?.id === workspaceId && activeWorkspace.role === 'ADMIN';

  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [provEmail, setProvEmail] = useState('');
  const [provName, setProvName] = useState('');
  const [provError, setProvError] = useState<string | null>(null);
  const [provSaving, setProvSaving] = useState(false);
  const [tempPassword, setTempPassword] = useState('');

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('MEMBER');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSaving, setInviteSaving] = useState(false);
  const [invitations, setInvitations] = useState<Array<{ id: string; email: string; roleCode?: string; status: string; expiresAt?: string }>>([]);

  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState('MEMBER');
  const [addError, setAddError] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);
  const [mutError, setMutError] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    try {
      const [membersRes, invitationsRes] = await Promise.all([
        api.workspaces.members(workspaceId),
        api.invitations.list(workspaceId),
      ]);
      setMembers(membersRes.data);
      setInvitations(invitationsRes.data as typeof invitations);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (isAdmin) void loadMembers();
  }, [isAdmin, loadMembers]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError(null);
    setInviteSaving(true);
    try {
      await api.invitations.create(workspaceId, { email: inviteEmail.trim(), role: inviteRole });
      setInviteOpen(false);
      setInviteEmail('');
      setInviteRole('MEMBER');
      await loadMembers();
    } catch (err) {
      setInviteError(err instanceof ApiError ? err.message : 'Invitation failed.');
    } finally {
      setInviteSaving(false);
    }
  };

  const handleInvitationAction = async (action: 'resend' | 'revoke', id: string) => {
    try {
      await api.invitations[action](workspaceId, id);
      await loadMembers();
    } catch (err) {
      setMutError(err instanceof ApiError ? err.message : 'Invitation update failed.');
    }
  };

  const handleProvision = async (e: React.FormEvent) => {
    e.preventDefault();
    setProvError(null);
    setProvSaving(true);
    try {
      const res = await api.workspaces.provisionAccount(workspaceId, { email: provEmail, full_name: provName });
      setTempPassword(res.data.temporary_password);
      setProvEmail('');
      setProvName('');
      await loadMembers();
    } catch (err) {
      setProvError(err instanceof ApiError ? err.message : 'Provisioning failed.');
    } finally {
      setProvSaving(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    setAddSaving(true);
    try {
      const userRes = await api.workspaces.lookupUser(workspaceId, addEmail.trim());
      await api.workspaces.addMember(workspaceId, { user_id: userRes.data.id, role: addRole, status: 'ACTIVE' });
      setAddOpen(false);
      setAddEmail('');
      setAddRole('MEMBER');
      await loadMembers();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setAddError('User not found. Provision an account first.');
      } else {
        setAddError(err instanceof ApiError ? err.message : 'Add failed.');
      }
    } finally {
      setAddSaving(false);
    }
  };

  const handlePatch = async (userId: string, body: { role?: string; status?: string }) => {
    setMutError(null);
    try {
      await api.workspaces.patchMember(workspaceId, userId, body);
      await loadMembers();
    } catch (err) {
      setMutError(err instanceof ApiError ? err.message : 'Update failed.');
    }
  };

  if (!isAdmin) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <SettingsNav workspaceId={workspaceId} />
        <div className="p-8 text-center text-destructive font-semibold bg-destructive/10 border border-destructive/20 rounded-xl">
          Akses ditolak. Khusus admin.
        </div>
      </div>
    );
  }

  const filtered = members.filter((m) => {
    const q = search.toLowerCase();
    return !q || (m.full_name || '').toLowerCase().includes(q) || (m.email || '').toLowerCase().includes(q);
  });

  const pendingInvitations = invitations.filter((inv) => inv.status === 'PENDING');

  return (
    <div className="max-w-4xl mx-auto space-y-6 px-4 sm:px-6 pb-12">
      <SettingsNav workspaceId={workspaceId} />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Anggota & Akses</h1>
          <p className="text-sm text-muted-foreground">Kelola akun, peran, status akses, dan undangan ruang kerja.</p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
          <button
            onClick={() => {
              setInviteOpen(true);
              setInviteError(null);
            }}
            className="px-4 py-2 text-sm font-semibold text-primary-foreground bg-primary hover:bg-primary/90 rounded-lg transition shadow-sm inline-flex items-center gap-1.5"
          >
            <Mail className="w-4 h-4" />
            Undang anggota
          </button>
          <button
            onClick={() => {
              setProvisionOpen(true);
              setTempPassword('');
              setProvError(null);
            }}
            className="px-4 py-2 text-sm font-medium text-foreground bg-surface border border-input hover:bg-muted rounded-lg transition inline-flex items-center gap-1.5"
          >
            <UserPlus className="w-4 h-4" />
            Buat akun
          </button>
          <button
            onClick={() => {
              setAddOpen(true);
              setAddError(null);
            }}
            className="px-4 py-2 text-sm font-medium text-foreground bg-surface border border-input hover:bg-muted rounded-lg transition inline-flex items-center gap-1.5"
          >
            <UserCheck className="w-4 h-4" />
            Tambah anggota yang sudah terdaftar
          </button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3.5 top-3 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Cari nama atau email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 pr-4 py-2.5 text-sm border border-input rounded-xl w-full bg-surface text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring shadow-sm"
        />
      </div>

      {mutError && (
        <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{mutError}</span>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16 bg-surface border border-border rounded-xl">
          <Loader2 className="animate-spin h-8 w-8 text-primary" />
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-hidden shadow-sm">
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/50 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3.5">Nama</th>
                  <th className="px-5 py-3.5">Email</th>
                  <th className="px-5 py-3.5">Peran</th>
                  <th className="px-5 py-3.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((m) => (
                  <tr key={m.user_id} className="transition-colors hover:bg-muted/30">
                    <td className="px-5 py-3.5 font-medium text-foreground">{m.full_name || m.user_id}</td>
                    <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">{m.email}</td>
                    <td className="px-5 py-3.5">
                      <select
                        aria-label={`Role for ${m.email}`}
                        value={m.role}
                        onChange={(e) => handlePatch(m.user_id, { role: e.target.value })}
                        className="rounded-lg border border-input bg-surface px-2.5 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="ADMIN">Admin</option>
                        <option value="MANAGER">Manajer</option>
                        <option value="MEMBER">Anggota</option>
                        <option value="FIELD_WORKER">Petugas lapangan</option>
                      </select>
                    </td>
                    <td className="px-5 py-3.5">
                      <select
                        aria-label={`Status for ${m.email}`}
                        value={m.status}
                        onChange={(e) => handlePatch(m.user_id, { status: e.target.value })}
                        className="rounded-lg border border-input bg-surface px-2.5 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="ACTIVE">Aktif</option>
                        <option value="INVITED">Diundang</option>
                        <option value="SUSPENDED">Ditangguhkan</option>
                        <option value="REMOVED">Dikeluarkan</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-border sm:hidden">
            {filtered.map((m) => (
              <article key={m.user_id} className="space-y-3 p-4">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{m.full_name || m.user_id}</p>
                  <p className="break-all text-xs text-muted-foreground">{m.email}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1 text-xs font-medium text-muted-foreground">
                    <span>Peran</span>
                    <select
                      aria-label={`Role for ${m.email}`}
                      value={m.role}
                      onChange={(e) => handlePatch(m.user_id, { role: e.target.value })}
                      className="min-h-11 w-full rounded-lg border border-input bg-surface px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="ADMIN">Admin</option>
                      <option value="MANAGER">Manajer</option>
                      <option value="MEMBER">Anggota</option>
                      <option value="FIELD_WORKER">Petugas lapangan</option>
                    </select>
                  </label>
                  <label className="space-y-1 text-xs font-medium text-muted-foreground">
                    <span>Status</span>
                    <select
                      aria-label={`Status for ${m.email}`}
                      value={m.status}
                      onChange={(e) => handlePatch(m.user_id, { status: e.target.value })}
                      className="min-h-11 w-full rounded-lg border border-input bg-surface px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="ACTIVE">Aktif</option>
                      <option value="INVITED">Diundang</option>
                      <option value="SUSPENDED">Ditangguhkan</option>
                      <option value="REMOVED">Dikeluarkan</option>
                    </select>
                  </label>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      <section className="space-y-3 pt-4">
        <h3 className="text-lg font-bold text-foreground">Undangan tertunda</h3>
        <div className="rounded-xl border border-border bg-surface overflow-hidden shadow-sm">
          {pendingInvitations.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">Belum ada undangan tertunda.</p>
          ) : (
            pendingInvitations.map((invitation) => (
              <div
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4 last:border-b-0 hover:bg-muted/20 transition-colors"
              >
                <div>
                  <p className="font-medium text-foreground">{invitation.email}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {invitation.roleCode} · {invitation.status}
                    {invitation.expiresAt ? ` · Berakhir ${new Date(invitation.expiresAt).toLocaleDateString()}` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    aria-label={`Resend ${invitation.email}`}
                    onClick={() => void handleInvitationAction('resend', invitation.id)}
                    className="rounded-lg border border-input bg-surface px-3 py-1.5 text-xs font-medium hover:bg-muted transition"
                  >
                    Kirim ulang
                  </button>
                  <button
                    aria-label={`Revoke ${invitation.email}`}
                    onClick={() => void handleInvitationAction('revoke', invitation.id)}
                    className="rounded-lg border border-destructive/30 bg-destructive/5 text-destructive px-3 py-1.5 text-xs font-medium hover:bg-destructive/10 transition"
                  >
                    Cabut
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {inviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-overlay backdrop-blur-sm" onClick={() => setInviteOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Invite Member"
            className="relative w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl space-y-4"
          >
            <form onSubmit={handleInvite} className="space-y-4">
              <h3 className="text-lg font-bold text-foreground">Undang anggota</h3>
              {inviteError && (
                <div role="alert" className="p-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg">
                  {inviteError}
                </div>
              )}
              <div>
                <label htmlFor="invite_email" className="mb-1.5 block text-sm font-medium text-foreground">
                  Email
                </label>
                <input
                  id="invite_email"
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full rounded-lg border border-input px-3.5 py-2 text-sm bg-surface text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div>
                <label htmlFor="invite_role" className="mb-1.5 block text-sm font-medium text-foreground">
                  Peran
                </label>
                <select
                  id="invite_role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="w-full rounded-lg border border-input px-3.5 py-2 text-sm bg-surface text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="ADMIN">Admin</option>
                  <option value="MANAGER">Manajer</option>
                  <option value="MEMBER">Anggota</option>
                  <option value="FIELD_WORKER">Petugas lapangan</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setInviteOpen(false)}
                  className="rounded-lg border border-input px-4 py-2 text-sm font-medium hover:bg-muted transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={inviteSaving}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition disabled:opacity-50"
                >
                  {inviteSaving ? 'Mengundang...' : 'Undang'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {provisionOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-overlay backdrop-blur-sm"
            onClick={() => {
              setProvisionOpen(false);
              setTempPassword('');
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Provision Account"
            className="relative w-full max-w-md bg-surface border border-border p-6 rounded-xl shadow-xl space-y-4"
          >
            {tempPassword ? (
              <div className="space-y-4">
                <h3 className="text-lg font-bold text-foreground">Akun dibuat</h3>
                <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-sm text-amber-800 dark:text-amber-200 font-medium">
                  Salin kata sandi sekarang. Kata sandi tidak akan ditampilkan lagi.
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={tempPassword}
                    className="flex-1 rounded-lg border border-input px-3.5 py-2 text-sm font-mono bg-muted text-foreground"
                  />
                  <button
                    onClick={() => navigator.clipboard.writeText(tempPassword)}
                    className="px-3.5 py-2 text-sm font-bold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition"
                  >
                    Salin
                  </button>
                </div>
                <button
                  onClick={() => {
                    setProvisionOpen(false);
                    setTempPassword('');
                  }}
                  className="w-full py-2 text-sm font-medium border border-input rounded-lg hover:bg-muted transition"
                >
                  Tutup
                </button>
              </div>
            ) : (
              <form onSubmit={handleProvision} className="space-y-4">
                <h3 className="text-lg font-bold text-foreground">Buat akun</h3>
                {provError && (
                  <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                    {provError}
                  </div>
                )}
                <div>
                  <label htmlFor="prov_email" className="mb-1.5 block text-sm font-medium text-foreground">
                    Email
                  </label>
                  <input
                    id="prov_email"
                    type="email"
                    required
                    value={provEmail}
                    onChange={(e) => setProvEmail(e.target.value)}
                    className="w-full rounded-lg border border-input px-3.5 py-2 text-sm bg-surface text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div>
                  <label htmlFor="prov_name" className="mb-1.5 block text-sm font-medium text-foreground">
                    Nama lengkap
                  </label>
                  <input
                    id="prov_name"
                    type="text"
                    required
                    value={provName}
                    onChange={(e) => setProvName(e.target.value)}
                    className="w-full rounded-lg border border-input px-3.5 py-2 text-sm bg-surface text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setProvisionOpen(false)}
                    className="px-4 py-2 text-sm border border-input rounded-lg hover:bg-muted transition font-medium"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={provSaving}
                    className="px-4 py-2 text-sm font-bold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition disabled:opacity-50"
                  >
                    {provSaving ? 'Membuat...' : 'Buat'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-overlay backdrop-blur-sm" onClick={() => setAddOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Add Member"
            className="relative w-full max-w-md bg-surface border border-border p-6 rounded-xl shadow-xl space-y-4"
          >
            <form onSubmit={handleAdd} className="space-y-4">
              <h3 className="text-lg font-bold text-foreground">Tambah anggota yang sudah terdaftar</h3>
              {addError && (
                <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                  {addError}
                </div>
              )}
              <div>
                <label htmlFor="add_email" className="mb-1.5 block text-sm font-medium text-foreground">
                  Email
                </label>
                <input
                  id="add_email"
                  type="email"
                  required
                  value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value)}
                  className="w-full rounded-lg border border-input px-3.5 py-2 text-sm bg-surface text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div>
                <label htmlFor="add_role" className="mb-1.5 block text-sm font-medium text-foreground">
                  Peran
                </label>
                <select
                  id="add_role"
                  value={addRole}
                  onChange={(e) => setAddRole(e.target.value)}
                  className="w-full rounded-lg border border-input px-3.5 py-2 text-sm bg-surface text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="ADMIN">Admin</option>
                  <option value="MANAGER">Manajer</option>
                  <option value="MEMBER">Anggota</option>
                  <option value="FIELD_WORKER">Petugas lapangan</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAddOpen(false)}
                  className="px-4 py-2 text-sm border border-input rounded-lg hover:bg-muted transition font-medium"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={addSaving}
                  className="px-4 py-2 text-sm font-bold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition disabled:opacity-50"
                >
                  {addSaving ? 'Menambahkan...' : 'Tambah'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
