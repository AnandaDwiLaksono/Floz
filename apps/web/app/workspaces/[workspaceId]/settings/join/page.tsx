'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '../../../../../lib/auth-context';
import { api, ApiError } from '../../../../../lib/api-client';

const policies = ['INVITE_ONLY', 'JOIN_CODE', 'APPROVAL_REQUIRED'] as const;

export default function JoinSettingsPage() {
  const { workspaceId } = useParams() as { workspaceId: string };
  const { activeWorkspace } = useAuth();
  const [policy, setPolicy] = useState('INVITE_ONLY');
  const [hasCode, setHasCode] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [requests, setRequests] = useState<{ id: string; userName: string; userEmail: string; status: string; requestedAt: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = activeWorkspace?.role === 'ADMIN';

  const load = useCallback(async () => {
    const [settings, requestList] = await Promise.all([api.join.getSettings(workspaceId), api.join.listRequests(workspaceId)]);
    setPolicy(settings.data.join_policy);
    setHasCode(settings.data.has_active_code);
    setRequests(requestList.data);
  }, [workspaceId]);

  useEffect(() => { if (isAdmin) void load().catch((err) => setError(err instanceof ApiError ? err.message : 'Unable to load join settings.')); }, [isAdmin, load]);

  if (!isAdmin) return <div className="p-6 text-center text-red-600 font-semibold">Access denied. Admin only.</div>;

  const updatePolicy = async (value: string) => { setPolicy(value); await api.join.updateSettings(workspaceId, value); };
  const generate = async () => { const result = await api.join.generateCode(workspaceId); setCode(result.data.join_code); setHasCode(true); };
  const revoke = async () => { await api.join.revokeCode(workspaceId); setCode(null); setHasCode(false); };
  const review = async (id: string, approve: boolean) => { await (approve ? api.join.approveRequest(workspaceId, id) : api.join.rejectRequest(workspaceId, id)); await load(); };

  return <div className="max-w-4xl mx-auto space-y-6"><div className="flex gap-2 border-b pb-3"><Link href={`/workspaces/${workspaceId}/settings/members`} className="rounded px-3 py-1.5 text-sm">Members</Link><span className="rounded bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-600">Join</span></div><h2 className="text-2xl font-bold">Join Settings</h2>{error && <div role="alert">{error}</div>}<section className="space-y-3 rounded-lg border p-4"><label htmlFor="join_policy" className="block text-sm font-semibold">Join policy</label><select id="join_policy" value={policy} onChange={(e) => void updatePolicy(e.target.value)} className="rounded border px-3 py-2 dark:bg-gray-800">{policies.map((value) => <option key={value}>{value}</option>)}</select>{policy === 'JOIN_CODE' && <div className="space-y-2"><p className="text-sm text-gray-600">{hasCode ? 'An active join code exists.' : 'No active join code.'}</p>{code && <p className="font-mono font-bold">{code}</p>}<div className="flex gap-2"><button type="button" onClick={() => void generate()} className="rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white">Generate / Rotate</button>{hasCode && <button type="button" onClick={() => void revoke()} className="rounded border px-3 py-2 text-sm">Revoke</button>}</div></div>}</section><section className="space-y-3"><h3 className="text-lg font-bold">Pending join requests</h3>{requests.filter((request) => request.status === 'PENDING').map((request) => <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded border p-3"><div><p className="font-medium">{request.userName}</p><p className="text-sm text-gray-500">{request.userEmail}</p></div><div className="flex gap-2"><button type="button" onClick={() => void review(request.id, true)} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white">Approve</button><button type="button" onClick={() => void review(request.id, false)} className="rounded border px-3 py-1.5 text-sm">Reject</button></div></div>)}</section></div>;
}
