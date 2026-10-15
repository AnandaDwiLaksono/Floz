import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ApprovalsPage from '../app/workspaces/[workspaceId]/approvals/page';
import { api, ApprovalRequestSummary } from '../lib/api-client';

const mockPush = vi.fn();
const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams();
let mockWorkspaceId = 'workspace-1';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  usePathname: () => '/workspaces/workspace-1/approvals',
  useSearchParams: () => mockSearchParams,
  useParams: () => ({ workspaceId: mockWorkspaceId }),
}));

const authState: { role: string; workspaceResolving: boolean; workspaceId: string } = { role: 'MEMBER', workspaceResolving: false, workspaceId: 'workspace-1' };
vi.mock('../lib/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'user-1', full_name: 'Current User', email: 'user@example.com' },
    activeWorkspace: { id: authState.workspaceId, name: 'Test WS', role: authState.role },
    workspaceResolving: authState.workspaceResolving,
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
    mockWorkspaceId = 'workspace-1';
    authState.role = 'MEMBER';
    authState.workspaceResolving = false;
    authState.workspaceId = 'workspace-1';
    vi.spyOn(api.approvals, 'list').mockResolvedValue({
      data: mockApprovals,
      meta: { pagination: { limit: 50, next_cursor: 'cursor-2', has_more: true } },
    });
    vi.spyOn(api.approvals, 'get');
    vi.spyOn(api.workspaces, 'members').mockResolvedValue({ data: [] });
  });

  it('does not fetch approvals, detail, or members before matching route context resolves', async () => {
    authState.workspaceResolving = true;
    mockSearchParams = new URLSearchParams('selected_approval_request_id=new');
    render(<ApprovalsPage />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.approvals.list).not.toHaveBeenCalled();
    expect(api.approvals.get).not.toHaveBeenCalled();
    expect(api.workspaces.members).not.toHaveBeenCalled();
  });

  it.each([true, false])('never commits old workspace approval data during navigation (resolving=%s)', async (resolving) => {
    vi.mocked(api.approvals.get).mockResolvedValue({ data: {
      ...mockApprovals[0], description: 'Private workspace detail', task: null,
      completed_at: null, cancelled_by: null, cancel_reason: null, updated_at: '2026-09-06T10:00:00.000Z',
      step: { id: 'step-1', step_order: 1, approver: mockApprovals[0].approver, decided_by: null, status: 'PENDING', decision: null, reason: null, decided_at: null },
    } });
    mockSearchParams = new URLSearchParams('selected_approval_request_id=appr-1');
    const committed: string[] = [];
    function Route() {
      React.useLayoutEffect(() => { if (mockWorkspaceId === 'workspace-2') committed.push(document.body.textContent || ''); });
      return <ApprovalsPage />;
    }
    const view = render(<Route />);
    await screen.findByText('Private workspace detail');
    await screen.findByText('Deployment Signoff');
    vi.mocked(api.approvals.list).mockImplementation(() => new Promise(() => {}));
    vi.mocked(api.approvals.get).mockImplementation(() => new Promise(() => {}));
    mockWorkspaceId = 'workspace-2';
    authState.workspaceResolving = resolving;
    if (!resolving) authState.workspaceId = mockWorkspaceId;
    view.rerender(<Route />);
    expect(committed.length).toBeGreaterThan(0);
    expect(committed.every((text) => !/Private workspace detail|Deployment Signoff|Budget Request Q4/.test(text))).toBe(true);
    expect(screen.queryByText('Private workspace detail')).not.toBeInTheDocument();
    expect(screen.queryByText('Deployment Signoff')).not.toBeInTheDocument();
  });

  it('does not navigate back after a create request completes in an unmounted workspace', async () => {
    let complete!: (value: Awaited<ReturnType<typeof api.approvals.create>>) => void;
    vi.spyOn(api.approvals, 'create').mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    vi.mocked(api.workspaces.members).mockResolvedValue({ data: [{ user_id: 'approver-a', full_name: 'Approver A', email: 'a@example.com', role: 'MEMBER', status: 'ACTIVE' }] });
    mockSearchParams = new URLSearchParams('selected_approval_request_id=new');
    const view = render(<ApprovalsPage />);
    fireEvent.change(await screen.findByLabelText(/Judul/), { target: { value: 'Private draft' } });
    await screen.findByRole('option', { name: /Approver A/ });
    fireEvent.change(screen.getByLabelText(/Pemberi Persetujuan/), { target: { value: 'approver-a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Request' }));
    await waitFor(() => expect(api.approvals.create).toHaveBeenCalledTimes(1));
    mockWorkspaceId = authState.workspaceId = 'workspace-2';
    mockSearchParams = new URLSearchParams();
    view.rerender(<ApprovalsPage />);
    await waitFor(() => expect(api.approvals.list).toHaveBeenCalledWith('workspace-2', expect.anything()));
    const calls = vi.mocked(api.approvals.list).mock.calls.length;
    await act(async () => complete({ data: { id: 'created-a' } } as Awaited<ReturnType<typeof api.approvals.create>>));
    expect(mockPush).not.toHaveBeenCalled();
    expect(api.approvals.list).toHaveBeenCalledTimes(calls);
  });

  it('renders Inbox and Sent tabs for standard MEMBER; hides Managed and All tabs', async () => {
    authState.role = 'MEMBER';
    render(<ApprovalsPage />);
    await waitFor(() => expect(screen.getByText('Budget Request Q4')).toBeInTheDocument());

    expect(screen.getByRole('tab', { name: /^Kotak Masuk$/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Dikirim$/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^Dikelola$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^Semua$/i })).not.toBeInTheDocument();
  });

  it('renders Managed tab for MANAGER; hides All tab', async () => {
    authState.role = 'MANAGER';
    render(<ApprovalsPage />);
    await waitFor(() => expect(screen.getByText('Budget Request Q4')).toBeInTheDocument());

    expect(screen.getByRole('tab', { name: /^Kotak Masuk$/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Dikirim$/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Dikelola$/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^Semua$/i })).not.toBeInTheDocument();
  });

  it('renders All tab for ADMIN; hides Managed tab', async () => {
    authState.role = 'ADMIN';
    render(<ApprovalsPage />);
    await waitFor(() => expect(screen.getByText('Budget Request Q4')).toBeInTheDocument());

    expect(screen.getByRole('tab', { name: /^Kotak Masuk$/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Dikirim$/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^Dikelola$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Semua$/i })).toBeInTheDocument();
  });

  it('normalizes unauthorized view parameter to inbox in URL', async () => {
    authState.role = 'ADMIN';
    mockSearchParams = new URLSearchParams('view=managed');
    render(<ApprovalsPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('view=inbox'));
    });
  });

  it('waits for resolved role before normalizing a manager deep link', async () => {
    authState.workspaceResolving = true;
    mockSearchParams = new URLSearchParams('view=managed&status=PENDING');
    const view = render(<ApprovalsPage />);
    expect(mockPush).not.toHaveBeenCalled();
    authState.workspaceResolving = false;
    authState.role = 'MANAGER';
    view.rerender(<ApprovalsPage />);
    await waitFor(() => expect(api.approvals.list).toHaveBeenCalledWith('workspace-1', expect.objectContaining({ view: 'managed', status: 'PENDING' })));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('passes team_id from a managed deep link and refetches when the team changes', async () => {
    authState.role = 'MANAGER';
    mockSearchParams = new URLSearchParams('view=managed&team_id=team-one&cursor=page-two');
    const view = render(<ApprovalsPage />);
    await waitFor(() => expect(api.approvals.list).toHaveBeenCalledWith('workspace-1', expect.objectContaining({ team_id: 'team-one', cursor: 'page-two' })));
    mockSearchParams = new URLSearchParams('view=managed&team_id=team-two');
    view.rerender(<ApprovalsPage />);
    await waitFor(() => expect(api.approvals.list).toHaveBeenCalledWith('workspace-1', expect.objectContaining({ team_id: 'team-two', cursor: undefined })));
    fireEvent.click(screen.getByRole('tab', { name: 'Dikirim' }));
    expect(mockPush).toHaveBeenLastCalledWith(expect.stringContaining('team_id=team-two'));
  });

  it.each(['inbox', 'sent'])('does not send a team filter for the personal %s view', async (view) => {
    mockSearchParams = new URLSearchParams(`view=${view}&team_id=team-one`);
    render(<ApprovalsPage />);
    await waitFor(() => expect(api.approvals.list).toHaveBeenCalledWith('workspace-1', expect.objectContaining({ view, team_id: undefined })));
  });

  it('ignores an older list result after filters change', async () => {
    let resolveOld!: (value: Awaited<ReturnType<typeof api.approvals.list>>) => void;
    vi.spyOn(api.approvals, 'list').mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const view = render(<ApprovalsPage />);
    await waitFor(() => expect(api.approvals.list).toHaveBeenCalledTimes(1));
    mockSearchParams = new URLSearchParams('status=APPROVED');
    view.rerender(<ApprovalsPage />);
    await screen.findByText('Budget Request Q4');
    await act(async () => resolveOld({ data: [], meta: { pagination: { limit: 50, next_cursor: null, has_more: false } } }));
    expect(screen.getByText('Budget Request Q4')).toBeInTheDocument();
  });

  it('ignores an older list error after a newer filter result', async () => {
    let rejectOld!: (reason: Error) => void;
    vi.spyOn(api.approvals, 'list').mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
    const view = render(<ApprovalsPage />);
    await waitFor(() => expect(api.approvals.list).toHaveBeenCalledTimes(1));
    mockSearchParams = new URLSearchParams('status=PENDING');
    view.rerender(<ApprovalsPage />);
    await screen.findByText('Budget Request Q4');
    await act(async () => rejectOld(new Error('stale failure')));
    expect(screen.queryByText('stale failure')).not.toBeInTheDocument();
    expect(screen.getByText('Budget Request Q4')).toBeInTheDocument();
  });

  it('ignores members from an older workspace after a newer workspace resolves', async () => {
    let resolveOld!: (value: Awaited<ReturnType<typeof api.workspaces.members>>) => void;
    const member = { user_id: 'user-b', full_name: 'Workspace B Member', email: 'b@example.com', role: 'MEMBER', status: 'ACTIVE' };
    vi.spyOn(api.workspaces, 'members')
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ data: [member] });
    mockSearchParams = new URLSearchParams('selected_approval_request_id=new');
    const view = render(<ApprovalsPage />);
    await waitFor(() => expect(api.workspaces.members).toHaveBeenCalledWith('workspace-1'));
    mockWorkspaceId = authState.workspaceId = 'workspace-2';
    view.rerender(<ApprovalsPage />);
    await screen.findByRole('option', { name: /Workspace B Member/ });
    await act(async () => resolveOld({ data: [{ ...member, user_id: 'user-a', full_name: 'Workspace A Member' }] }));
    expect(screen.queryByRole('option', { name: /Workspace A Member/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Workspace B Member/ })).toBeInTheDocument();
  });

  it('clears old members and selected approver while the new workspace is resolving', async () => {
    const member = { user_id: 'user-a', full_name: 'Workspace A Member', email: 'a@example.com', role: 'MEMBER', status: 'ACTIVE' };
    vi.spyOn(api.workspaces, 'members').mockResolvedValueOnce({ data: [member] });
    mockSearchParams = new URLSearchParams('selected_approval_request_id=new');
    const view = render(<ApprovalsPage />);
    await screen.findByRole('option', { name: /Workspace A Member/ });
    const approver = screen.getByLabelText(/Pemberi Persetujuan/);
    fireEvent.change(approver, { target: { value: 'user-a' } });
    expect(approver).toHaveValue('user-a');
    mockWorkspaceId = 'workspace-2';
    authState.workspaceResolving = true;
    view.rerender(<ApprovalsPage />);
    expect(screen.queryByRole('option', { name: /Workspace A Member/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.workspaces.members).toHaveBeenCalledTimes(1);
  });

  it('does not steal input focus on unrelated URL changes while create dialog remains open', async () => {
    mockSearchParams = new URLSearchParams('selected_approval_request_id=new');
    const view = render(<ApprovalsPage />);
    const title = await screen.findByLabelText(/Judul/i);
    await waitFor(() => expect(api.workspaces.members).toHaveBeenCalled());
    title.focus();
    mockSearchParams = new URLSearchParams('selected_approval_request_id=new&status=PENDING');
    view.rerender(<ApprovalsPage />);
    expect(document.activeElement).toBe(title);
    await waitFor(() => expect(api.approvals.list).toHaveBeenCalledTimes(2));
  });

  it('contains focus in create dialog, closes on Escape, restores its trigger', async () => {
    const view = render(<ApprovalsPage />);
    const trigger = screen.getByRole('button', { name: 'New Approval Request' });
    trigger.focus();
    fireEvent.click(trigger);
    mockSearchParams = new URLSearchParams('selected_approval_request_id=new');
    view.rerender(<ApprovalsPage />);
    const dialog = await screen.findByRole('dialog');
    const first = screen.getByRole('button', { name: 'Close dialog' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    const last = screen.getByRole('button', { name: 'Submit Request' });
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(mockPush).toHaveBeenLastCalledWith('/workspaces/workspace-1/approvals?');
    mockSearchParams = new URLSearchParams();
    view.rerender(<ApprovalsPage />);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
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
    await waitFor(() => expect(screen.getByText('Budget Request Q4')).toBeInTheDocument());

    // Click Sent tab
    const sentTab = screen.getByRole('tab', { name: /Sent|Dikirim/i });
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
    const badges = screen.getAllByText(/Menunggu|PENDING/i);
    expect(badges.length).toBeGreaterThan(0);
  });
});
