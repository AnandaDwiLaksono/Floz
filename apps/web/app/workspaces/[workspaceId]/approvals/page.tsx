'use client';

import React, { useEffect, useState, useCallback, useTransition, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../../lib/auth-context';
import {
  api,
  ApprovalRequestDetail,
  ApprovalRequestSummary,
  PaginatedList,
  WorkspaceMember,
} from '../../../../lib/api-client';
import { Shell } from '../../../../components/shell';
import {
  CheckCircle,
  Clock,
  XCircle,
  AlertCircle,
  Plus,
  ChevronRight,
  X,
  AlertTriangle,
} from 'lucide-react';

export default function ApprovalsPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = String(params.workspaceId);
  const { activeWorkspace, user } = useAuth();
  const [, startTransition] = useTransition();

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

  const role = activeWorkspace?.role || 'MEMBER';
  const isManager = role === 'MANAGER';
  const isAdmin = role === 'ADMIN';
  const currentUserId = user?.id || '';

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

      startTransition(() => {
        router.push(`/workspaces/${workspaceId}/approvals?${sp.toString()}`);
      });
    },
    [router, searchParams, workspaceId]
  );

  // Normalize view if unauthorized
  const normalizedRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentView === 'all' && !isAdmin && normalizedRef.current !== 'all') {
      normalizedRef.current = 'all';
      updateUrl({ view: 'inbox', cursor: undefined });
    } else if (currentView === 'managed' && !isManager && normalizedRef.current !== 'managed') {
      normalizedRef.current = 'managed';
      updateUrl({ view: 'inbox', cursor: undefined });
    }
  }, [currentView, isAdmin, isManager, updateUrl]);

  // Fetch approval list
  const fetchApprovals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.approvals.list(workspaceId, {
        view: currentView,
        status: currentStatus ? (currentStatus as 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED') : undefined,
        cursor: currentCursor || undefined,
        limit: 50,
      });
      setApprovals(res.data);
      setPaginationMeta(res.meta);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch approvals';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, currentView, currentStatus, currentCursor]);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  // Fetch workspace members for create modal
  const fetchMembers = useCallback(async () => {
    try {
      const res = await api.workspaces.members(workspaceId);
      setMembers(res.data || []);
    } catch {
      // ignore
    }
  }, [workspaceId]);

  // Handle selected_approval_request_id
  const fetchDetail = useCallback(
    async (id: string) => {
      setLoadingDetail(true);
      setDetailError(null);
      try {
        const res = await api.approvals.get(workspaceId, id);
        setDetail(res.data);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to load approval detail';
        setDetailError(message);
      } finally {
        setLoadingDetail(false);
      }
    },
    [workspaceId]
  );

  useEffect(() => {
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
  }, [selectedApprovalRequestId, fetchDetail, fetchMembers]);

  // Focus trap and Escape key listener for dialogs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isDecisionModalOpen) {
          setIsDecisionModalOpen(null);
        } else if (selectedApprovalRequestId) {
          updateUrl({ selected_approval_request_id: null });
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isDecisionModalOpen, selectedApprovalRequestId, updateUrl]);

  // Decision Handler (Approve / Reject / Cancel)
  const handleExecuteAction = async () => {
    if (!detail || !isDecisionModalOpen) return;

    setActionSubmitting(true);
    setActionError(null);
    setConflict409(false);

    try {
      const trimmedReason = decisionReason.trim();

      if (trimmedReason.length > 500) {
        setActionError('Reason cannot exceed 500 characters.');
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
          setActionError('Rejection reason must be at least 3 characters.');
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

      setDetail(updated.data);
      setIsDecisionModalOpen(null);
      setDecisionReason('');
      fetchApprovals();
    } catch {
      setConflict409(true);
      setIsDecisionModalOpen(null);
      fetchDetail(detail.id);
      fetchApprovals();
    } finally {
      setActionSubmitting(false);
    }
  };

  // Create Request Submission
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createTitle.trim()) {
      setCreateError('Title is required');
      return;
    }
    if (!createApproverId) {
      setCreateError('Please select an approver');
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

      setIsCreateOpen(false);
      setCreateTitle('');
      setCreateDescription('');
      setCreateApproverId('');
      setCreateTaskId('');
      fetchApprovals();
      updateUrl({ selected_approval_request_id: res.data.id });
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'SELF_APPROVAL_NOT_ALLOWED') {
        setCreateError('You cannot select yourself as the approver.');
      } else if (code === 'INACTIVE_APPROVER') {
        setCreateError('The selected approver is inactive or suspended.');
      } else if (code === 'INVALID_APPROVER_TARGET') {
        setCreateError('The selected approver does not have access to view the linked task.');
      } else if (code === 'CROSS_WORKSPACE_REFERENCE') {
        setCreateError('Referenced user or task belongs to another workspace.');
      } else {
        const message = err instanceof Error ? err.message : 'Failed to create approval request';
        setCreateError(message);
      }
    } finally {
      setCreateSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'APPROVED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300">
            <CheckCircle className="w-3 h-3 mr-1" />
            APPROVED
          </span>
        );
      case 'REJECTED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">
            <XCircle className="w-3 h-3 mr-1" />
            REJECTED
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300">
            <AlertCircle className="w-3 h-3 mr-1" />
            CANCELLED
          </span>
        );
      case 'PENDING':
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300">
            <Clock className="w-3 h-3 mr-1" />
            PENDING
          </span>
        );
    }
  };

  const tabs: { key: 'inbox' | 'sent' | 'managed' | 'all'; label: string; visible: boolean }[] = [
    { key: 'inbox', label: 'Inbox', visible: true },
    { key: 'sent', label: 'Sent', visible: true },
    { key: 'managed', label: 'Managed', visible: isManager },
    { key: 'all', label: 'All', visible: isAdmin },
  ];

  // Action Buttons Authorization Rules
  const canDecide = detail && detail.status === 'PENDING' && (detail.step.approver.id === currentUserId || isAdmin) && detail.requester.id !== currentUserId;
  const canCancel = detail && detail.status === 'PENDING' && (detail.requester.id === currentUserId || isAdmin);

  return (
    <Shell>
      <div className="flex-1 flex flex-col p-6 max-w-7xl mx-auto w-full space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Approvals</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Manage review workflows and track decision history</p>
          </div>
          <button
            onClick={(e) => {
              triggerRef.current = e.currentTarget;
              updateUrl({ selected_approval_request_id: 'new' });
            }}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Approval Request
          </button>
        </div>

        {/* View Tabs & Filter Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-4">
          <nav className="flex space-x-2" role="tablist" aria-label="Approvals Views">
            {tabs
              .filter((t) => t.visible)
              .map((t) => {
                const isActive = currentView === t.key;
                return (
                  <button
                    key={t.key}
                    role="tab"
                    aria-selected={isActive}
                    aria-controls={`panel-${t.key}`}
                    id={`tab-${t.key}`}
                    onClick={() => updateUrl({ view: t.key })}
                    className={`px-4 py-2 text-sm font-medium rounded-md transition ${
                      isActive
                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 font-semibold'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
          </nav>

          <div className="flex items-center space-x-3">
            <label htmlFor="status-filter" className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Status:
            </label>
            <select
              id="status-filter"
              value={currentStatus}
              onChange={(e) => updateUrl({ status: e.target.value })}
              className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Statuses</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
        </div>

        {/* List Content */}
        {loading ? (
          <div className="flex justify-center py-12" aria-live="polite">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : error ? (
          <div className="rounded-md bg-red-50 dark:bg-red-950/50 p-4 border border-red-200 dark:border-red-800" role="alert">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        ) : approvals.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed border-gray-200 dark:border-gray-800 rounded-lg">
            <Clock className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-semibold text-gray-900 dark:text-white">No approval requests</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">There are no approval requests matching your current filters.</p>
          </div>
        ) : (
          <div className="space-y-3" role="tabpanel" id={`panel-${currentView}`} aria-labelledby={`tab-${currentView}`}>
            {approvals.map((item) => (
              <div
                key={item.id}
                onClick={(e) => {
                  triggerRef.current = e.currentTarget;
                  updateUrl({ selected_approval_request_id: item.id });
                }}
                className="flex items-center justify-between p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-500 dark:hover:border-blue-500 cursor-pointer transition shadow-sm"
              >
                <div className="space-y-1 min-w-0 pr-4">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-gray-900 dark:text-white truncate">{item.title}</span>
                    {getStatusBadge(item.status)}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                    <span>
                      Requester: <strong className="font-medium text-gray-700 dark:text-gray-300">{item.requester.full_name}</strong>
                    </span>
                    <span>
                      Approver: <strong className="font-medium text-gray-700 dark:text-gray-300">{item.approver.full_name}</strong>
                    </span>
                    <span>Submitted: {new Date(item.submitted_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
              </div>
            ))}

            {/* Pagination Controls */}
            {paginationMeta?.pagination?.has_more && paginationMeta?.pagination?.next_cursor && (
              <div className="flex justify-center pt-4">
                <button
                  onClick={() => updateUrl({ cursor: paginationMeta.pagination.next_cursor })}
                  className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition"
                >
                  Load More
                </button>
              </div>
            )}
          </div>
        )}

        {/* Create Dialog Modal */}
        {isCreateOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true" aria-labelledby="create-dialog-title">
            <div ref={createModalRef} className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-lg shadow-xl overflow-hidden border border-gray-200 dark:border-gray-800">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
                <h2 id="create-dialog-title" className="text-lg font-semibold text-gray-900 dark:text-white">
                  New Approval Request
                </h2>
                <button
                  onClick={() => updateUrl({ selected_approval_request_id: null })}
                  className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
                  aria-label="Close dialog"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreateSubmit} className="p-6 space-y-4">
                {createError && (
                  <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-md text-sm text-red-700 dark:text-red-300" role="alert">
                    {createError}
                  </div>
                )}

                <div>
                  <label htmlFor="create-title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Title <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="create-title"
                    type="text"
                    required
                    value={createTitle}
                    onChange={(e) => setCreateTitle(e.target.value)}
                    placeholder="e.g. Q4 Budget Expenditure Approval"
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label htmlFor="create-approver" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Assigned Approver <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="create-approver"
                    required
                    value={createApproverId}
                    onChange={(e) => setCreateApproverId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">-- Select Eligible Approver --</option>
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
                  <label htmlFor="create-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Description (Optional)
                  </label>
                  <textarea
                    id="create-description"
                    rows={3}
                    value={createDescription}
                    onChange={(e) => setCreateDescription(e.target.value)}
                    placeholder="Context and details for the approver..."
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label htmlFor="create-task-id" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Linked Task ID (Optional UUID)
                  </label>
                  <input
                    id="create-task-id"
                    type="text"
                    value={createTaskId}
                    onChange={(e) => setCreateTaskId(e.target.value)}
                    placeholder="e.g. 123e4567-e89b-12d3-a456-426614174000"
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-800">
                  <button
                    type="button"
                    onClick={() => updateUrl({ selected_approval_request_id: null })}
                    className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createSubmitting}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition disabled:opacity-50"
                  >
                    {createSubmitting ? 'Submitting...' : 'Submit Request'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Approval Detail Drawer/Modal */}
        {selectedApprovalRequestId && selectedApprovalRequestId !== 'new' && (
          <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/50" role="dialog" aria-modal="true" aria-labelledby="detail-dialog-title">
            <div ref={detailModalRef} className="w-full max-w-2xl h-full bg-white dark:bg-gray-900 shadow-2xl flex flex-col border-l border-gray-200 dark:border-gray-800 overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800 sticky top-0 bg-white dark:bg-gray-900 z-10">
                <h2 id="detail-dialog-title" className="text-lg font-bold text-gray-900 dark:text-white">
                  Approval Detail
                </h2>
                <button
                  onClick={() => updateUrl({ selected_approval_request_id: null })}
                  className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition"
                  aria-label="Close approval detail"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {loadingDetail ? (
                <div className="flex justify-center items-center flex-1 py-12" aria-live="polite">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                </div>
              ) : detailError ? (
                <div className="p-6">
                  <div className="p-4 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-md text-red-700 dark:text-red-300" role="alert">
                    {detailError}
                  </div>
                </div>
              ) : detail ? (
                <div className="p-6 space-y-6 flex-1">
                  {/* Conflict Banner */}
                  {conflict409 && (
                    <div className="p-4 bg-yellow-50 dark:bg-yellow-950/50 border border-yellow-200 dark:border-yellow-800 rounded-md flex items-start space-x-3" role="alert">
                      <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                      <div className="text-sm text-yellow-800 dark:text-yellow-200">
                        <p className="font-semibold">This request is no longer pending.</p>
                        <p className="mt-0.5">Another actor updated this approval. Displaying the latest canonical status below.</p>
                      </div>
                    </div>
                  )}

                  {/* Summary Card */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xl font-bold text-gray-900 dark:text-white">{detail.title}</h3>
                      {getStatusBadge(detail.status)}
                    </div>
                    {detail.description && <p className="text-sm text-gray-600 dark:text-gray-300">{detail.description}</p>}
                  </div>

                  {/* Linked Task Summary */}
                  {detail.task && (
                    <div className="p-4 bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900 rounded-lg flex items-center justify-between">
                      <div>
                        <span className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">Linked Task</span>
                        <p className="text-sm font-bold text-gray-900 dark:text-white">
                          [{detail.task.task_key}] {detail.task.title}
                        </p>
                      </div>
                      <button
                        onClick={() => router.push(`/workspaces/${workspaceId}/tasks?selected_task_id=${detail.task!.id}`)}
                        className="px-3 py-1 text-xs font-medium text-blue-700 dark:text-blue-300 bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-800 rounded hover:bg-blue-100 transition"
                      >
                        View Task
                      </button>
                    </div>
                  )}

                  {/* Audit Timeline Grid */}
                  <div className="border-t border-b border-gray-200 dark:border-gray-800 py-4 space-y-3">
                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Audit & Lifecycle Metadata</h4>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">Requester</span>
                        <p className="font-semibold text-gray-900 dark:text-white">{detail.requester.full_name}</p>
                      </div>
                      <div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">Assigned Approver</span>
                        <p className="font-semibold text-gray-900 dark:text-white">{detail.step.approver.full_name}</p>
                      </div>
                      <div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">Submitted At</span>
                        <p className="font-medium text-gray-700 dark:text-gray-300">{new Date(detail.submitted_at).toLocaleString()}</p>
                      </div>

                      {/* Decided Actor audit */}
                      {detail.step.decided_by && (
                        <div>
                          <span className="text-xs text-gray-500 dark:text-gray-400">Decided By</span>
                          <p className="font-semibold text-gray-900 dark:text-white">
                            {detail.step.decided_by.full_name}
                            {detail.step.decided_by.id !== detail.step.approver.id && (
                              <span className="ml-2 text-xs px-2 py-0.5 bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 rounded">
                                ADMIN Override
                              </span>
                            )}
                          </p>
                        </div>
                      )}

                      {/* Cancelled Actor audit */}
                      {detail.cancelled_by && (
                        <div>
                          <span className="text-xs text-gray-500 dark:text-gray-400">Cancelled By</span>
                          <p className="font-semibold text-gray-900 dark:text-white">
                            {detail.cancelled_by.full_name}
                            {detail.cancelled_by.id !== detail.requester.id && (
                              <span className="ml-2 text-xs px-2 py-0.5 bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 rounded">
                                ADMIN Override
                              </span>
                            )}
                          </p>
                        </div>
                      )}

                      {detail.step.decided_at && (
                        <div>
                          <span className="text-xs text-gray-500 dark:text-gray-400">Decided At</span>
                          <p className="font-medium text-gray-700 dark:text-gray-300">{new Date(detail.step.decided_at).toLocaleString()}</p>
                        </div>
                      )}

                      {detail.completed_at && (
                        <div>
                          <span className="text-xs text-gray-500 dark:text-gray-400">Completed At</span>
                          <p className="font-medium text-gray-700 dark:text-gray-300">{new Date(detail.completed_at).toLocaleString()}</p>
                        </div>
                      )}
                    </div>

                    {/* Decision/Cancel Reason display */}
                    {(detail.step.reason || detail.cancel_reason) && (
                      <div className="pt-2">
                        <span className="text-xs text-gray-500 dark:text-gray-400">Reason</span>
                        <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md text-sm text-gray-800 dark:text-gray-200 mt-1 italic">
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
                          onClick={() => {
                            setDecisionReason('');
                            setActionError(null);
                            setIsDecisionModalOpen('CANCEL');
                          }}
                          className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition"
                        >
                          Cancel Request
                        </button>
                      )}

                      {canDecide && (
                        <>
                          <button
                            onClick={() => {
                              setDecisionReason('');
                              setActionError(null);
                              setIsDecisionModalOpen('REJECT');
                            }}
                            className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition"
                          >
                            Reject
                          </button>
                          <button
                            onClick={() => {
                              setDecisionReason('');
                              setActionError(null);
                              setIsDecisionModalOpen('APPROVE');
                            }}
                            className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md transition"
                          >
                            Approve
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" role="dialog" aria-modal="true" aria-labelledby="decision-modal-title">
            <div ref={decisionModalRef} className="w-full max-w-md bg-white dark:bg-gray-900 rounded-lg shadow-xl overflow-hidden border border-gray-200 dark:border-gray-800 p-6 space-y-4">
              <h3 id="decision-modal-title" className="text-lg font-bold text-gray-900 dark:text-white">
                {isDecisionModalOpen === 'APPROVE' && 'Confirm Approval'}
                {isDecisionModalOpen === 'REJECT' && 'Confirm Rejection'}
                {isDecisionModalOpen === 'CANCEL' && 'Confirm Cancellation'}
              </h3>

              {actionError && (
                <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-md text-sm text-red-700 dark:text-red-300" role="alert">
                  {actionError}
                </div>
              )}

              <div>
                <label htmlFor="decision-reason" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {isDecisionModalOpen === 'REJECT' ? 'Rejection Reason (Required, min 3 chars)' : 'Reason (Optional)'}
                </label>
                <textarea
                  id="decision-reason"
                  rows={3}
                  value={decisionReason}
                  onChange={(e) => setDecisionReason(e.target.value)}
                  placeholder={isDecisionModalOpen === 'REJECT' ? 'Explain why this request is rejected...' : 'Optional notes...'}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setIsDecisionModalOpen(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={
                    actionSubmitting ||
                    (isDecisionModalOpen === 'REJECT' && (decisionReason.trim().length < 3 || decisionReason.trim().length > 500)) ||
                    ((isDecisionModalOpen === 'APPROVE' || isDecisionModalOpen === 'CANCEL') && decisionReason.trim().length > 500)
                  }
                  onClick={handleExecuteAction}
                  className={`px-4 py-2 text-sm font-medium text-white rounded-md transition disabled:opacity-50 ${
                    isDecisionModalOpen === 'REJECT'
                      ? 'bg-red-600 hover:bg-red-700'
                      : isDecisionModalOpen === 'APPROVE'
                      ? 'bg-green-600 hover:bg-green-700'
                      : 'bg-gray-700 hover:bg-gray-800'
                  }`}
                >
                  {actionSubmitting
                    ? 'Processing...'
                    : isDecisionModalOpen === 'APPROVE'
                    ? 'Confirm Approval'
                    : isDecisionModalOpen === 'REJECT'
                    ? 'Confirm Rejection'
                    : 'Confirm Cancellation'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
