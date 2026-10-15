'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../../lib/auth-context';
import {
  api,
  ApprovalRequestDetail,
  ApprovalRequestSummary,
  PaginatedList,
  WorkspaceMember,
} from '../../../../lib/api-client';

import {
  CheckCircle,
  Clock,
  XCircle,
  AlertCircle,
  Plus,
  ChevronRight,
  X,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { formatDateTimeDisplay } from '../../../../lib/i18n-labels';

export default function ApprovalsPage() {
  const params = useParams();
  const workspaceId = String(params.workspaceId);
  const { activeWorkspace, workspaceResolving } = useAuth();
  if (workspaceResolving || activeWorkspace?.id !== workspaceId) {
    return <div role="status" aria-label="Memuat Persetujuan">Memuat persetujuan…</div>;
  }
  return <WorkspaceApprovals key={workspaceId} />;
}

function WorkspaceApprovals() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = String(params.workspaceId);
  const { activeWorkspace, user, workspaceResolving } = useAuth();

  const currentView = (searchParams?.get('view') as 'inbox' | 'sent' | 'managed' | 'all') || 'inbox';
  const currentStatus = (searchParams?.get('status') as 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED') || '';
  const currentCursor = searchParams?.get('cursor') || '';
  const selectedApprovalRequestId = searchParams?.get('selected_approval_request_id') || '';

  const [approvals, setApprovals] = useState<ApprovalRequestSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paginationMeta, setPaginationMeta] = useState<PaginatedList<ApprovalRequestSummary>['meta']>({
    pagination: { limit: 50, next_cursor: null, has_more: false },
  });

  // Selected Detail State
  const [detail, setDetail] = useState<ApprovalRequestDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [conflict409, setConflict409] = useState(false);

  // Dialog State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isDecisionModalOpen, setIsDecisionModalOpen] = useState<'APPROVE' | 'REJECT' | 'CANCEL' | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);

  // Create Form State
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [createTitle, setCreateTitle] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createApproverId, setCreateApproverId] = useState('');
  const [createTaskId, setCreateTaskId] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);

  // Focus trap / Restoration refs
  const detailModalRef = useRef<HTMLDivElement | null>(null);
  const createModalRef = useRef<HTMLDivElement | null>(null);
  const decisionModalRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const decisionTriggerRef = useRef<HTMLElement | null>(null);
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const membersRequestRef = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const role = !workspaceResolving && activeWorkspace?.id === workspaceId ? activeWorkspace.role : 'MEMBER';
  const isManager = role === 'MANAGER';
  const isAdmin = role === 'ADMIN';
  const currentUserId = user?.id || '';
  const currentTeamId = searchParams?.get('team_id') || '';

  // Update URL helper preserving valid query state
  const updateUrl = useCallback(
    (newParams: { view?: string; status?: string; cursor?: string | null; selected_approval_request_id?: string | null }) => {
      const sp = new URLSearchParams(searchParams?.toString() || '');
      if (newParams.view !== undefined) {
        if (newParams.view) sp.set('view', newParams.view);
        else sp.delete('view');
        sp.delete('cursor');
      }
      if (newParams.status !== undefined) {
        if (newParams.status) sp.set('status', newParams.status);
        else sp.delete('status');
        sp.delete('cursor');
      }
      if (newParams.cursor !== undefined) {
        if (newParams.cursor) sp.set('cursor', newParams.cursor);
        else sp.delete('cursor');
      }
      if (newParams.selected_approval_request_id !== undefined) {
        if (newParams.selected_approval_request_id) sp.set('selected_approval_request_id', newParams.selected_approval_request_id);
        else sp.delete('selected_approval_request_id');
      }

      router.push(`/workspaces/${workspaceId}/approvals?${sp.toString()}`);
    },
    [router, searchParams, workspaceId]
  );

  const updateUrlRef = useRef(updateUrl);
  updateUrlRef.current = updateUrl;

  // Normalize view if unauthorized
  useEffect(() => {
    if (workspaceResolving || activeWorkspace?.id !== workspaceId) return;
    if ((currentView === 'all' && !isAdmin) || (currentView === 'managed' && !isManager)) updateUrl({ view: 'inbox' });
  }, [activeWorkspace?.id, currentView, isAdmin, isManager, updateUrl, workspaceId, workspaceResolving]);

  // Fetch approval list
  const fetchApprovals = useCallback(async () => {
    const request = ++listRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api.approvals.list(workspaceId, {
        view: currentView,
        status: currentStatus ? (currentStatus as 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED') : undefined,
        team_id: currentView === 'managed' || currentView === 'all' ? currentTeamId || undefined : undefined,
        cursor: currentCursor || undefined,
        limit: 50,
      });
      if (request === listRequestRef.current) {
        setApprovals(res.data);
        setPaginationMeta(res.meta);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Gagal memuat daftar persetujuan';
      if (request === listRequestRef.current) setError(message);
    } finally {
      if (request === listRequestRef.current) setLoading(false);
    }
  }, [workspaceId, currentView, currentStatus, currentTeamId, currentCursor]);

  useEffect(() => {
    const requests = listRequestRef;
    if (!workspaceResolving && activeWorkspace?.id === workspaceId) fetchApprovals();
    return () => { requests.current++; };
  }, [activeWorkspace?.id, fetchApprovals, workspaceId, workspaceResolving]);

  // Fetch workspace members for create modal
  const fetchMembers = useCallback(async () => {
    const request = ++membersRequestRef.current;
    try {
      const res = await api.workspaces.members(workspaceId);
      if (request === membersRequestRef.current) setMembers(res.data || []);
    } catch {
      // ignore
    }
  }, [workspaceId]);

  // Handle selected_approval_request_id
  const fetchDetail = useCallback(
    async (id: string) => {
      const request = ++detailRequestRef.current;
      setDetail(null);
      setLoadingDetail(true);
      setDetailError(null);
      try {
        const res = await api.approvals.get(workspaceId, id);
        if (request === detailRequestRef.current) setDetail(res.data);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Gagal memuat detail persetujuan';
        if (request === detailRequestRef.current) setDetailError(message);
      } finally {
        if (request === detailRequestRef.current) setLoadingDetail(false);
      }
    },
    [workspaceId]
  );

  useEffect(() => {
    setMembers([]);
    setCreateApproverId('');
    if (workspaceResolving || activeWorkspace?.id !== workspaceId) return;
    const requests = detailRequestRef;
    const memberRequests = membersRequestRef;
    if (selectedApprovalRequestId === 'new') {
      setIsCreateOpen(true);
      setDetail(null);
      fetchMembers();
    } else if (selectedApprovalRequestId) {
      setIsCreateOpen(false);
      fetchDetail(selectedApprovalRequestId);
    } else {
      setIsCreateOpen(false);
      setDetail(null);
    }
    return () => { requests.current++; memberRequests.current++; };
  }, [activeWorkspace?.id, fetchDetail, fetchMembers, selectedApprovalRequestId, workspaceId, workspaceResolving]);

  // Focus trap and Escape key listener for dialogs
  const activeModal = isDecisionModalOpen ? 'decision' : selectedApprovalRequestId === 'new' ? (isCreateOpen ? 'create' : null) : selectedApprovalRequestId ? 'detail' : null;
  useEffect(() => {
    const detailModal = detailModalRef.current;
    const modal = activeModal === 'decision' ? decisionModalRef.current : activeModal === 'create' ? createModalRef.current : activeModal === 'detail' ? detailModalRef.current : null;
    if (!modal) return;
    const focusable = () => Array.from(modal.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((element) => getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none');
    if (!modal.contains(document.activeElement)) focusable()[0]?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (activeModal === 'decision') {
          setIsDecisionModalOpen(null);
        } else if (selectedApprovalRequestId) {
          updateUrlRef.current({ selected_approval_request_id: null });
        }
      } else if (e.key === 'Tab') {
        const items = focusable();
        const first = items[0], last = items[items.length - 1];
        if (!first) { e.preventDefault(); modal.focus(); }
        else if (e.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const trigger = activeModal === 'decision' ? decisionTriggerRef.current : triggerRef.current;
      if (trigger?.isConnected) trigger.focus();
      else if (activeModal === 'decision') detailModal?.querySelector('button')?.focus();
      else document.querySelector<HTMLElement>('button[aria-label="New Approval Request"]')?.focus();
    };
  }, [activeModal, selectedApprovalRequestId]);

  // Decision Handler (Approve / Reject / Cancel)
  const handleExecuteAction = async () => {
    if (!detail || !isDecisionModalOpen) return;

    setActionSubmitting(true);
    setActionError(null);
    setConflict409(false);

    try {
      const trimmedReason = decisionReason.trim();

      if (trimmedReason.length > 500) {
        setActionError('Alasan tidak boleh melebihi 500 karakter.');
        setActionSubmitting(false);
        return;
      }

      let updated: { data: ApprovalRequestDetail };

      if (isDecisionModalOpen === 'APPROVE') {
        updated = await api.approvals.approve(workspaceId, detail.id, detail.step.id, {
          reason: trimmedReason || null,
        });
      } else if (isDecisionModalOpen === 'REJECT') {
        if (trimmedReason.length < 3) {
          setActionError('Alasan penolakan minimal 3 karakter.');
          setActionSubmitting(false);
          return;
        }
        updated = await api.approvals.reject(workspaceId, detail.id, detail.step.id, {
          reason: trimmedReason,
        });
      } else {
        // CANCEL
        updated = await api.approvals.cancel(workspaceId, detail.id, {
          reason: trimmedReason || null,
        });
      }

      if (!mounted.current) return;
      setDetail(updated.data);
      setIsDecisionModalOpen(null);
      setDecisionReason('');
      fetchApprovals();
    } catch {
      if (!mounted.current) return;
      setConflict409(true);
      setIsDecisionModalOpen(null);
      fetchDetail(detail.id);
      fetchApprovals();
    } finally {
      if (mounted.current) setActionSubmitting(false);
    }
  };

  // Create Request Submission
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createTitle.trim()) {
      setCreateError('Judul wajib diisi');
      return;
    }
    if (!createApproverId) {
      setCreateError('Pilih pemberi persetujuan');
      return;
    }

    setCreateSubmitting(true);
    setCreateError(null);

    try {
      const res = await api.approvals.create(workspaceId, {
        title: createTitle.trim(),
        description: createDescription.trim() || null,
        approver_user_id: createApproverId,
        task_id: createTaskId.trim() || null,
      });

      if (!mounted.current) return;
      setIsCreateOpen(false);
      setCreateTitle('');
      setCreateDescription('');
      setCreateApproverId('');
      setCreateTaskId('');
      fetchApprovals();
      updateUrl({ selected_approval_request_id: res.data.id });
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (!mounted.current) return;
      if (code === 'SELF_APPROVAL_NOT_ALLOWED') {
        setCreateError('Anda tidak dapat memilih diri sendiri sebagai pemberi persetujuan.');
      } else if (code === 'INACTIVE_APPROVER') {
        setCreateError('Pemberi persetujuan yang dipilih tidak aktif atau ditangguhkan.');
      } else if (code === 'INVALID_APPROVER_TARGET') {
        setCreateError('Pemberi persetujuan yang dipilih tidak memiliki akses untuk melihat tugas terkait.');
      } else if (code === 'CROSS_WORKSPACE_REFERENCE') {
        setCreateError('Pengguna atau tugas yang dirujuk milik workspace lain.');
      } else {
        const message = err instanceof Error ? err.message : 'Gagal membuat permintaan persetujuan';
        setCreateError(message);
      }
    } finally {
      if (mounted.current) setCreateSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'APPROVED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
            <CheckCircle className="w-3 h-3 mr-1 text-emerald-600 dark:text-emerald-400" />
            Disetujui
          </span>
        );
      case 'REJECTED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800">
            <XCircle className="w-3 h-3 mr-1 text-rose-600 dark:text-rose-400" />
            Ditolak
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border">
            <AlertCircle className="w-3 h-3 mr-1 text-muted-foreground" />
            Dibatalkan
          </span>
        );
      case 'PENDING':
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800">
            <Clock className="w-3 h-3 mr-1 text-amber-600 dark:text-amber-400" />
            Menunggu
          </span>
        );
    }
  };

  const tabs: { key: 'inbox' | 'sent' | 'managed' | 'all'; label: string; text: string; visible: boolean }[] = [
    { key: 'inbox', label: 'Kotak Masuk', text: 'Kotak Masuk', visible: true },
    { key: 'sent', label: 'Dikirim', text: 'Dikirim', visible: true },
    { key: 'managed', label: 'Dikelola', text: 'Dikelola', visible: isManager },
    { key: 'all', label: 'Semua', text: 'Semua', visible: isAdmin },
  ];

  // Action Buttons Authorization Rules
  const canDecide = detail && detail.status === 'PENDING' && (detail.step.approver.id === currentUserId || isAdmin) && detail.requester.id !== currentUserId;
  const canCancel = detail && detail.status === 'PENDING' && (detail.requester.id === currentUserId || isAdmin);

  return (
    <div className="flex-1 flex flex-col p-4 sm:p-6 max-w-7xl mx-auto w-full space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-1">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Persetujuan</h1>
            <p className="text-sm text-muted-foreground">Kelola alur persetujuan, tinjauan permohonan, dan riwayat keputusan tim</p>
          </div>
          <button
            onClick={(e) => {
              triggerRef.current = e.currentTarget;
              updateUrl({ selected_approval_request_id: 'new' });
            }}
            aria-label="New Approval Request"
            className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 transition shadow-xs focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <Plus className="w-4 h-4 mr-2" />
            <span>Permintaan Baru</span>
          </button>
        </div>

        {/* View Tabs & Filter Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-4">
          <nav className="flex space-x-1 p-1 bg-surface-subtle border border-border rounded-lg" role="tablist" aria-label="Approvals Views">
            {tabs
              .filter((t) => t.visible)
              .map((t) => {
                const isActive = currentView === t.key;
                return (
                  <button
                    key={t.key}
                    role="tab"
                    aria-selected={isActive}
                    aria-label={t.label}
                    aria-controls={`panel-${t.key}`}
                    id={`tab-${t.key}`}
                    onClick={() => updateUrl({ view: t.key })}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
                      isActive
                        ? 'bg-surface text-foreground shadow-xs font-semibold'
                        : 'text-muted-foreground hover:text-foreground hover:bg-surface/50'
                    }`}
                  >
                    <span>{t.text}</span>
                  </button>
                );
              })}
          </nav>

          <div className="flex items-center space-x-2">
            <label htmlFor="status-filter" className="text-sm font-medium text-muted-foreground whitespace-nowrap">
              Status:
            </label>
            <select
              id="status-filter"
              value={currentStatus}
              onChange={(e) => updateUrl({ status: e.target.value })}
              className="px-3 py-1.5 text-sm bg-surface border border-border rounded-md text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring transition"
            >
              <option value="">Semua Status</option>
              <option value="PENDING">Menunggu</option>
              <option value="APPROVED">Disetujui</option>
              <option value="REJECTED">Ditolak</option>
              <option value="CANCELLED">Dibatalkan</option>
            </select>
          </div>
        </div>

        {/* List Content */}
        {loading ? (
          <div className="flex justify-center py-12" aria-live="polite">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : error ? (
          <div className="rounded-md bg-danger/10 p-4 border border-danger/20" role="alert">
            <p className="text-sm text-danger">{error}</p>
          </div>
        ) : approvals.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-border rounded-lg bg-surface-subtle/50">
            <Clock className="mx-auto h-10 w-10 text-muted-foreground" />
            <h3 className="mt-3 text-sm font-semibold text-foreground">Belum ada permohonan persetujuan</h3>
            <p className="mt-1 text-sm text-muted-foreground">Tidak ada permohonan yang cocok dengan filter yang dipilih saat ini.</p>
          </div>
        ) : (
          <div className="space-y-3" role="tabpanel" id={`panel-${currentView}`} aria-labelledby={`tab-${currentView}`}>
            {approvals.map((item) => (
              <button type="button"
                key={item.id}
                onClick={(e) => {
                  triggerRef.current = e.currentTarget;
                  updateUrl({ selected_approval_request_id: item.id });
                }}
                className="flex w-full items-center justify-between p-4 text-left bg-surface border border-border rounded-lg hover:border-primary/50 cursor-pointer transition shadow-xs group"
              >
                <div className="space-y-1.5 min-w-0 pr-4">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-foreground truncate group-hover:text-primary transition">{item.title}</span>
                    {getStatusBadge(item.status)}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      Pemohon: <strong className="font-medium text-foreground">{item.requester.full_name}</strong>
                    </span>
                    <span>
                      Pemberi persetujuan: <strong className="font-medium text-foreground">{item.approver.full_name}</strong>
                    </span>
                    <span>Diajukan: {new Date(item.submitted_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition flex-shrink-0" />
              </button>
            ))}

            {/* Pagination Controls */}
            {paginationMeta?.pagination?.has_more && paginationMeta?.pagination?.next_cursor && (
              <div className="flex justify-center pt-4">
                <button
                  onClick={() => updateUrl({ cursor: paginationMeta.pagination.next_cursor })}
                  className="inline-flex items-center px-4 py-2 text-sm font-medium text-foreground bg-surface border border-border rounded-md hover:bg-surface-subtle transition shadow-xs"
                >
                  Muat Lebih Banyak
                </button>
              </div>
            )}
          </div>
        )}

        {/* Create Dialog Modal */}
        {isCreateOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay" role="dialog" aria-modal="true" aria-labelledby="create-dialog-title">
            <div ref={createModalRef} tabIndex={-1} className="w-full max-w-lg bg-surface rounded-xl shadow-xl overflow-hidden border border-border">
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <h2 id="create-dialog-title" className="text-lg font-semibold text-foreground">
                  Buat Permintaan Persetujuan Baru
                </h2>
                <button
                  onClick={() => updateUrl({ selected_approval_request_id: null })}
                  className="p-1 text-muted-foreground hover:text-foreground rounded transition"
                  aria-label="Close dialog"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreateSubmit} className="p-6 space-y-4">
                {createError && (
                  <div className="p-3 bg-danger/10 border border-danger/20 rounded-md text-sm text-danger" role="alert">
                    {createError}
                  </div>
                )}

                <div>
                  <label htmlFor="create-title" className="block text-sm font-medium text-foreground mb-1">
                    Judul <span className="text-danger">*</span>
                  </label>
                  <input
                    id="create-title"
                    type="text"
                    required
                    value={createTitle}
                    onChange={(e) => setCreateTitle(e.target.value)}
                    placeholder="misal: Persetujuan Pengeluaran Anggaran Q4"
                    className="w-full px-3 py-2 text-sm bg-surface border border-border rounded-md text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
                  />
                </div>

                <div>
                  <label htmlFor="create-approver" className="block text-sm font-medium text-foreground mb-1">
                    Pemberi Persetujuan <span className="text-danger">*</span>
                  </label>
                  <select
                    id="create-approver"
                    required
                    value={createApproverId}
                    onChange={(e) => setCreateApproverId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-surface border border-border rounded-md text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
                  >
                    <option value="">-- Pilih Pemberi Persetujuan --</option>
                    {members
                      .filter((m) => {
                        const id = m.user_id || (m as unknown as { id?: string }).id;
                        const status = m.status || (m as unknown as { membership_status?: string }).membership_status;
                        const isActive = (m as unknown as { is_active?: boolean }).is_active ?? true;
                        return id !== currentUserId && (status === 'ACTIVE' || status === undefined) && isActive !== false;
                      })
                      .map((m) => {
                        const id = m.user_id || (m as unknown as { id: string }).id;
                        const name = m.full_name || (m as unknown as { name: string }).name;
                        return (
                          <option key={id} value={id}>
                            {name} ({m.role})
                          </option>
                        );
                      })}
                  </select>
                </div>

                <div>
                  <label htmlFor="create-description" className="block text-sm font-medium text-foreground mb-1">
                    Deskripsi (Opsional)
                  </label>
                  <textarea
                    id="create-description"
                    rows={3}
                    value={createDescription}
                    onChange={(e) => setCreateDescription(e.target.value)}
                    placeholder="Konteks dan rincian permohonan persetujuan..."
                    className="w-full px-3 py-2 text-sm bg-surface border border-border rounded-md text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
                  />
                </div>

                <div>
                  <label htmlFor="create-task-id" className="block text-sm font-medium text-foreground mb-1">
                    ID Tugas Terkait (Opsional UUID)
                  </label>
                  <input
                    id="create-task-id"
                    type="text"
                    value={createTaskId}
                    onChange={(e) => setCreateTaskId(e.target.value)}
                    placeholder="misal: 123e4567-e89b-12d3-a456-426614174000"
                    className="w-full px-3 py-2 text-sm bg-surface border border-border rounded-md text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
                  />
                </div>

                <div className="flex justify-end space-x-3 pt-4 border-t border-border">
                  <button
                    type="button"
                    onClick={() => updateUrl({ selected_approval_request_id: null })}
                    className="px-4 py-2 text-sm font-medium text-foreground bg-surface border border-border hover:bg-surface-subtle rounded-md transition"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={createSubmitting}
                    aria-label="Submit Request"
                    className="px-4 py-2 text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 rounded-md transition disabled:opacity-50"
                  >
                    {createSubmitting ? 'Mengirimkan...' : 'Kirim Permintaan'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Approval Detail Drawer/Modal */}
        {selectedApprovalRequestId && selectedApprovalRequestId !== 'new' && (
          <div className="fixed inset-0 z-50 flex items-center justify-end bg-overlay" role="dialog" aria-modal={!isDecisionModalOpen} aria-labelledby="detail-dialog-title" inert={!!isDecisionModalOpen}>
            <div ref={detailModalRef} tabIndex={-1} className="w-full max-w-2xl h-full bg-surface shadow-2xl flex flex-col border-l border-border overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-surface z-10">
                <h2 id="detail-dialog-title" className="text-lg font-bold text-foreground">
                  Detail Persetujuan
                </h2>
                <button
                  onClick={() => updateUrl({ selected_approval_request_id: null })}
                  className="p-1.5 text-muted-foreground hover:text-foreground rounded transition"
                  aria-label="Close approval detail"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {loadingDetail ? (
                <div className="flex justify-center items-center flex-1 py-12" aria-live="polite">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              ) : detailError ? (
                <div className="p-6">
                  <div className="p-4 bg-danger/10 border border-danger/20 rounded-md text-danger" role="alert">
                    {detailError}
                  </div>
                </div>
              ) : detail ? (
                <div className="p-6 space-y-6 flex-1">
                  {/* Conflict Banner */}
                  {conflict409 && (
                    <div className="p-4 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-md flex items-start space-x-3" role="alert">
                      <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div className="text-sm text-amber-800 dark:text-amber-200">
                        <p className="font-semibold">Permintaan ini tidak lagi dalam status menunggu.</p>
                        <p className="mt-0.5">Pengguna lain telah memperbarui persetujuan ini. Menampilkan status kanonikal terbaru di bawah.</p>
                      </div>
                    </div>
                  )}

                  {/* Summary Card */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xl font-bold text-foreground">{detail.title}</h3>
                      {getStatusBadge(detail.status)}
                    </div>
                    {detail.description && <p className="text-sm text-muted-foreground">{detail.description}</p>}
                  </div>

                  {/* Linked Task Summary */}
                  {detail.task && (
                    <div className="p-4 bg-surface-subtle border border-border rounded-lg flex items-center justify-between">
                      <div>
                        <span className="text-xs font-semibold uppercase tracking-wider text-primary">Tugas Terkait</span>
                        <p className="text-sm font-semibold text-foreground">
                          [{detail.task.task_key}] {detail.task.title}
                        </p>
                      </div>
                      <button
                        onClick={() => router.push(`/workspaces/${workspaceId}/tasks?selected_task_id=${detail.task!.id}`)}
                        className="inline-flex items-center px-3 py-1 text-xs font-medium text-foreground bg-surface border border-border rounded hover:bg-surface-subtle transition"
                      >
                        Lihat Tugas
                        <ArrowRight className="w-3 h-3 ml-1" />
                      </button>
                    </div>
                  )}

                  {/* Audit Timeline Grid */}
                  <div className="border-t border-b border-border py-4 space-y-3">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Metadata Audit & Siklus Hidup</h4>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-xs text-muted-foreground">Pemohon</span>
                        <p className="font-semibold text-foreground">{detail.requester.full_name}</p>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">Pemberi Persetujuan</span>
                        <p className="font-semibold text-foreground">{detail.step.approver.full_name}</p>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">Waktu Pengajuan</span>
                        <p className="font-medium text-foreground">{formatDateTimeDisplay(detail.submitted_at)}</p>
                      </div>

                      {/* Decided Actor audit */}
                      {detail.step.decided_by && (
                        <div>
                          <span className="text-xs text-muted-foreground">Diputuskan Oleh</span>
                          <p className="font-semibold text-foreground">
                            {detail.step.decided_by.full_name}
                            {detail.step.decided_by.id !== detail.step.approver.id && (
                              <span className="ml-2 text-xs px-2 py-0.5 bg-primary/10 text-primary border border-primary/20 rounded">
                                Pengambilalihan Admin
                              </span>
                            )}
                          </p>
                        </div>
                      )}

                      {/* Cancelled Actor audit */}
                      {detail.cancelled_by && (
                        <div>
                          <span className="text-xs text-muted-foreground">Dibatalkan Oleh</span>
                          <p className="font-semibold text-foreground">
                            {detail.cancelled_by.full_name}
                            {detail.cancelled_by.id !== detail.requester.id && (
                              <span className="ml-2 text-xs px-2 py-0.5 bg-primary/10 text-primary border border-primary/20 rounded">
                                Pengambilalihan Admin
                              </span>
                            )}
                          </p>
                        </div>
                      )}

                      {detail.step.decided_at && (
                        <div>
                          <span className="text-xs text-muted-foreground">Waktu Keputusan</span>
                          <p className="font-medium text-foreground">{formatDateTimeDisplay(detail.step.decided_at)}</p>
                        </div>
                      )}

                      {detail.completed_at && (
                        <div>
                          <span className="text-xs text-muted-foreground">Waktu Selesai</span>
                          <p className="font-medium text-foreground">{formatDateTimeDisplay(detail.completed_at)}</p>
                        </div>
                      )}
                    </div>

                    {/* Decision/Cancel Reason display */}
                    {(detail.step.reason || detail.cancel_reason) && (
                      <div className="pt-2">
                        <span className="text-xs text-muted-foreground">Alasan</span>
                        <div className="p-3 bg-surface-subtle border border-border rounded-md text-sm text-foreground mt-1 italic">
                          &quot;{detail.step.reason || detail.cancel_reason}&quot;
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Action Bar */}
                  {detail.status === 'PENDING' && (
                    <div className="pt-4 flex items-center justify-end space-x-3">
                      {canCancel && (
                        <button
                          aria-label="Cancel Request"
                          onClick={(e) => {
                            decisionTriggerRef.current = e.currentTarget;
                            setDecisionReason('');
                            setActionError(null);
                            setIsDecisionModalOpen('CANCEL');
                          }}
                          className="px-4 py-2 text-sm font-medium text-foreground bg-surface border border-border hover:bg-surface-subtle rounded-md transition shadow-xs"
                        >
                          <span aria-hidden="true">Batalkan Permintaan</span>
                        </button>
                      )}

                      {canDecide && (
                        <>
                          <button
                            aria-label="Reject"
                            onClick={(e) => {
                              decisionTriggerRef.current = e.currentTarget;
                              setDecisionReason('');
                              setActionError(null);
                              setIsDecisionModalOpen('REJECT');
                            }}
                            className="px-4 py-2 text-sm font-medium text-white dark:text-background bg-danger hover:bg-danger/90 rounded-md transition shadow-xs"
                          >
                            <span aria-hidden="true">Tolak</span>
                          </button>
                          <button
                            aria-label="Approve"
                            onClick={(e) => {
                              decisionTriggerRef.current = e.currentTarget;
                              setDecisionReason('');
                              setActionError(null);
                              setIsDecisionModalOpen('APPROVE');
                            }}
                            className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition shadow-xs"
                          >
                            <span aria-hidden="true">Setujui</span>
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* Action Decision Confirmation Modal */}
        {isDecisionModalOpen && detail && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay" role="dialog" aria-modal="true" aria-labelledby="decision-modal-title">
            <div ref={decisionModalRef} tabIndex={-1} className="w-full max-w-md bg-surface rounded-xl shadow-xl overflow-hidden border border-border p-6 space-y-4">
              <h3 id="decision-modal-title" className="text-lg font-bold text-foreground">
                {isDecisionModalOpen === 'APPROVE' && 'Konfirmasi Persetujuan'}
                {isDecisionModalOpen === 'REJECT' && 'Konfirmasi Penolakan'}
                {isDecisionModalOpen === 'CANCEL' && 'Konfirmasi Pembatalan'}
              </h3>

              {actionError && (
                <div className="p-3 bg-danger/10 border border-danger/20 rounded-md text-sm text-danger" role="alert">
                  {actionError}
                </div>
              )}

              <div>
                <label htmlFor="decision-reason" className="block text-sm font-medium text-foreground mb-1">
                  {isDecisionModalOpen === 'REJECT' ? 'Alasan Penolakan (wajib, min 3 karakter)' : 'Alasan (Opsional)'}
                </label>
                <textarea
                  id="decision-reason"
                  aria-label={isDecisionModalOpen === 'REJECT' ? 'Rejection Reason' : 'Reason (Optional)'}
                  rows={3}
                  value={decisionReason}
                  onChange={(e) => setDecisionReason(e.target.value)}
                  placeholder={isDecisionModalOpen === 'REJECT' ? 'Jelaskan alasan permohonan ditolak...' : 'Catatan opsional...'}
                  className="w-full px-3 py-2 text-sm bg-surface border border-border rounded-md text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsDecisionModalOpen(null)}
                  className="px-4 py-2 text-sm font-medium text-foreground bg-surface border border-border hover:bg-surface-subtle rounded-md transition"
                >
                  Kembali
                </button>
                <button
                  type="button"
                  aria-label={
                    isDecisionModalOpen === 'APPROVE'
                      ? 'Confirm Approval'
                      : isDecisionModalOpen === 'REJECT'
                      ? 'Confirm Rejection'
                      : 'Confirm Cancellation'
                  }
                  disabled={
                    actionSubmitting ||
                    (isDecisionModalOpen === 'REJECT' && (decisionReason.trim().length < 3 || decisionReason.trim().length > 500)) ||
                    ((isDecisionModalOpen === 'APPROVE' || isDecisionModalOpen === 'CANCEL') && decisionReason.trim().length > 500)
                  }
                  onClick={handleExecuteAction}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition disabled:opacity-50 ${
                    isDecisionModalOpen === 'REJECT'
                      ? 'text-white dark:text-background bg-danger hover:bg-danger/90'
                      : isDecisionModalOpen === 'APPROVE'
                      ? 'text-white bg-emerald-600 hover:bg-emerald-700'
                      : 'text-foreground bg-surface-raised border border-border hover:bg-surface-subtle'
                  }`}
                >
                  <span aria-hidden="true">
                    {actionSubmitting
                      ? 'Memproses...'
                      : isDecisionModalOpen === 'APPROVE'
                      ? 'Konfirmasi Persetujuan'
                      : isDecisionModalOpen === 'REJECT'
                      ? 'Konfirmasi Penolakan'
                      : 'Konfirmasi Pembatalan'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
  );
}
