import React, { useState } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import WorkflowStatusList from '../components/workflow-status-list';
import { api, ApiError, WorkflowDetail } from '../lib/api-client';

vi.mock('../lib/api-client', () => ({
  api: {
    workspaces: {
      addWorkflowStatus: vi.fn(),
      updateWorkflowStatus: vi.fn(),
      setInitialStatus: vi.fn(),
      archiveWorkflowStatus: vi.fn(),
      restoreWorkflowStatus: vi.fn(),
      reorderWorkflowStatuses: vi.fn(),
      workflowDetail: vi.fn(),
    },
  },
  ApiError: class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) { super(message); }
  },
}));

const baseWorkflow = {
  id: 'wf-1',
  workspace_id: 'ws-1',
  team_id: null,
  code: 'DEFAULT',
  name: 'Default Workflow',
  description: null,
  is_default: true,
  is_active: true,
  version: 1,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
  statuses: [
    { id: 's-1', code: 'BACKLOG', name: 'Backlog', category: 'TODO' as const, position: 1, is_initial: true, is_terminal: false, is_active: true },
    { id: 's-2', code: 'IN_PROGRESS', name: 'In Progress', category: 'IN_PROGRESS' as const, position: 2, is_initial: false, is_terminal: false, is_active: true },
    { id: 's-3', code: 'DONE', name: 'Done', category: 'DONE' as const, position: 3, is_initial: false, is_terminal: true, is_active: true },
    { id: 's-4', code: 'OLD', name: 'Old Status', category: 'TODO' as const, position: 9999, is_initial: false, is_terminal: false, is_active: false },
  ],
  transitions: [],
};

const mockOnUpdate = vi.fn();
const mockOnError = vi.fn().mockResolvedValue('ERROR');
const mockShowToast = vi.fn();

const renderList = (overrides = {}) => render(
  <WorkflowStatusList
    workspaceId="ws-1"
    workflow={{ ...baseWorkflow, ...overrides }}
    onWorkflowUpdate={mockOnUpdate}
    onError={mockOnError}
    showToast={mockShowToast}
  />
);

