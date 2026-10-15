'use client';

import React, { useRef, useState } from 'react';
import { api, ApiError, WorkflowDetail, WorkflowStatus } from '../lib/api-client';
import WorkflowStatusCard from './workflow-status-card';
import WorkflowStatusDialog from './workflow-status-dialog';

const messages: Record<string, string> = {
  STATUS_CATEGORY_IN_USE: 'Kategori ini tidak dapat diubah selama tugas menggunakan status ini.',
  RECURRENCE_DEPENDENCY_CONFLICT: 'Status ini digunakan oleh tugas berulang. Perbarui perulangan tersebut terlebih dahulu.',
  CANNOT_ARCHIVE_INITIAL_STATUS: 'Pilih status awal lain sebelum mengarsipkan status ini.',
};

export default function WorkflowStatusList({ workspaceId, workflow, onWorkflowUpdate, onError, showToast, onPendingChange, onReload, pending = false }: {
  workspaceId: string; workflow: WorkflowDetail; onWorkflowUpdate: (wf: WorkflowDetail) => void;
  onError: (err: unknown) => Promise<string>; showToast: (msg: string) => void;
  onPendingChange?: (pending: boolean) => void; onReload?: () => Promise<void>; pending?: boolean;
}) {
  const [dialog, setDialog] = useState<'create' | 'edit' | 'archive' | null>(null);
  const [selected, setSelected] = useState<WorkflowStatus | null>(null);
  const [name, setName] = useState(''); const [code, setCode] = useState('');
  const [category, setCategory] = useState<WorkflowStatus['category']>('TODO');
  const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState(''); const dragging = useRef<string | null>(null);
  const active = workflow.statuses.filter(s => s.is_active).sort((a, b) => a.position - b.position);
  const archived = workflow.statuses.filter(s => !s.is_active).sort((a, b) => a.position - b.position);
  const locked = saving || pending || !workflow.is_active;
  const reload = async () => {
    setSaving(true); onPendingChange?.(true);
    try {
      if (onReload) await onReload();
      else { const response = await api.workspaces.workflowDetail(workspaceId, workflow.id); onWorkflowUpdate(response.data); }
      setDialog(null); setError('');
    } catch { setError('Gagal memuat ulang konfigurasi. Muat ulang untuk mencoba lagi.'); }
    finally { setSaving(false); onPendingChange?.(false); }
  };

  const close = () => { if (!saving) { setDialog(null); setError(''); } };
  const fail = async (err: unknown) => {
    const result = await onError(err);
    const errorCode = err instanceof ApiError ? err.code : '';
    if (errorCode === 'VERSION_CONFLICT' || result === 'VERSION_CONFLICT') setError('Configuration changed elsewhere. Reload the latest configuration before continuing.');
    else setError(messages[errorCode] || (err instanceof ApiError ? err.message : 'Operasi gagal.'));
  };
  const mutate = async (request: () => Promise<{ data: WorkflowDetail }>, success: string) => {
    if (locked) return false;
    setSaving(true); onPendingChange?.(true); setError('');
    try { const response = await request(); onWorkflowUpdate(response.data); showToast(success); return true; }
    catch (err) { await fail(err); return false; }
    finally { setSaving(false); onPendingChange?.(false); }
  };
  const openEdit = (status: WorkflowStatus) => { setSelected(status); setName(status.name); setCode(status.code); setCategory(status.category); setDialog('edit'); setError(''); };
  const validName = name.trim().length > 0 && name.trim().length <= 100;
  const validCode = /^[A-Z0-9_]{2,32}$/.test(code.trim().toUpperCase());
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validName) return setError('Nama wajib diisi dan maksimal 100 karakter.');
    if (dialog === 'create' && !validCode) return setError('Kode harus berupa 2–32 huruf besar, angka, atau garis bawah.');
    const ok = dialog === 'create'
      ? await mutate(() => api.workspaces.addWorkflowStatus(workspaceId, workflow.id, { name: name.trim(), code: code.trim().toUpperCase(), category, version: workflow.version }), 'Status berhasil dibuat.')
      : await mutate(() => api.workspaces.updateWorkflowStatus(workspaceId, workflow.id, selected!.id, { name: name.trim(), category, version: workflow.version }), 'Status berhasil diperbarui.');
    if (ok) setDialog(null);
  };
  const reorder = async (ids: string[], movedId: string) => {
    const focused = document.activeElement as HTMLElement | null;
    const ok = await mutate(() => api.workspaces.reorderWorkflowStatuses(workspaceId, workflow.id, { status_ids: ids, version: workflow.version }), 'Urutan status berhasil diperbarui.');
    if (ok) {
      const position = ids.indexOf(movedId) + 1;
      setAnnouncement(`${active.find(s => s.id === movedId)?.name} dipindahkan ke posisi ${position} dari ${ids.length}.`);
      requestAnimationFrame(() => { if (focused?.matches('[data-reorder]')) focused.focus(); else document.querySelector<HTMLElement>(`[data-status-id="${movedId}"] [data-reorder="true"]`)?.focus(); });
    }
  };
  const move = (index: number, direction: -1 | 1) => {
    const target = Math.max(0, Math.min(active.length - 1, index + direction));
    if (target === index) { setAnnouncement(`${active[index].name} sudah berada pada posisi ${index + 1} dari ${active.length}.`); return; }
    const ids = active.map(s => s.id); [ids[index], ids[target]] = [ids[target], ids[index]]; void reorder(ids, ids[target]);
  };
  const drop = (targetId: string) => {
    const source = dragging.current; dragging.current = null;
    if (!source || source === targetId || locked) return;
    const ids = active.map(s => s.id), from = ids.indexOf(source), to = ids.indexOf(targetId);
    ids.splice(from, 1); ids.splice(to, 0, source); void reorder(ids, source);
  };

  return <div role="region" aria-label="Statuses" className="space-y-3 rounded-lg border p-4">
    <div className="flex justify-between"><h3 className="text-lg font-bold">Status</h3><button disabled={locked} onClick={() => { setName(''); setCode(''); setCategory('TODO'); setDialog('create'); }}>Tambah Status</button></div>
    <div aria-live="polite" className="sr-only">{announcement}</div>
    {error && !dialog && <div role="alert">{error}{(error.includes('Muat Ulang') || error.includes('Reload')) && <button onClick={() => void reload()}>Muat Ulang Konfigurasi</button>}</div>}
    {active.map((status, index) => <WorkflowStatusCard key={status.id} status={status} index={index} count={active.length} locked={locked} onMove={d => move(index, d)} onEdit={() => openEdit(status)} onInitial={() => void mutate(() => api.workspaces.setInitialStatus(workspaceId, workflow.id, status.id, { version: workflow.version }), 'Status awal berhasil diperbarui.')} onArchive={() => { setSelected(status); setDialog('archive'); }} onRestore={() => {}} onDragStart={() => { if (!locked) dragging.current = status.id; }} onDragOver={e => e.preventDefault()} onDrop={() => drop(status.id)} onDragEnd={() => { dragging.current = null; }} />)}
    {archived.length > 0 && <section><h4>Diarsipkan</h4>{archived.map((status, index) => <WorkflowStatusCard key={status.id} status={status} index={index} count={archived.length} locked={locked} onMove={() => {}} onEdit={() => {}} onInitial={() => {}} onArchive={() => {}} onRestore={() => void mutate(() => api.workspaces.restoreWorkflowStatus(workspaceId, workflow.id, status.id, { version: workflow.version }), 'Status berhasil dipulihkan.')} />)}</section>}
    {(dialog === 'create' || dialog === 'edit') && <WorkflowStatusDialog label={dialog === 'create' ? 'Tambah Status' : 'Ubah Status'} onClose={close}><form onSubmit={submit} className="space-y-4"><h4>{dialog === 'create' ? 'Tambah Status' : 'Ubah Status'}</h4>{error && <div role="alert">{error}{(error.includes('Muat Ulang') || error.includes('Reload')) && <button type="button" onClick={() => void reload()}>Muat Ulang Konfigurasi</button>}</div>}<label className="block">Nama<input disabled={locked} aria-label="Name" value={name} maxLength={100} onChange={e => setName(e.target.value)} /></label><label className="block">Kode<input aria-label="Code" value={code} disabled={locked || dialog === 'edit'} onChange={e => setCode(e.target.value.toUpperCase())} /></label><label className="block">Kategori<select disabled={locked} aria-label="Category" value={category} onChange={e => setCategory(e.target.value as WorkflowStatus['category'])}>{['TODO','IN_PROGRESS','DONE','CANCELLED'].map(x => <option key={x}>{x}</option>)}</select></label><button type="button" onClick={close}>Batal</button><button type="submit" disabled={locked}>{dialog === 'create' ? 'Buat' : 'Simpan'}</button></form></WorkflowStatusDialog>}
    {dialog === 'archive' && selected && <WorkflowStatusDialog label="Konfirmasi Arsip Status" onClose={close}><h4>Arsipkan Status</h4>{error && <div role="alert">{error}{(error.includes('Muat Ulang') || error.includes('Reload')) && <button onClick={() => void reload()}>Muat Ulang Konfigurasi</button>}</div>}<p>Tugas yang ada dengan status ini akan tetap terhubung dan akan ditampilkan di bawah status yang diarsipkan.</p><button onClick={close}>Batal</button><button disabled={locked} onClick={async () => { if (await mutate(() => api.workspaces.archiveWorkflowStatus(workspaceId, workflow.id, selected.id, { version: workflow.version }), 'Status berhasil diarsipkan.')) setDialog(null); }}>Arsipkan</button></WorkflowStatusDialog>}
  </div>;
}
