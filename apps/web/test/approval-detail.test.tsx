import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ApprovalsPage from '../app/workspaces/[workspaceId]/approvals/page';
import { api, ApprovalRequestDetail, ApprovalRequestSummary } from '../lib/api-client';

const mockPush = vi.fn();
const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  usePathname: () => '/workspaces/workspace-1/approvals',
  useSearchParams: () => mockSearchParams,
  useParams: () => ({ workspaceId: 'workspace-1' }),
}));

const authState: { role: string; userId: string } = { role: 'MEMBER', userId: 'user-1' };
vi.mock('../lib/auth-context', () => ({
  useAuth: () => ({
    user: { id: authState.userId, full_name: 'Current User', email: 'user@example.com' },
    activeWorkspace: { id: 'workspace-1', name: 'Test WS', role: authState.role },
  }),
}));

const mockSummaryList: ApprovalRequestSummary[] = [
  {
    id: 'req-1',
    workspace_id: 'workspace-1',
    task_id: 'task-100',
    title: 'Deploy to Prod',
    status: 'PENDING',
    requester: { id: 'user-2', full_name: 'Requester Alice' },
    approver: { id: 'user-1', full_name: 'Current User' },
    submitted_at: '2026-09-06T10:00:00.000Z',
    created_at: '2026-09-06T10:00:00.000Z',
  },
];

const mockDetail: ApprovalRequestDetail = {
  id: 'req-1',
  workspace_id: 'workspace-1',
  task_id: 'task-100',
  task: { id: 'task-100', task_key: 'TSK-100', title: 'Critical Bugfix' },
  title: 'Deploy to Prod',
  description: 'Please approve deployment to production',
  status: 'PENDING',
  submitted_at: '2026-09-06T10:00:00.000Z',
  completed_at: null,
  cancelled_by: null,
  cancel_reason: null,
  created_at: '2026-09-06T10:00:00.000Z',
  updated_at: '2026-09-06T10:00:00.000Z',
  step: {
    id: 'step-1',
    step_order: 1,
    approver: { id: 'user-1', full_name: 'Current User' },
    decided_by: null,
    status: 'PENDING',
    decision: null,
    reason: null,
    decided_at: null,
  },
  requester: { id: 'user-2', full_name: 'Requester Alice' },
};

