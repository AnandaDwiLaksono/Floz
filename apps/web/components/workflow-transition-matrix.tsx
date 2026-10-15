'use client';

import React, { useEffect, useState } from 'react';
import { api, ApiError, WorkflowDetail } from '../lib/api-client';
import WorkflowTransitionMobileList from './workflow-transition-mobile-list';

export default function WorkflowTransitionMatrix({ workspaceId, workflow, onWorkflowUpdate, onError, showToast, onPendingChange, onReload, pending = false }: {
  workspaceId: string; workflow: WorkflowDetail; onWorkflowUpdate: (wf: WorkflowDetail) => void;
  onError: (err: unknown) => Promise<string>; showToast: (msg: string) => void;
  onPendingChange?: (pending: boolean) => void; onReload?: () => Promise<void>; pending?: boolean;
}) {
  const [saving, setSaving] = useState(false), [dirty, setDirty] = useState(false), [error, setError] = useState('');
  const [edges, setEdges] = useState(new Set<string>()), [mobile, setMobile] = useState(false);
  const statuses = [...workflow.statuses].sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.position - b.position);
  useEffect(() => { setEdges(new Set(workflow.transitions.map(t => `${t.from_status_id}->${t.to_status_id}`))); setDirty(false); setError(''); }, [workflow.id, workflow.version, workflow.transitions]);
  useEffect(() => { const resize = () => setMobile(window.innerWidth < 768); resize(); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  const isEdge = (from: string, to: string) => edges.has(`${from}->${to}`);
  const toggle = (from: string, to: string) => {
    if (saving || pending || !workflow.is_active || from === to || !statuses.find(s => s.id === to)?.is_active) return;
    const next = new Set(edges), key = `${from}->${to}`;
    if (next.has(key)) next.delete(key); else next.add(key);
    setEdges(next); setDirty(true);
  };
  const reload = async () => {
    setSaving(true); onPendingChange?.(true);
    try { if (onReload) await onReload(); else { const response = await api.workspaces.workflowDetail(workspaceId, workflow.id); onWorkflowUpdate(response.data); } setError(''); }
    catch { setError('Gagal memuat ulang konfigurasi. Muat ulang untuk mencoba lagi.'); }
    finally { setSaving(false); onPendingChange?.(false); }
  };
  const save = async () => {
    if (saving || pending || !workflow.is_active) return;
    setSaving(true); onPendingChange?.(true); setError('');
    const transitions = [...edges].map(key => { const [from_status_id, to_status_id] = key.split('->'); return { from_status_id, to_status_id }; }).filter(t => t.from_status_id !== t.to_status_id && statuses.some(s => s.id === t.to_status_id && s.is_active));
    try { const response = await api.workspaces.replaceWorkflowTransitions(workspaceId, workflow.id, { transitions, version: workflow.version }); onWorkflowUpdate(response.data); setDirty(false); showToast('Transisi berhasil disimpan.'); }
    catch (err) {
      await onError(err);
      const messages: Record<string, string> = { SELF_LOOP_NOT_ALLOWED: 'Status tidak dapat bertransisi ke dirinya sendiri.', INACTIVE_TRANSITION_TARGET: 'Status yang diarsipkan tidak dapat menjadi target transisi baru. Muat ulang konfigurasi.', VERSION_CONFLICT: 'Konfigurasi telah diubah di tempat lain. Muat ulang konfigurasi untuk mendapatkan data terbaru.' };
      setError(err instanceof ApiError ? messages[err.code] || err.message : 'Gagal menyimpan transisi.');
    } finally { setSaving(false); onPendingChange?.(false); }
  };
  return <fieldset disabled={saving || pending || !workflow.is_active} role="region" aria-label="Transitions" className="space-y-3 rounded-lg border p-4"><div className="flex justify-between"><h3 className="text-lg font-bold">Transisi</h3>{dirty && <button onClick={save} aria-label="Save">Simpan</button>}</div>      {error && <div role="alert">{error}{(error.toLowerCase().includes('muat ulang') || error.toLowerCase().includes('reload')) && <button onClick={() => void reload()} aria-label="Reload Configuration">Muat Ulang Konfigurasi</button>}</div>}
      {mobile ? <WorkflowTransitionMobileList statuses={statuses} isEdge={isEdge} onToggle={toggle} /> : <div className="overflow-x-auto"><table className="w-full border-collapse text-xs"><thead><tr><th scope="col">Dari \ Ke</th>{statuses.map(s => <th scope="col" key={s.id}>{s.name}{!s.is_active && <span className="block">Diarsipkan</span>}</th>)}</tr></thead><tbody>{statuses.map(from => <tr key={from.id}><th scope="row"><span>{from.name}</span>{!from.is_active && ' (Diarsipkan)'}</th>{statuses.map(to => <td key={to.id} className="border p-2 text-center">{from.id === to.id ? <span aria-label={`Transition from ${from.name} to ${to.name}: self-loop not allowed`}>Transisi ke status yang sama tidak diizinkan</span> : <input type="checkbox" checked={isEdge(from.id, to.id)} disabled={!to.is_active} onChange={() => toggle(from.id, to.id)} aria-label={`Transition from ${from.name} to ${to.name}${!to.is_active ? ', inactive target; stored edge' : ''}`} />}</td>)}</tr>)}</tbody></table></div>}</fieldset>;
}
