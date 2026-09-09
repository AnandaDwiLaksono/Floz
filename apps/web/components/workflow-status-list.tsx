'use client';

import React, { useRef, useState } from 'react';
import { api, ApiError, WorkflowDetail, WorkflowStatus } from '../lib/api-client';
import WorkflowStatusCard from './workflow-status-card';
import WorkflowStatusDialog from './workflow-status-dialog';

const messages: Record<string, string> = {
  STATUS_CATEGORY_IN_USE: 'This category cannot change while tasks use this status.',
  RECURRENCE_DEPENDENCY_CONFLICT: 'This status is used by a recurring task. Update that recurrence first.',
  CANNOT_ARCHIVE_INITIAL_STATUS: 'Choose another initial status before archiving this one.',
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
    } catch { setError('Unable to reload configuration. Reload to try again.'); }
    finally { setSaving(false); onPendingChange?.(false); }
  };

  const close = () => { if (!saving) { setDialog(null); setError(''); } };
  const fail = async (err: unknown) => {
    const result = await onError(err);
    const errorCode = err instanceof ApiError ? err.code : '';
    if (errorCode === 'VERSION_CONFLICT' || result === 'VERSION_CONFLICT') setError('Configuration changed elsewhere. Reload the latest configuration before continuing.');
    else setError(messages[errorCode] || (err instanceof ApiError ? err.message : 'Operation failed.'));
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
    if (!validName) return setError('Name is required and must be 100 characters or fewer.');
    if (dialog === 'create' && !validCode) return setError('Code must be 2–32 uppercase letters, numbers, or underscores.');
    const ok = dialog === 'create'
      ? await mutate(() => api.workspaces.addWorkflowStatus(workspaceId, workflow.id, { name: name.trim(), code: code.trim().toUpperCase(), category, version: workflow.version }), 'Status created.')
      : await mutate(() => api.workspaces.updateWorkflowStatus(workspaceId, workflow.id, selected!.id, { name: name.trim(), category, version: workflow.version }), 'Status updated.');
    if (ok) setDialog(null);
  };
  const reorder = async (ids: string[], movedId: string) => {
    const focused = document.activeElement as HTMLElement | null;
    const ok = await mutate(() => api.workspaces.reorderWorkflowStatuses(workspaceId, workflow.id, { status_ids: ids, version: workflow.version }), 'Status order updated.');
    if (ok) {
      const position = ids.indexOf(movedId) + 1;
      setAnnouncement(`${active.find(s => s.id === movedId)?.name} moved to position ${position} of ${ids.length}.`);
      requestAnimationFrame(() => { if (focused?.matches('[data-reorder]')) focused.focus(); else document.querySelector<HTMLElement>(`[data-status-id="${movedId}"] [data-reorder="true"]`)?.focus(); });
    }
  };
  const move = (index: number, direction: -1 | 1) => {
    const target = Math.max(0, Math.min(active.length - 1, index + direction));
    if (target === index) { setAnnouncement(`${active[index].name} is already at position ${index + 1} of ${active.length}.`); return; }
    const ids = active.map(s => s.id); [ids[index], ids[target]] = [ids[target], ids[index]]; void reorder(ids, ids[target]);
  };
  const drop = (targetId: string) => {
    const source = dragging.current; dragging.current = null;
    if (!source || source === targetId || locked) return;
    const ids = active.map(s => s.id), from = ids.indexOf(source), to = ids.indexOf(targetId);
    ids.splice(from, 1); ids.splice(to, 0, source); void reorder(ids, source);
  };

  return <div role="region" aria-label="Statuses" className="space-y-3 rounded-lg border p-4">
    <div className="flex justify-between"><h3 className="text-lg font-bold">Statuses</h3><button disabled={locked} onClick={() => { setName(''); setCode(''); setCategory('TODO'); setDialog('create'); }}>Add Status</button></div>
    <div aria-live="polite" className="sr-only">{announcement}</div>
    {error && !dialog && <div role="alert">{error}{error.includes('Reload') && <button onClick={() => void reload()}>Reload Configuration</button>}</div>}
    {active.map((status, index) => <WorkflowStatusCard key={status.id} status={status} index={index} count={active.length} locked={locked} onMove={d => move(index, d)} onEdit={() => openEdit(status)} onInitial={() => void mutate(() => api.workspaces.setInitialStatus(workspaceId, workflow.id, status.id, { version: workflow.version }), 'Initial status updated.')} onArchive={() => { setSelected(status); setDialog('archive'); }} onRestore={() => {}} onDragStart={() => { if (!locked) dragging.current = status.id; }} onDragOver={e => e.preventDefault()} onDrop={() => drop(status.id)} onDragEnd={() => { dragging.current = null; }} />)}
    {archived.length > 0 && <section><h4>Archived</h4>{archived.map((status, index) => <WorkflowStatusCard key={status.id} status={status} index={index} count={archived.length} locked={locked} onMove={() => {}} onEdit={() => {}} onInitial={() => {}} onArchive={() => {}} onRestore={() => void mutate(() => api.workspaces.restoreWorkflowStatus(workspaceId, workflow.id, status.id, { version: workflow.version }), 'Status restored.')} />)}</section>}
    {(dialog === 'create' || dialog === 'edit') && <WorkflowStatusDialog label={dialog === 'create' ? 'Add Status' : 'Edit Status'} onClose={close}><form onSubmit={submit} className="space-y-4"><h4>{dialog === 'create' ? 'Add Status' : 'Edit Status'}</h4>{error && <div role="alert">{error}{error.includes('Reload') && <button type="button" onClick={() => void reload()}>Reload Configuration</button>}</div>}<label className="block">Name<input disabled={locked} aria-label="Name" value={name} maxLength={100} onChange={e => setName(e.target.value)} /></label><label className="block">Code<input aria-label="Code" value={code} disabled={locked || dialog === 'edit'} onChange={e => setCode(e.target.value.toUpperCase())} /></label><label className="block">Category<select disabled={locked} aria-label="Category" value={category} onChange={e => setCategory(e.target.value as WorkflowStatus['category'])}>{['TODO','IN_PROGRESS','DONE','CANCELLED'].map(x => <option key={x}>{x}</option>)}</select></label><button type="button" onClick={close}>Cancel</button><button type="submit" disabled={locked}>{dialog === 'create' ? 'Create' : 'Save'}</button></form></WorkflowStatusDialog>}
    {dialog === 'archive' && selected && <WorkflowStatusDialog label="Confirm Archive Status" onClose={close}><h4>Archive Status</h4>{error && <div role="alert">{error}{error.includes('Reload') && <button onClick={() => void reload()}>Reload Configuration</button>}</div>}<p>Existing tasks with this status will remain attached and will appear under the archived status.</p><button onClick={close}>Cancel</button><button disabled={locked} onClick={async () => { if (await mutate(() => api.workspaces.archiveWorkflowStatus(workspaceId, workflow.id, selected.id, { version: workflow.version }), 'Status archived.')) setDialog(null); }}>Archive</button></WorkflowStatusDialog>}
  </div>;
}
