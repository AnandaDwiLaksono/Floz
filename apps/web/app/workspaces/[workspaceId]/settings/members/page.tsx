'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../../../../lib/auth-context';
import { api, ApiError, WorkspaceMember } from '../../../../../lib/api-client';
import { Search } from 'lucide-react';

export default function MembersSettingsPage() {
  const { workspaceId } = useParams() as { workspaceId: string };
  const { activeWorkspace } = useAuth();
  const isAdmin = activeWorkspace?.role === 'ADMIN';
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [provEmail, setProvEmail] = useState('');
  const [provName, setProvName] = useState('');
  const [provError, setProvError] = useState<string | null>(null);
  const [provSaving, setProvSaving] = useState(false);
  const [tempPassword, setTempPassword] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState('MEMBER');
  const [addError, setAddError] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);
  const [mutError, setMutError] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    try {
      const res = await api.workspaces.members(workspaceId);
      setMembers(res.data);
    } finally { setLoading(false); }
  }, [workspaceId]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  if (!isAdmin) return <div className="p-6 text-center text-red-600 font-semibold">Access denied. Admin only.</div>;

  const filtered = members.filter((m) => {
    const q = search.toLowerCase();
    return !q || (m.full_name || '').toLowerCase().includes(q) || (m.email || '').toLowerCase().includes(q);
  });

  const handleProvision = async (e: React.FormEvent) => {
    e.preventDefault();
    setProvError(null);
    setProvSaving(true);
    try {
      const res = await api.workspaces.provisionAccount(workspaceId, { email: provEmail, full_name: provName });
      setTempPassword(res.data.temporary_password);
      setProvEmail('');
      setProvName('');
      loadMembers();
    } catch (err) {
      setProvError(err instanceof ApiError ? err.message : 'Provisioning failed.');
    } finally { setProvSaving(false); }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    setAddSaving(true);
    try {
      const userRes = await api.workspaces.members(workspaceId);
      const found = userRes.data.find((m) => m.email === addEmail);
      if (!found) { setAddError('User not found. Provision an account first.'); setAddSaving(false); return; }
      await api.workspaces.addMember(workspaceId, { user_id: found.user_id, role: addRole, status: 'INVITED' });
      setAddOpen(false);
      setAddEmail('');
      setAddRole('MEMBER');
      loadMembers();
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : 'Add failed.');
    } finally { setAddSaving(false); }
  };

  const handlePatch = async (userId: string, body: { role?: string; status?: string }) => {
    setMutError(null);
    try {
      await api.workspaces.patchMember(workspaceId, userId, body);
      loadMembers();
    } catch (err) {
      setMutError(err instanceof ApiError ? err.message : 'Update failed.');
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-800 pb-3">
        <Link href={`/workspaces/${workspaceId}/settings/profile`} className="px-3 py-1.5 text-sm font-medium rounded hover:bg-gray-100 dark:hover:bg-gray-800">Profile</Link>
        <Link href={`/workspaces/${workspaceId}/settings/workspace`} className="px-3 py-1.5 text-sm font-medium rounded hover:bg-gray-100 dark:hover:bg-gray-800">Workspace</Link>
        <Link href={`/workspaces/${workspaceId}/settings/members`} className="px-3 py-1.5 text-sm font-semibold rounded bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">Members</Link>
        <Link href={`/workspaces/${workspaceId}/settings/teams`} className="px-3 py-1.5 text-sm font-medium rounded hover:bg-gray-100 dark:hover:bg-gray-800">Teams</Link>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="text-2xl font-bold">Members</h2>
        <div className="flex gap-2">
          <button onClick={() => { setProvisionOpen(true); setTempPassword(''); setProvError(null); }} className="px-4 py-2 text-sm font-bold text-white bg-blue-600 rounded hover:bg-blue-700">Provision Account</button>
          <button onClick={() => { setAddOpen(true); setAddError(null); }} className="px-4 py-2 text-sm font-bold border rounded hover:bg-gray-50 dark:hover:bg-gray-800">Add Member</button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
        <input type="text" placeholder="Search by name or email..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 pr-3 py-2 text-sm border rounded w-full dark:bg-gray-800" />
      </div>

      {mutError && <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{mutError}</div>}

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {filtered.map((m) => (
                <tr key={m.user_id}>
                  <td className="px-4 py-3">{m.full_name || m.user_id}</td>
                  <td className="px-4 py-3 text-gray-500">{m.email}</td>
                  <td className="px-4 py-3">
                    <select value={m.role} onChange={(e) => handlePatch(m.user_id, { role: e.target.value })} className="text-xs border rounded px-2 py-1 dark:bg-gray-800">
                      <option value="ADMIN">ADMIN</option>
                      <option value="MANAGER">MANAGER</option>
                      <option value="MEMBER">MEMBER</option>
                      <option value="FIELD_WORKER">FIELD_WORKER</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select value={m.status} onChange={(e) => handlePatch(m.user_id, { status: e.target.value })} className="text-xs border rounded px-2 py-1 dark:bg-gray-800">
                      <option value="ACTIVE">ACTIVE</option>
                      <option value="INVITED">INVITED</option>
                      <option value="SUSPENDED">SUSPENDED</option>
                      <option value="REMOVED">REMOVED</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {provisionOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => { setProvisionOpen(false); setTempPassword(''); }} />
          <div role="dialog" aria-modal="true" aria-label="Provision Account" className="relative w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6 rounded-lg shadow-xl">
            {tempPassword ? (
              <div className="space-y-4">
                <h3 className="text-lg font-bold">Account Created</h3>
                <div role="alert" className="rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800 font-semibold">Copy this password now. It will not be shown again.</div>
                <div className="flex items-center gap-2">
                  <input type="text" readOnly value={tempPassword} className="flex-1 rounded border px-3 py-2 text-sm font-mono bg-gray-100" />
                  <button onClick={() => navigator.clipboard.writeText(tempPassword)} className="px-3 py-2 text-sm font-bold bg-blue-600 text-white rounded hover:bg-blue-700">Copy</button>
                </div>
                <button onClick={() => { setProvisionOpen(false); setTempPassword(''); }} className="w-full py-2 text-sm border rounded hover:bg-gray-50">Close</button>
              </div>
            ) : (
              <form onSubmit={handleProvision} className="space-y-4">
                <h3 className="text-lg font-bold">Provision Account</h3>
                {provError && <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{provError}</div>}
                <div>
                  <label htmlFor="prov_email" className="mb-1 block text-sm font-medium">Email</label>
                  <input id="prov_email" type="email" required value={provEmail} onChange={(e) => setProvEmail(e.target.value)} className="w-full rounded border px-3 py-2 dark:bg-gray-800" />
                </div>
                <div>
                  <label htmlFor="prov_name" className="mb-1 block text-sm font-medium">Full name</label>
                  <input id="prov_name" type="text" required value={provName} onChange={(e) => setProvName(e.target.value)} className="w-full rounded border px-3 py-2 dark:bg-gray-800" />
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setProvisionOpen(false)} className="px-4 py-2 text-sm border rounded hover:bg-gray-50">Cancel</button>
                  <button type="submit" disabled={provSaving} className="px-4 py-2 text-sm font-bold bg-blue-600 text-white rounded disabled:opacity-50">{provSaving ? 'Creating...' : 'Create'}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => setAddOpen(false)} />
          <div role="dialog" aria-modal="true" aria-label="Add Member" className="relative w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6 rounded-lg shadow-xl">
            <form onSubmit={handleAdd} className="space-y-4">
              <h3 className="text-lg font-bold">Add Existing Member</h3>
              {addError && <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{addError}</div>}
              <div>
                <label htmlFor="add_email" className="mb-1 block text-sm font-medium">Email</label>
                <input id="add_email" type="email" required value={addEmail} onChange={(e) => setAddEmail(e.target.value)} className="w-full rounded border px-3 py-2 dark:bg-gray-800" />
              </div>
              <div>
                <label htmlFor="add_role" className="mb-1 block text-sm font-medium">Role</label>
                <select id="add_role" value={addRole} onChange={(e) => setAddRole(e.target.value)} className="w-full rounded border px-3 py-2 dark:bg-gray-800">
                  <option value="ADMIN">ADMIN</option>
                  <option value="MANAGER">MANAGER</option>
                  <option value="MEMBER">MEMBER</option>
                  <option value="FIELD_WORKER">FIELD_WORKER</option>
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setAddOpen(false)} className="px-4 py-2 text-sm border rounded hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={addSaving} className="px-4 py-2 text-sm font-bold bg-blue-600 text-white rounded disabled:opacity-50">{addSaving ? 'Adding...' : 'Add'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