describe('Workflow Status List — Task 10', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('keyboard reorder updates parent positions and retains focus at boundary', async () => {
    vi.mocked(api.workspaces.reorderWorkflowStatuses).mockResolvedValue({ data: { ...baseWorkflow, version: 2, statuses: baseWorkflow.statuses.map(s => ({ ...s, position: s.id === 's-2' ? 1 : s.id === 's-1' ? 2 : s.position })) } });
    function Parent() { const [workflow, setWorkflow] = useState<WorkflowDetail>(baseWorkflow); return <WorkflowStatusList workspaceId="ws-1" workflow={workflow} onWorkflowUpdate={setWorkflow} onError={mockOnError} showToast={mockShowToast} />; }
    render(<Parent />);
    const handle = screen.getByRole('button', { name: 'Reorder In Progress' });
    handle.focus(); fireEvent.keyDown(handle, { key: 'ArrowUp' });
    await waitFor(() => expect(screen.getByRole('group', { name: 'In Progress' })).toHaveTextContent('Position 1'));
    await waitFor(() => expect(handle).toHaveFocus());
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(handle).toHaveFocus();
    expect(screen.getByText('In Progress is already at position 1 of 3.')).toBeInTheDocument();
  });

  it('shows positions and locks archived workflow mutations', () => {
    renderList({ is_active: false });
    expect(screen.getByText('Position 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Status' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled();
  });

  it('archive and restore rerender the canonical lifecycle state', async () => {
    const archived: WorkflowDetail = { ...baseWorkflow, version: 2, statuses: baseWorkflow.statuses.map(s => s.id === 's-2' ? { ...s, is_active: false } : s) };
    vi.mocked(api.workspaces.archiveWorkflowStatus).mockResolvedValue({ data: archived });
    vi.mocked(api.workspaces.restoreWorkflowStatus).mockResolvedValue({ data: { ...baseWorkflow, version: 3 } });
    function Parent() { const [workflow, setWorkflow] = useState<WorkflowDetail>(baseWorkflow); return <WorkflowStatusList workspaceId="ws-1" workflow={workflow} onWorkflowUpdate={setWorkflow} onError={mockOnError} showToast={mockShowToast} />; }
    render(<Parent />); fireEvent.click(within(screen.getByRole('group', { name: 'In Progress' })).getByRole('button', { name: 'Archive' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('group', { name: 'In Progress' })).toHaveTextContent('Archived');
    fireEvent.click(within(screen.getByRole('group', { name: 'In Progress' })).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(screen.getByRole('group', { name: 'In Progress' })).not.toHaveTextContent('Archived'));
    expect(within(screen.getByRole('group', { name: 'In Progress' })).getByRole('button', { name: 'Edit' })).toBeEnabled();
  });

  it('initial mutation rerenders badges and archive eligibility', async () => {
    vi.mocked(api.workspaces.setInitialStatus).mockResolvedValue({ data: { ...baseWorkflow, version: 2, statuses: baseWorkflow.statuses.map(s => ({ ...s, is_initial: s.id === 's-2' })) } });
    function Parent() { const [workflow, setWorkflow] = useState<WorkflowDetail>(baseWorkflow); return <WorkflowStatusList workspaceId="ws-1" workflow={workflow} onWorkflowUpdate={setWorkflow} onError={mockOnError} showToast={mockShowToast} />; }
    render(<Parent />); fireEvent.click(screen.getByRole('button', { name: 'Set Initial' }));
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'In Progress' })).getByRole('button', { name: 'Archive' })).toBeDisabled());
    expect(within(screen.getByRole('group', { name: 'Backlog' })).getByRole('button', { name: 'Archive' })).toBeEnabled();
    expect(within(screen.getByRole('group', { name: 'In Progress' })).getByText('Initial')).toBeInTheDocument();
  });

  it('pending create locks inputs until the updated aggregate arrives', async () => {
    let resolve!: (value: { data: WorkflowDetail }) => void;
    vi.mocked(api.workspaces.addWorkflowStatus).mockReturnValue(new Promise(done => { resolve = done; }));
    function Parent() { const [workflow, setWorkflow] = useState<WorkflowDetail>(baseWorkflow); const [pending, setPending] = useState(false); return <WorkflowStatusList workspaceId="ws-1" workflow={workflow} onWorkflowUpdate={setWorkflow} onError={mockOnError} showToast={mockShowToast} pending={pending} onPendingChange={setPending} />; }
    render(<Parent />); fireEvent.click(screen.getByRole('button', { name: 'Add Status' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Review' } }); fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'REVIEW' } }); fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByLabelText('Name')).toBeDisabled(); expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled();
    await act(async () => resolve({ data: { ...baseWorkflow, version: 2, statuses: [...baseWorkflow.statuses, { ...baseWorkflow.statuses[1], id: 's-5', name: 'Review', code: 'REVIEW', position: 4 }] } }));
    expect(screen.getByRole('group', { name: 'Review' })).toBeInTheDocument(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Restore' })).toBeEnabled();
  });

  it('creation renders returned status and immutable code survives edit', async () => {
    const created: WorkflowDetail = { ...baseWorkflow, version: 2, statuses: [...baseWorkflow.statuses, { ...baseWorkflow.statuses[1], id: 's-5', name: 'Review', code: 'REVIEW', position: 4 }] };
    vi.mocked(api.workspaces.addWorkflowStatus).mockResolvedValue({ data: created });
    vi.mocked(api.workspaces.updateWorkflowStatus).mockResolvedValue({ data: { ...created, version: 3, statuses: created.statuses.map(s => s.id === 's-5' ? { ...s, name: 'Review Ready' } : s) } });
    function Parent() { const [workflow, setWorkflow] = useState<WorkflowDetail>(baseWorkflow); return <WorkflowStatusList workspaceId="ws-1" workflow={workflow} onWorkflowUpdate={setWorkflow} onError={mockOnError} showToast={mockShowToast} />; }
    render(<Parent />); fireEvent.click(screen.getByRole('button', { name: 'Add Status' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Review' } }); fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'review' } }); fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('group', { name: 'Review' })).toHaveTextContent('Position 4');
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[3]);
    expect(screen.getByLabelText('Code')).toBeDisabled(); expect(screen.getByLabelText('Code')).toHaveValue('REVIEW');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Review Ready' } }); fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('group', { name: 'Review Ready' })).toHaveTextContent('REVIEW');
  });

  it('shared pending locks all status mutations', () => {
    render(<WorkflowStatusList workspaceId="ws-1" workflow={baseWorkflow} onWorkflowUpdate={mockOnUpdate} onError={mockOnError} showToast={mockShowToast} pending />);
    expect(screen.getByRole('button', { name: 'Add Status' })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Edit' })[0]).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reorder In Progress' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('dialog traps focus, closes on Escape, and returns focus', () => {
    renderList();
    const trigger = screen.getByRole('button', { name: 'Add Status' });
    trigger.focus(); fireEvent.click(trigger);
    expect(screen.getByLabelText('Name')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Create' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('validates name and code before create', () => {
    renderList(); fireEvent.click(screen.getByRole('button', { name: 'Add Status' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Review' } });
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'bad-code' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Code must be 2–32 uppercase letters, numbers, or underscores.');
    expect(api.workspaces.addWorkflowStatus).not.toHaveBeenCalled();
  });

  it('version conflict reload inside edit replaces the rendered aggregate', async () => {
    mockOnError.mockResolvedValue('VERSION_CONFLICT');
    vi.mocked(api.workspaces.updateWorkflowStatus).mockRejectedValue(new ApiError(409, 'VERSION_CONFLICT', 'conflict'));
    vi.mocked(api.workspaces.workflowDetail).mockResolvedValue({ data: { ...baseWorkflow, version: 9, statuses: baseWorkflow.statuses.map(s => s.id === 's-1' ? { ...s, name: 'Fresh Backlog' } : s) } });
    function Parent() { const [workflow, setWorkflow] = useState<WorkflowDetail>(baseWorkflow); return <WorkflowStatusList workspaceId="ws-1" workflow={workflow} onWorkflowUpdate={setWorkflow} onError={mockOnError} showToast={mockShowToast} />; }
    render(<Parent />); fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]); fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('button', { name: 'Reload Configuration' });
    fireEvent.click(screen.getByRole('button', { name: 'Reload Configuration' }));
    expect(await screen.findByText('Fresh Backlog')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows recurrence errors inside archive and reorder errors outside dialogs', async () => {
    mockOnError.mockResolvedValue('ERROR');
    vi.mocked(api.workspaces.archiveWorkflowStatus).mockRejectedValueOnce(new ApiError(409, 'RECURRENCE_DEPENDENCY_CONFLICT', 'raw'));
    renderList(); fireEvent.click(screen.getAllByRole('button', { name: 'Archive' }).find(button => !button.hasAttribute('disabled'))!); fireEvent.click(screen.getAllByRole('button', { name: 'Archive' }).at(-1)!);
    expect(await screen.findByText('This status is used by a recurring task. Update that recurrence first.')).toBeInTheDocument();
    vi.mocked(api.workspaces.reorderWorkflowStatuses).mockRejectedValueOnce(new ApiError(409, 'CANNOT_ARCHIVE_INITIAL_STATUS', 'raw'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getAllByRole('button', { name: /Move .* down/i })[0]);
    expect(await screen.findByText('Choose another initial status before archiving this one.')).toBeInTheDocument();
  });

  it('renders active statuses in order with badges', () => {
    renderList();
    const items = screen.getAllByText(/Backlog|In Progress|Done/);
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('Initial')).toBeInTheDocument();
    expect(screen.getByText('Terminal')).toBeInTheDocument();
  });

  it('renders archived statuses with Archived badge', () => {
    renderList();
    expect(screen.getByText('Old Status')).toBeInTheDocument();
    expect(screen.getAllByText('Archived').length).toBeGreaterThanOrEqual(1);
  });

  it('creates a new status', async () => {
    (api.workspaces.addWorkflowStatus as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: baseWorkflow });
    renderList();
    fireEvent.click(screen.getByRole('button', { name: /Add Status/i }));
    expect(screen.getByRole('dialog', { name: /Add Status/i })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Name$/i), { target: { value: 'Review' } });
    fireEvent.change(screen.getByLabelText(/^Code$/i), { target: { value: 'REVIEW' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));

    await waitFor(() => {
      expect(api.workspaces.addWorkflowStatus).toHaveBeenCalledWith('ws-1', 'wf-1', expect.objectContaining({ name: 'Review', code: 'REVIEW', category: 'TODO', version: 1 }));
    });
  });

  it('edits status name', async () => {
    (api.workspaces.updateWorkflowStatus as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: baseWorkflow });
    renderList();
    const editBtns = screen.getAllByRole('button', { name: /^Edit$/i });
    fireEvent.click(editBtns[0]);
    expect(screen.getByRole('dialog', { name: /Edit Status/i })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Name$/i), { target: { value: 'To Do' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => {
      expect(api.workspaces.updateWorkflowStatus).toHaveBeenCalledWith('ws-1', 'wf-1', 's-1', expect.objectContaining({ name: 'To Do', version: 1 }));
    });
  });

  it('edits status category', async () => {
    (api.workspaces.updateWorkflowStatus as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: baseWorkflow });
    renderList();
    const editBtns = screen.getAllByRole('button', { name: /^Edit$/i });
    fireEvent.click(editBtns[1]);

    fireEvent.change(screen.getByLabelText(/Category/i), { target: { value: 'DONE' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => {
      expect(api.workspaces.updateWorkflowStatus).toHaveBeenCalledWith('ws-1', 'wf-1', 's-2', expect.objectContaining({ category: 'DONE', version: 1 }));
    });
  });

  it('sets initial status only for eligible targets', () => {
    renderList();
    const setInitialBtns = screen.getAllByRole('button', { name: /Set Initial/i });
    expect(setInitialBtns.length).toBe(1);
    expect(setInitialBtns[0]).toBeInTheDocument();
  });

  it('calls setInitialStatus API', async () => {
    (api.workspaces.setInitialStatus as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: baseWorkflow });
    renderList();
    fireEvent.click(screen.getByRole('button', { name: /Set Initial/i }));
    await waitFor(() => {
      expect(api.workspaces.setInitialStatus).toHaveBeenCalledWith('ws-1', 'wf-1', 's-2', { version: 1 });
    });
  });

  it('initial status archive button is disabled', () => {
    renderList();
    const archiveBtns = screen.getAllByRole('button', { name: /Archive/i });
    const disabledArchive = archiveBtns.find((b) => b.hasAttribute('disabled'));
    expect(disabledArchive).toBeDefined();
  });

  it('archives a non-initial status with confirmation', async () => {
    (api.workspaces.archiveWorkflowStatus as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: baseWorkflow });
    renderList();
    const archiveBtns = screen.getAllByRole('button', { name: /^Archive$/i }).filter((b) => !b.hasAttribute('disabled'));
    fireEvent.click(archiveBtns[0]);

    await waitFor(() => expect(screen.getByRole('dialog', { name: /Confirm Archive Status/i })).toBeInTheDocument());
    expect(screen.getByText(/Existing tasks with this status/i)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /^Archive$/i }).pop()!);

    await waitFor(() => {
      expect(api.workspaces.archiveWorkflowStatus).toHaveBeenCalled();
    });
  });

  it('restores an archived status', async () => {
    (api.workspaces.restoreWorkflowStatus as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: baseWorkflow });
    renderList();
    fireEvent.click(screen.getByRole('button', { name: /^Restore$/i }));
    await waitFor(() => {
      expect(api.workspaces.restoreWorkflowStatus).toHaveBeenCalledWith('ws-1', 'wf-1', 's-4', { version: 1 });
    });
  });

  it('keyboard Move Up button disabled at first position', () => {
    renderList();
    const upBtns = screen.getAllByRole('button', { name: /Move .* up/i });
    expect(upBtns[0]).toHaveAttribute('aria-disabled', 'true');
  });

  it('keyboard Move Down button disabled at last position', () => {
    renderList();
    const downBtns = screen.getAllByRole('button', { name: /Move .* down/i });
    expect(downBtns[downBtns.length - 1]).toHaveAttribute('aria-disabled', 'true');
  });

  it('Move Down reorders statuses', async () => {
    (api.workspaces.reorderWorkflowStatuses as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: baseWorkflow });
    renderList();
    const downBtns = screen.getAllByRole('button', { name: /Move .* down/i });
    fireEvent.click(downBtns[0]);

    await waitFor(() => {
      expect(api.workspaces.reorderWorkflowStatuses).toHaveBeenCalledWith('ws-1', 'wf-1', { status_ids: ['s-2', 's-1', 's-3'], version: 1 });
    });
  });

  it('Move Up reorders statuses', async () => {
    (api.workspaces.reorderWorkflowStatuses as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: baseWorkflow });
    renderList();
    const upBtns = screen.getAllByRole('button', { name: /Move .* up/i });
    fireEvent.click(upBtns[1]);

    await waitFor(() => {
      expect(api.workspaces.reorderWorkflowStatuses).toHaveBeenCalledWith('ws-1', 'wf-1', { status_ids: ['s-2', 's-1', 's-3'], version: 1 });
    });
  });

  it('handles STATUS_CATEGORY_IN_USE error', async () => {
    mockOnError.mockResolvedValue('ERROR');
    (api.workspaces.updateWorkflowStatus as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(409, 'STATUS_CATEGORY_IN_USE', 'Status category is in use'));
    renderList();
    const editBtns = screen.getAllByRole('button', { name: /^Edit$/i });
    fireEvent.click(editBtns[1]);
    fireEvent.change(screen.getByLabelText(/Category/i), { target: { value: 'DONE' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));
    expect(await screen.findByText('This category cannot change while tasks use this status.')).toBeInTheDocument();
  });

  it('handles RECURRENCE_DEPENDENCY_CONFLICT error', async () => {
    mockOnError.mockResolvedValue('ERROR');
    (api.workspaces.archiveWorkflowStatus as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(409, 'RECURRENCE_DEPENDENCY_CONFLICT', 'Recurrence dependency'));
    renderList();
    const archiveBtns = screen.getAllByRole('button', { name: /^Archive$/i }).filter((b) => !b.hasAttribute('disabled'));
    fireEvent.click(archiveBtns[0]);
    await waitFor(() => expect(screen.getByRole('dialog', { name: /Confirm Archive Status/i })).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: /^Archive$/i }).pop()!);

    await waitFor(() => { expect(mockOnError).toHaveBeenCalled(); });
  });

  it('handles VERSION_CONFLICT from reorder', async () => {
    mockOnError.mockResolvedValue('VERSION_CONFLICT');
    (api.workspaces.reorderWorkflowStatuses as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(409, 'VERSION_CONFLICT', 'VERSION_CONFLICT'));
    renderList();
    const downBtns = screen.getAllByRole('button', { name: /Move .* down/i });
    fireEvent.click(downBtns[0]);
    await waitFor(() => { expect(mockOnError).toHaveBeenCalled(); });
  });

  it('drag rerenders active order without moving archived statuses', async () => {
    vi.mocked(api.workspaces.reorderWorkflowStatuses).mockResolvedValue({ data: { ...baseWorkflow, version: 2, statuses: baseWorkflow.statuses.map(s => ({ ...s, position: s.id === 's-1' ? 2 : s.id === 's-2' ? 1 : s.position })) } });
    function Parent() { const [workflow, setWorkflow] = useState<WorkflowDetail>(baseWorkflow); return <WorkflowStatusList workspaceId="ws-1" workflow={workflow} onWorkflowUpdate={setWorkflow} onError={mockOnError} showToast={mockShowToast} />; }
    render(<Parent />); fireEvent.dragStart(screen.getByRole('group', { name: 'Backlog' })); fireEvent.drop(screen.getByRole('group', { name: 'In Progress' }));
    await waitFor(() => expect(screen.getAllByRole('group')[0]).toHaveAccessibleName('In Progress'));
    expect(screen.getByRole('group', { name: 'Backlog' })).toHaveTextContent('Position 2');
    expect(screen.getByRole('group', { name: 'Old Status' })).toHaveAttribute('draggable', 'false');
    expect(screen.getByRole('group', { name: 'Old Status' })).toHaveTextContent('Position 9999');
  });

  it('drag reorder calls reorderWorkflowStatuses', async () => {
    (api.workspaces.reorderWorkflowStatuses as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: baseWorkflow });
    renderList();
    const items = screen.getAllByText(/⠿/);
    const firstItem = items[0].closest('[draggable]')!;
    const secondItem = items[1].closest('[draggable]')!;

    fireEvent.dragStart(firstItem, { dataTransfer: { effectAllowed: 'move' } });
    fireEvent.dragOver(secondItem, { dataTransfer: { dropEffect: 'move' } });
    fireEvent.drop(secondItem, { dataTransfer: {} });

    await waitFor(() => {
      expect(api.workspaces.reorderWorkflowStatuses).toHaveBeenCalled();
    });
  });
});