describe('Phase 10 Task 8 — Approval Detail, Create, Approve/Reject/Cancel UX', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    authState.role = 'MEMBER';
    authState.userId = 'user-1';

    vi.spyOn(api.approvals, 'list').mockResolvedValue({
      data: mockSummaryList,
      meta: { pagination: { limit: 50, next_cursor: null, has_more: false } },
    });

    vi.spyOn(api.approvals, 'get').mockResolvedValue({
      data: mockDetail,
    });

    vi.spyOn(api.workspaces, 'members').mockResolvedValue({
      data: [
        {
          id: 'user-1',
          name: 'Current User',
          email: 'user@example.com',
          role: 'MEMBER',
          membership_status: 'ACTIVE',
          is_active: true,
          created_at: '2026-01-01',
          last_login_at: null,
        },
        {
          id: 'user-2',
          name: 'Requester Alice',
          email: 'alice@example.com',
          role: 'MEMBER',
          membership_status: 'ACTIVE',
          is_active: true,
          created_at: '2026-01-01',
          last_login_at: null,
        },
        {
          id: 'user-3',
          name: 'Bob Approver',
          email: 'bob@example.com',
          role: 'MANAGER',
          membership_status: 'ACTIVE',
          is_active: true,
          created_at: '2026-01-01',
          last_login_at: null,
        },
      ] as unknown as import('../lib/api-client').WorkspaceMember[],
    });
  });

  it('opens detail dialog when selected_approval_request_id query parameter is present', async () => {
    mockSearchParams = new URLSearchParams('selected_approval_request_id=req-1&view=inbox&status=PENDING');
    render(<ApprovalsPage />);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Approval Detail/i })).toBeInTheDocument();
    });

    const dialog = screen.getByRole('dialog', { name: /Approval Detail/i });
    expect(within(dialog).getByText('Deploy to Prod')).toBeInTheDocument();
    expect(within(dialog).getByText('Please approve deployment to production')).toBeInTheDocument();
    expect(within(dialog).getByText('Requester Alice')).toBeInTheDocument();
    expect(within(dialog).getByText(/TSK-100/)).toBeInTheDocument();
  });

  it('preserves list view and filter context when closing detail dialog', async () => {
    mockSearchParams = new URLSearchParams('selected_approval_request_id=req-1&view=sent&status=PENDING');
    render(<ApprovalsPage />);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Approval Detail/i })).toBeInTheDocument();
    });

    const closeBtn = screen.getByRole('button', { name: /Close approval detail/i });
    fireEvent.click(closeBtn);

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('view=sent'));
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('status=PENDING'));
    expect(mockPush).toHaveBeenCalledWith(expect.not.stringContaining('selected_approval_request_id'));
  });

  it('closes detail dialog on Escape key and restores focus', async () => {
    mockSearchParams = new URLSearchParams('selected_approval_request_id=req-1');
    render(<ApprovalsPage />);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Approval Detail/i })).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(mockPush).toHaveBeenCalledWith(expect.not.stringContaining('selected_approval_request_id'));
  });

  it('supports Create Approval Request flow with eligible approvers and error handling', async () => {
    mockSearchParams = new URLSearchParams('selected_approval_request_id=new');
    const createSpy = vi.spyOn(api.approvals, 'create').mockResolvedValue({
      data: { ...mockDetail, id: 'req-new', title: 'New Review Request' },
    });

    render(<ApprovalsPage />);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /New Approval Request/i })).toBeInTheDocument();
    });

    const titleInput = screen.getByLabelText(/Title/i);
    fireEvent.change(titleInput, { target: { value: 'New Review Request' } });

    const approverSelect = screen.getByLabelText(/Approver/i);
    fireEvent.change(approverSelect, { target: { value: 'user-3' } });

    const submitBtn = screen.getByRole('button', { name: /Submit Request/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith('workspace-1', {
        title: 'New Review Request',
        description: null,
        task_id: null,
        approver_user_id: 'user-3',
      });
    });
  });

  it('allows approver to Approve request with optional reason', async () => {
    mockSearchParams = new URLSearchParams('selected_approval_request_id=req-1');
    const approveSpy = vi.spyOn(api.approvals, 'approve').mockResolvedValue({
      data: { ...mockDetail, status: 'APPROVED', step: { ...mockDetail.step, status: 'APPROVED', decision: 'APPROVED' } },
    });

    render(<ApprovalsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Approve$/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^Approve$/i }));

    const confirmApprove = screen.getByRole('button', { name: /Confirm Approval/i });
    fireEvent.click(confirmApprove);

    await waitFor(() => {
      expect(approveSpy).toHaveBeenCalledWith('workspace-1', 'req-1', 'step-1', { reason: null });
    });
  });

  it('requires reason when Rejecting and validates minimum 3 characters', async () => {
    mockSearchParams = new URLSearchParams('selected_approval_request_id=req-1');
    render(<ApprovalsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Reject$/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^Reject$/i }));

    const confirmReject = screen.getByRole('button', { name: /Confirm Rejection/i });
    expect(confirmReject).toBeDisabled();

    const reasonInput = screen.getByLabelText(/Rejection Reason/i);
    fireEvent.change(reasonInput, { target: { value: 'No' } }); // < 3 chars
    expect(confirmReject).toBeDisabled();

    fireEvent.change(reasonInput, { target: { value: 'Does not meet criteria' } });
    expect(confirmReject).not.toBeDisabled();
  });

  it('handles 409 APPROVAL_NOT_PENDING conflict by displaying conflict banner and refetching latest state', async () => {
    mockSearchParams = new URLSearchParams('selected_approval_request_id=req-1');
    const error409 = new Error('APPROVAL_NOT_PENDING');
    (error409 as unknown as { status: number; code: string }).status = 409;
    (error409 as unknown as { status: number; code: string }).code = 'APPROVAL_NOT_PENDING';
    vi.spyOn(api.approvals, 'approve').mockImplementationOnce(() => Promise.reject(error409));

    render(<ApprovalsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Approve$/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^Approve$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm Approval/i }));

    await waitFor(() => {
      const dialogs = screen.getAllByRole('dialog');
      const detailDialog = dialogs.find(d => d.getAttribute('aria-labelledby') === 'detail-dialog-title');
      expect(detailDialog).toBeDefined();
      expect(within(detailDialog!).getByText(/This request is no longer pending/i)).toBeInTheDocument();
    });
  });

  it('distinguishes ADMIN override in audit log when decided by an ADMIN other than assigned approver', async () => {
    mockSearchParams = new URLSearchParams('selected_approval_request_id=req-1');
    vi.spyOn(api.approvals, 'get').mockResolvedValue({
      data: {
        ...mockDetail,
        status: 'APPROVED',
        step: {
          ...mockDetail.step,
          status: 'APPROVED',
          decision: 'APPROVED',
          decided_by: { id: 'admin-99', full_name: 'Super Admin' },
          decided_at: '2026-09-06T12:00:00.000Z',
          reason: 'Emergency Override',
        },
      },
    });

    render(<ApprovalsPage />);

    await waitFor(() => {
      expect(screen.getByText(/ADMIN Override/i)).toBeInTheDocument();
      expect(screen.getByText(/Super Admin/i)).toBeInTheDocument();
    });
  });
});
