'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '../../../../../lib/auth-context';
import { SettingsNav } from '../../../../../components/settings-nav';
import { api, ApiError, WorkflowDetail, WorkflowListItem, Team } from '../../../../../lib/api-client';
import WorkflowCreateDialog from '../../../../../components/workflow-create-dialog';
import WorkflowMetadataCard from '../../../../../components/workflow-metadata-card';
import WorkflowStatusList from '../../../../../components/workflow-status-list';
import WorkflowTransitionMatrix from '../../../../../components/workflow-transition-matrix';

export default function WorkflowSettingsPage() {
  const { workspaceId } = useParams() as { workspaceId: string };
  const { activeWorkspace, workspaceResolving } = useAuth();
  const isAdmin = !workspaceResolving && activeWorkspace?.id === workspaceId && activeWorkspace.role === 'ADMIN';
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [selected, setSelected] = useState<WorkflowDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [conflict, setConflict] = useState(false);
  const selectedId = useRef<string | null>(null);
  const detailRequest = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [mutationPending, setMutationPending] = useState(false);
  const [filter, setFilter] = useState<'all' | 'active' | 'archived'>('all');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 4000); };

  const loadWorkflows = useCallback(async () => {
    try {
      const res = await api.workspaces.workflowList(workspaceId);
      setWorkflows(res.data);
      return res.data;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memuat alur kerja.');
      return [];
    } finally { setLoading(false); }
  }, [workspaceId]);

  const loadTeams = useCallback(async () => {
    setTeamsLoading(true);
    setTeamsError(null);
    try { const res = await api.workspaces.teams(workspaceId); setTeams(res.data); }
    catch (err) { setTeamsError(err instanceof ApiError ? err.message : 'Gagal memuat tim.'); }
    finally { setTeamsLoading(false); }
  }, [workspaceId]);

  const loadDetail = useCallback(async (wfId: string) => {
    const request = ++detailRequest.current;
    selectedId.current = wfId;
    setDetailLoading(true);
    setError(null);
    try {
      const res = await api.workspaces.workflowDetail(workspaceId, wfId);
      if (request !== detailRequest.current) return null;
      setSelected(res.data);
      setConflict(false);
      return res.data;
    } catch (err) {
      if (request === detailRequest.current) setError(err instanceof ApiError ? err.message : 'Gagal memuat alur kerja.');
      return null;
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  }, [workspaceId]);

  const reloadWorkflow = useCallback(async () => {
    if (!selected) return;
    const fresh = await loadDetail(selected.id);
    if (fresh) {
      setWorkflows((prev) => prev.map((w) => w.id === fresh.id ? fresh : w));
    }
  }, [selected, loadDetail]);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    loadWorkflows().then((wfs) => { if (active && wfs.length > 0) loadDetail(wfs[0].id); });
    loadTeams();
    return () => { active = false; ++detailRequest.current; selectedId.current = null; };
  }, [isAdmin, loadWorkflows, loadTeams, loadDetail]);

  if (!isAdmin) return <div className="p-6 text-center text-red-600 font-semibold">Akses ditolak. Khusus admin.</div>;

  const handleMutationResult = (result: WorkflowDetail) => {
    if (selectedId.current === result.id) setSelected(result);
    setWorkflows((prev) => {
      const exists = prev.find((w) => w.id === result.id);
      if (exists) return prev.map((w) => w.id === result.id ? result : w);
      return [result, ...prev];
    });
  };

  const handleError = async (err: unknown) => {
    if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
      setConflict(true);
      showToast('Konflik versi terdeteksi. Muat ulang konfigurasi untuk mendapatkan data terbaru.');
      return 'VERSION_CONFLICT';
    }
    setError(err instanceof ApiError ? err.message : 'Operasi gagal.');
    return 'ERROR';
  };

  const handleUpdateMetadata = async (body: { name?: string; description?: string | null; version: number }) => {
    if (!selected || mutationPending) return;
    setMutationPending(true);
    try {
      const res = await api.workspaces.updateWorkflow(workspaceId, selected.id, body);
      handleMutationResult(res.data);
      showToast('Alur kerja diperbarui.');
    } catch (err) { return handleError(err); }
    finally { setMutationPending(false); }
  };

  const handleSetDefault = async () => {
    if (!selected || mutationPending) return;
    setMutationPending(true);
    try {
      const res = await api.workspaces.setDefaultWorkflow(workspaceId, selected.id, { version: selected.version });
      handleMutationResult(res.data);
      await loadWorkflows();
      if (selectedId.current === selected.id) await loadDetail(selected.id);
      showToast('Alur kerja dijadikan default.');
    } catch (err) { return handleError(err); }
    finally { setMutationPending(false); }
  };

  const handleArchive = async () => {
    if (!selected || mutationPending) return;
    setMutationPending(true);
    try {
      const res = await api.workspaces.archiveWorkflow(workspaceId, selected.id, { version: selected.version });
      handleMutationResult(res.data);
      showToast('Alur kerja diarsipkan.');
    } catch (err) { return handleError(err); }
    finally { setMutationPending(false); }
  };

  const handleRestore = async () => {
    if (!selected || mutationPending) return;
    setMutationPending(true);
    try {
      const res = await api.workspaces.restoreWorkflow(workspaceId, selected.id, { version: selected.version });
      handleMutationResult(res.data);
      showToast('Alur kerja dipulihkan.');
    } catch (err) { return handleError(err); }
    finally { setMutationPending(false); }
  };

  const handleCreate = async (body: Parameters<typeof api.workspaces.createWorkflow>[1]) => {
    try {
      const res = await api.workspaces.createWorkflow(workspaceId, body);
      selectedId.current = res.data.id;
      handleMutationResult(res.data);
      showToast('Alur kerja dibuat.');
      return res.data;
    } catch (err) { await handleError(err); throw err; }
  };

  const filtered = workflows.filter((w) => filter === 'all' || (filter === 'active' ? w.is_active : !w.is_active));

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <SettingsNav workspaceId={workspaceId} />

      {toast && <div role="status" className="rounded border border-blue-300 bg-blue-50 p-3 text-sm text-blue-700">{toast}</div>}
      {error && <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {teamsError && <div role="alert">{teamsError} <button onClick={loadTeams}>Coba muat ulang tim</button></div>}
      {conflict && <button onClick={reloadWorkflow} className="rounded border border-yellow-400 bg-yellow-50 px-3 py-2 text-sm font-bold text-yellow-800">Muat Ulang Konfigurasi</button>}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="text-2xl font-bold">Alur Kerja</h2>
        <button disabled={teamsLoading || !!teamsError || mutationPending} onClick={() => { setCreateOpen(true); setError(null); }} className="px-4 py-2 text-sm font-bold text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50">Alur Kerja Baru</button>
      </div>

      <div className="flex gap-2">
        {(['all', 'active', 'archived'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 text-sm rounded font-medium ${filter === f ? 'bg-blue-50 text-blue-600 font-semibold' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}>{f === 'all' ? 'Semua' : f === 'active' ? 'Aktif' : 'Diarsipkan'}</button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map((wf) => (
            <button key={wf.id} onClick={() => loadDetail(wf.id)} className={`text-left bg-white dark:bg-gray-900 border rounded-lg p-4 ${!wf.is_active ? 'opacity-60' : ''} ${selected?.id === wf.id ? 'ring-2 ring-blue-500 border-blue-500' : 'border-gray-200 dark:border-gray-800'}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{wf.name}</span>
                {wf.is_default && <span className="text-xs px-2 py-0.5 rounded font-medium bg-yellow-100 text-yellow-800">Bawaan</span>}
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${wf.team_id ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>{wf.team_id ? `Tim: ${teams.find((t) => t.id === wf.team_id)?.name || 'Tidak diketahui'}` : 'Workspace'}</span>
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${wf.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>{wf.is_active ? 'Aktif' : 'Diarsipkan'}</span>
              </div>
            </button>
          ))}
          {filtered.length === 0 && <p className="text-center text-gray-500 py-8 col-span-2">Tidak ada alur kerja.</p>}
        </div>
      )}

      {detailLoading && <p role="status">Memuat konfigurasi alur kerja...</p>}
      {selected && (
        <fieldset key={selected.id} disabled={mutationPending || detailLoading} className="space-y-6" aria-label="Workflow Configuration">
          <WorkflowMetadataCard
            workflow={selected}
            teams={teams}
            pending={mutationPending}
            onUpdate={handleUpdateMetadata}
            onSetDefault={handleSetDefault}
            onArchive={handleArchive}
            onRestore={handleRestore}
            onReload={reloadWorkflow}
          />
          <WorkflowStatusList
            workspaceId={workspaceId}
            workflow={selected}
            onWorkflowUpdate={handleMutationResult}
            onError={handleError}
             showToast={showToast}
             onPendingChange={setMutationPending}
             onReload={reloadWorkflow}
             pending={mutationPending}
           />
           <WorkflowTransitionMatrix
            workspaceId={workspaceId}
            workflow={selected}
            onWorkflowUpdate={handleMutationResult}
            onError={handleError}
             showToast={showToast}
             onPendingChange={setMutationPending}
             onReload={reloadWorkflow}
             pending={mutationPending}
           />
         </fieldset>
      )}

      {createOpen && (
        <WorkflowCreateDialog
          teams={teams}
          onClose={() => setCreateOpen(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}
