import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ApprovalsPage from '../app/workspaces/[workspaceId]/approvals/page';
import { api, ApprovalRequestSummary } from '../lib/api-client';

const mockPush = vi.fn();
const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  usePathname: () => '/workspaces/workspace-1/approvals',
  useSearchParams: () => mockSearchParams,
  useParams: () => ({ workspaceId: 'workspace-1' }),
}));

const authState: { role: string } = { role: 'MEMBER' };
vi.mock('../lib/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'user-1', full_name: 'Current User', email: 'user@example.com' },
    activeWorkspace: { id: 'workspace-1', name: 'Test WS', role: authState.role },
  }),
}));

const mockApprovals: ApprovalRequestSummary[] = [
  {
    id: 'appr-1',
    workspace_id: 'workspace-1',
    task_id: null,
    title: 'Budget Request Q4',
    status: 'PENDING',
    requester: { id: 'user-2', full_name: 'Alice Request' },
    approver: { id: 'user-1', full_name: 'Current User' },
    submitted_at: '2026-09-06T10:00:00.000Z',
    created_at: '2026-09-06T10:00:00.000Z',
  },
  {
    id: 'appr-2',
    workspace_id: 'workspace-1',
    task_id: 'task-100',
    title: 'Deployment Signoff',
    status: 'APPROVED',
    requester: { id: 'user-1', full_name: 'Current User' },
    approver: { id: 'user-3', full_name: 'Bob Approver' },
    submitted_at: '2026-09-05T09:00:00.000Z',
    created_at: '2026-09-05T09:00:00.000Z',
  },
];

describe('Phase 10 Task 7 — Approvals List, Navigation, Tabs & Filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    authState.role = 'MEMBER';
    vi.spyOn(api.approvals, 'list').mockResolvedValue({
      data: mockApprovals,
      meta: { pagination: { limit: 50, next_cursor: 'cursor-2', has_more: true } },
    });
  });

  it('renders Inbox and Sent tabs for standard MEMBER; hides Managed and All tabs', async () => {
    authState.role = 'MEMBER';
    render(<ApprovalsPage />);

    expect(screen.getByRole('tab', { name: /Inbox/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Sent/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Managed/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /All/i })).not.toBeInTheDocument();
  });

  it('renders Managed tab for MANAGER, but not All tab', async () => {
    authState.role = 'MANAGER';
    render(<ApprovalsPage />);

    expect(screen.getByRole('tab', { name: /Inbox/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Sent/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Managed/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /All/i })).not.toBeInTheDocument();
  });

  it('renders All tab for ADMIN, but NOT Managed tab', async () => {
    authState.role = 'ADMIN';
    render(<ApprovalsPage />);

    expect(screen.getByRole('tab', { name: /Inbox/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Sent/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Managed/i })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /All/i })).toBeInTheDocument();
  });

  it('normalizes unauthorized view parameter to inbox in URL', async () => {
    authState.role = 'ADMIN';
    mockSearchParams = new URLSearchParams('view=managed');
    render(<ApprovalsPage />);

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('view=inbox'));
  });

  it('handles 403 safely when unauthorized view fetch fails', async () => {
    vi.spyOn(api.approvals, 'list').mockRejectedValueOnce(new Error('FORBIDDEN'));
    render(<ApprovalsPage />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('FORBIDDEN')).toBeInTheDocument();
    });
    // Approvals data not exposed
    expect(screen.queryByText('Budget Request Q4')).not.toBeInTheDocument();
  });

  it('synchronizes view and status changes to URL and resets cursor', async () => {
    render(<ApprovalsPage />);

    // Click Sent tab
    const sentTab = screen.getByRole('tab', { name: /Sent/i });
    fireEvent.click(sentTab);

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('view=sent'));
    expect(mockPush).toHaveBeenCalledWith(expect.not.stringContaining('cursor='));

    // Change status filter
    const statusSelect = screen.getByLabelText(/Status/i);
    fireEvent.change(statusSelect, { target: { value: 'APPROVED' } });

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('status=APPROVED'));
    expect(mockPush).toHaveBeenCalledWith(expect.not.stringContaining('cursor='));
  });

  it('renders approval request cards with title, requester, approver, and status badge', async () => {
    render(<ApprovalsPage />);

    await waitFor(() => {
      expect(screen.getByText('Budget Request Q4')).toBeInTheDocument();
    });

    expect(screen.getByText(/Alice Request/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Current User/i).length).toBeGreaterThan(0);
    expect(screen.getByText('PENDING')).toBeInTheDocument();
  });
});
