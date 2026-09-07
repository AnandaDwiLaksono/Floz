'use client';

import React, { useEffect, useState, useCallback, useTransition } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../../lib/auth-context';
import { api, ApprovalRequestSummary, PaginatedList } from '../../../../lib/api-client';
import { Shell } from '../../../../components/shell';
import { CheckCircle, Clock, XCircle, AlertCircle, Plus, ChevronRight, ChevronLeft } from 'lucide-react';

export default function ApprovalsPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = String(params.workspaceId);
  const { activeWorkspace } = useAuth();
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

  const role = activeWorkspace?.role || 'MEMBER';
  const isManager = role === 'MANAGER' || role === 'ADMIN';
  const isAdmin = role === 'ADMIN';

  // Normalize invalid view if not authorized
  useEffect(() => {
    if (currentView === 'all' && !isAdmin) {
      updateUrl({ view: 'inbox', cursor: undefined });
    } else if (currentView === 'managed' && !isManager) {
      updateUrl({ view: 'inbox', cursor: undefined });
    }
  }, [currentView, isAdmin, isManager]);

  const updateUrl = useCallback(
    (newParams: { view?: string; status?: string; cursor?: string | null; selected_approval_request_id?: string | null }) => {
      const sp = new URLSearchParams(searchParams?.toString() || '');
      if (newParams.view !== undefined) {
        if (newParams.view) sp.set('view', newParams.view);
        else sp.delete('view');
        sp.delete('cursor'); // Reset cursor on view change
      }
      if (newParams.status !== undefined) {
        if (newParams.status) sp.set('status', newParams.status);
        else sp.delete('status');
        sp.delete('cursor'); // Reset cursor on status change
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
            onClick={() => updateUrl({ selected_approval_request_id: 'new' })}
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
                onClick={() => updateUrl({ selected_approval_request_id: item.id })}
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
      </div>
    </Shell>
  );
}
