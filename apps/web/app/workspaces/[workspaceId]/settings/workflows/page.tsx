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
    const requests = detailRequest;
    loadWorkflows().then((wfs) => { if (active && wfs.length > 0) loadDetail(wfs[0].id); });
    loadTeams();
    return () => { active = false; ++requests.current; selectedId.current = null; };
  }, [isAdmin, loadWorkflows, loadTeams, loadDetail]);

  if (!isAdmin) return <div className="p-6 text-center text-danger font-semibold">Akses ditolak. Khusus admin.</div>;

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

      {toast && <div role="status" className="rounded border border-primary/20 bg-primary/10 p-3 text-sm text-primary">{toast}</div>}
      {error && <div role="alert" className="rounded border border-danger/20 bg-danger/10 p-3 text-sm text-danger">{error}</div>}
      {teamsError && <div role="alert">{teamsError} <button onClick={loadTeams}>Coba muat ulang tim</button></div>}
      {conflict && <button onClick={reloadWorkflow} className="rounded border border-warning/20 bg-warning/10 px-3 py-2 text-sm font-bold text-warning">Muat Ulang Konfigurasi</button>}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="text-2xl font-bold">Alur Kerja</h2>
        <button disabled={teamsLoading || !!teamsError || mutationPending} onClick={() => { setCreateOpen(true); setError(null); }} className="px-4 py-2 text-sm font-bold text-primary-foreground bg-primary rounded hover:bg-primary-hover disabled:opacity-50">Alur Kerja Baru</button>
      </div>

      <div className="flex gap-2">
        {(['all', 'active', 'archived'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 text-sm rounded font-medium ${filter === f ? 'bg-primary/10 text-primary font-semibold' : 'hover:bg-surface-subtle '}`}>{f === 'all' ? 'Semua' : f === 'active' ? 'Aktif' : 'Diarsipkan'}</button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map((wf) => (
            <button key={wf.id} onClick={() => loadDetail(wf.id)} className={`text-left bg-surface border rounded-lg p-4 ${selected?.id === wf.id ? 'ring-2 ring-primary border-primary' : 'border-border '}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{wf.name}</span>
                {wf.is_default && <span className="text-xs px-2 py-0.5 rounded font-medium bg-warning/10 text-warning">Bawaan</span>}
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${wf.team_id ? 'bg-info/10 text-info' : 'bg-muted text-muted-foreground'}`}>{wf.team_id ? `Tim: ${teams.find((t) => t.id === wf.team_id)?.name || 'Tidak diketahui'}` : 'Ruang Kerja'}</span>
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${wf.is_active ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>{wf.is_active ? 'Aktif' : 'Diarsipkan'}</span>
              </div>
            </button>
          ))}
          {filtered.length === 0 && <p className="text-center text-muted-foreground py-8 col-span-2">Tidak ada alur kerja.</p>}
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
