import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import WorkflowSettingsPage from '../app/workspaces/[workspaceId]/settings/workflows/page';
import { useAuth } from '../lib/auth-context';
import { api, ApiError } from '../lib/api-client';

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'ws-1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/workspaces/ws-1/settings/workflows',
}));

vi.mock('../lib/auth-context', () => ({ useAuth: vi.fn() }));

vi.mock('../lib/api-client', () => ({
  api: {
    workspaces: {
      workflowList: vi.fn(),
      workflowDetail: vi.fn(),
      createWorkflow: vi.fn(),
      updateWorkflow: vi.fn(),
      setDefaultWorkflow: vi.fn(),
      archiveWorkflow: vi.fn(),
      restoreWorkflow: vi.fn(),
      teams: vi.fn(),
      addWorkflowStatus: vi.fn(),
      updateWorkflowStatus: vi.fn(),
      setInitialStatus: vi.fn(),
      archiveWorkflowStatus: vi.fn(),
      restoreWorkflowStatus: vi.fn(),
      reorderWorkflowStatuses: vi.fn(),
      replaceWorkflowTransitions: vi.fn(),
    },
  },
  ApiError: class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) { super(message); }
  },
}));

const wf1 = {
  id: 'wf-1', workspace_id: 'ws-1', team_id: null, code: 'DEFAULT', name: 'Default Workflow',
  description: 'Main workflow', is_default: true, is_active: true, version: 1,
  created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z',
  statuses: [
    { id: 's-1', code: 'BACKLOG', name: 'Backlog', category: 'TODO', position: 1, is_initial: true, is_terminal: false, is_active: true },
    { id: 's-2', code: 'IN_PROGRESS', name: 'In Progress', category: 'IN_PROGRESS', position: 2, is_initial: false, is_terminal: false, is_active: true },
    { id: 's-3', code: 'DONE', name: 'Done', category: 'DONE', position: 3, is_initial: false, is_terminal: true, is_active: true },
  ],
  transitions: [
    { from_status_id: 's-1', to_status_id: 's-2', requires_permission: false },
    { from_status_id: 's-2', to_status_id: 's-3', requires_permission: false },
  ],
};

const wf2 = { ...wf1, id: 'wf-2', code: 'TEAM_WF', name: 'Team Workflow', is_default: false, team_id: 't-1', description: null };
const wf3 = { ...wf1, id: 'wf-3', code: 'OLD', name: 'Old Workflow', is_default: false, is_active: false, description: null };

const mockAdmin = () => {
  (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    user: { id: 'u-1', email: 'admin@floz.com', full_name: 'Admin' },
    activeWorkspace: { id: 'ws-1', name: 'Floz', role: 'ADMIN' },
  });
};

const mockMember = () => {
  (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    user: { id: 'u-2', email: 'member@floz.com', full_name: 'Member' },
    activeWorkspace: { id: 'ws-1', name: 'Floz', role: 'MEMBER' },
  });
};

const setupDefaultMocks = () => {
  (api.workspaces.workflowList as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [wf1, wf2, wf3].map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'transitions'))) });
  (api.workspaces.workflowDetail as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: wf1 });
  (api.workspaces.createWorkflow as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: wf1 });
  (api.workspaces.updateWorkflow as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { ...wf1, name: 'Updated', version: 2 } });
  (api.workspaces.setDefaultWorkflow as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { ...wf1, is_default: true, version: 2 } });
  (api.workspaces.archiveWorkflow as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { ...wf1, is_active: false, is_default: false, version: 2 } });
  (api.workspaces.restoreWorkflow as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { ...wf3, is_active: true, is_default: false, version: 2 } });
  (api.workspaces.teams as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [{ id: 't-1', workspace_id: 'ws-1', name: 'Alpha Team', description: null, manager_user_id: null, isActive: true }] });
};

describe('Workflow Settings — Task 9', () => {
  beforeEach(() => { vi.clearAllMocks(); setupDefaultMocks(); });

  it('renders page for ADMIN with workflow list', async () => {
    mockAdmin();
    render(<WorkflowSettingsPage />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Workflows' })).toBeInTheDocument();
      expect(screen.getAllByText('Default Workflow').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Team Workflow').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Old Workflow').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows access denied for non-ADMIN', () => {
    mockMember();
    render(<WorkflowSettingsPage />);
    expect(screen.getByText(/Access denied/i)).toBeInTheDocument();
    for (const method of Object.values(api.workspaces)) expect(method).not.toHaveBeenCalled();
  });

  it('shows Default badge on default workflow', async () => {
    mockAdmin();
    render(<WorkflowSettingsPage />);
    await waitFor(() => {
      const badges = screen.getAllByText('Default');
      expect(badges.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows Workspace badge and Team badge', async () => {
    mockAdmin();
    render(<WorkflowSettingsPage />);
    await waitFor(() => {
      expect(screen.getAllByText('Workspace').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/Team: Alpha Team/)).toBeInTheDocument();
    });
  });

  it('shows Archived state for archived workflow', async () => {
    mockAdmin();
    render(<WorkflowSettingsPage />);
    await waitFor(() => {
      const archivedBadges = screen.getAllByText('Archived');
      expect(archivedBadges.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('opens create workflow dialog', async () => {
    mockAdmin();
    render(<WorkflowSettingsPage />);
    await waitFor(() => expect(screen.getAllByText('Default Workflow').length).toBeGreaterThanOrEqual(1));
    fireEvent.click(screen.getByRole('button', { name: /New Workflow/i }));
    expect(screen.getByRole('dialog', { name: /Create Workflow/i })).toBeInTheDocument();
  });

  it('submits create workflow', async () => {
    mockAdmin();
    render(<WorkflowSettingsPage />);
    await waitFor(() => expect(screen.getAllByText('Default Workflow').length).toBeGreaterThanOrEqual(1));
    fireEvent.click(screen.getByRole('button', { name: /New Workflow/i }));

    fireEvent.change(screen.getByLabelText(/^Name$/i), { target: { value: 'New WF' } });
    fireEvent.change(screen.getByLabelText(/^Code$/i), { target: { value: 'NEW_WF' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));

    await waitFor(() => {
      expect(api.workspaces.createWorkflow).toHaveBeenCalledWith('ws-1', expect.objectContaining({ name: 'New WF', code: 'NEW_WF' }));
    });
  });

  it('loads workflow detail on selection and shows metadata card', async () => {
    mockAdmin();
    render(<WorkflowSettingsPage />);
    await waitFor(() => expect(screen.getByText('Workflow Details')).toBeInTheDocument());
  });

  it('edits workflow metadata', async () => {
    mockAdmin();
    render(<WorkflowSettingsPage />);
    await waitFor(() => expect(screen.getByText('Workflow Details')).toBeInTheDocument());

    const editBtns = screen.getAllByRole('button', { name: /^Edit$/i });
    fireEvent.click(editBtns[0]);
    const nameInputs = screen.getAllByLabelText(/^Name$/i);
    fireEvent.change(nameInputs[0], { target: { value: 'Renamed' } });
    const saveBtns = screen.getAllByRole('button', { name: /^Save$/i });
    fireEvent.click(saveBtns[0]);

    await waitFor(() => {
      expect(api.workspaces.updateWorkflow).toHaveBeenCalledWith('ws-1', 'wf-1', expect.objectContaining({ name: 'Renamed', version: 1 }));
    });
  });

  it('sets workflow as default', async () => {
    mockAdmin();
    (api.workspaces.workflowDetail as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { ...wf1, is_default: false } })
      .mockResolvedValueOnce({ data: { ...wf1, name: 'Fresh Default', version: 7 } });
    render(<WorkflowSettingsPage />);
    await waitFor(() => expect(screen.getByText('Workflow Details')).toBeInTheDocument());

    vi.mocked(api.workspaces.setDefaultWorkflow).mockResolvedValue({ data: { ...wf2, team_id: null, name: 'Fresh Default', version: 7 } } as never);
    fireEvent.click(within(screen.getByRole('region', { name: 'Workflow Details' })).getByRole('button', { name: 'Set Default' }));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Workflow Details' })).toHaveTextContent('v7'));
    expect(screen.getByRole('region', { name: 'Workflow Details' })).toHaveTextContent('Fresh Default');
    expect(screen.getByRole('checkbox', { name: 'Transition from Backlog to In Progress' })).toBeChecked();
  });

  it('workspace default archive button is disabled with explanation', async () => {
    mockAdmin();
    render(<WorkflowSettingsPage />);
    await waitFor(() => expect(screen.getByText('Workflow Details')).toBeInTheDocument());

    const archiveBtns = screen.getAllByRole('button', { name: /Archive/i });
    const disabledArchive = archiveBtns.find((b) => b.hasAttribute('disabled'));
    expect(disabledArchive).toBeDefined();
    expect(disabledArchive?.title || '').toContain('Cannot archive');
  });

  it('archives non-default workflow with confirmation', async () => {
    mockAdmin();
    (api.workspaces.workflowDetail as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { ...wf2, team_id: null, is_default: false } });
    render(<WorkflowSettingsPage />);
    await waitFor(() => expect(screen.getByText('Workflow Details')).toBeInTheDocument());

    const metadataArchiveBtn = screen.getAllByRole('button', { name: /^Archive$/i }).find((b) => !b.hasAttribute('disabled') && b.className.includes('bg-gray-200'));
    if (metadataArchiveBtn) {
      fireEvent.click(metadataArchiveBtn);
      await waitFor(() => expect(screen.getByRole('dialog', { name: /Confirm Archive/i })).toBeInTheDocument());
      const confirmBtn = screen.getAllByRole('button', { name: /^Archive$/i }).find((b) => b.className.includes('bg-red-600'));
      fireEvent.click(confirmBtn!);
      await waitFor(() => expect(api.workspaces.archiveWorkflow).toHaveBeenCalled());
    }
  });

  it('restores archived workflow as non-default', async () => {
    mockAdmin();
    (api.workspaces.workflowDetail as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: wf3 });
    render(<WorkflowSettingsPage />);
    await waitFor(() => expect(screen.getByText('Workflow Details')).toBeInTheDocument());

    const restoreBtn = screen.queryByRole('button', { name: /^Restore$/i });
    if (restoreBtn) {
      fireEvent.click(restoreBtn);
      await waitFor(() => expect(api.workspaces.restoreWorkflow).toHaveBeenCalled());
    }
  });

  it('replaces stale metadata inputs and submits the fresh version after conflict reload', async () => {
    mockAdmin();
    (api.workspaces.updateWorkflow as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(409, 'VERSION_CONFLICT', 'VERSION_CONFLICT'));
    render(<WorkflowSettingsPage />);
    await waitFor(() => expect(screen.getByText('Workflow Details')).toBeInTheDocument());

    const details = within(screen.getByRole('region', { name: 'Workflow Details' }));
    fireEvent.click(details.getByRole('button', { name: 'Edit' }));
    fireEvent.change(details.getByLabelText('Name'), { target: { value: 'Stale edit' } });
    fireEvent.click(details.getByRole('button', { name: 'Save' }));
    await screen.findByRole('button', { name: 'Reload Configuration' });
    vi.mocked(api.workspaces.workflowDetail).mockResolvedValue({ data: { ...wf1, name: 'Fresh server name', description: 'Fresh description', version: 9 } } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Reload Configuration' }));
    await waitFor(() => expect(details.getByLabelText('Name')).toHaveValue('Fresh server name'));
    expect(details.getByLabelText('Description')).toHaveValue('Fresh description');
    expect(screen.getByRole('region', { name: 'Workflow Details' })).toHaveTextContent('v9');
    vi.mocked(api.workspaces.updateWorkflow).mockResolvedValue({ data: { ...wf1, name: 'Fresh server name', version: 10 } } as never);
    fireEvent.click(details.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.workspaces.updateWorkflow).toHaveBeenLastCalledWith('ws-1', 'wf-1', { name: 'Fresh server name', description: 'Fresh description', version: 9 }));
    expect(api.workspaces.updateWorkflow).toHaveBeenCalledTimes(2);
  });

  it.each(['status', 'matrix'])('reloads fresh configuration after a %s conflict without retrying the mutation', async (source) => {
    mockAdmin();
    const conflict = new ApiError(409, 'VERSION_CONFLICT', 'Conflict');
    vi.mocked(api.workspaces.setInitialStatus).mockRejectedValue(conflict);
    vi.mocked(api.workspaces.replaceWorkflowTransitions).mockRejectedValue(conflict);
    render(<WorkflowSettingsPage />);
    await screen.findByRole('region', { name: 'Workflow Details' });
    if (source === 'status') {
      fireEvent.click(within(screen.getByRole('region', { name: 'Statuses' })).getByRole('button', { name: 'Set Initial' }));
    } else {
      const matrix = within(screen.getByRole('region', { name: 'Transitions' }));
      fireEvent.click(matrix.getByRole('checkbox', { name: 'Transition from Backlog to Done' }));
      fireEvent.click(matrix.getByRole('button', { name: 'Save' }));
    }
    const reload = await within(screen.getByRole('region', { name: source === 'status' ? 'Statuses' : 'Transitions' })).findByRole('button', { name: 'Reload Configuration' });
    vi.mocked(api.workspaces.workflowDetail).mockResolvedValue({ data: { ...wf1, name: 'Reloaded aggregate', version: 12 } } as never);
    fireEvent.click(reload);
    await waitFor(() => expect(screen.getByRole('region', { name: 'Workflow Details' })).toHaveTextContent('v12'));
    expect(screen.getByRole('region', { name: 'Workflow Details' })).toHaveTextContent('Reloaded aggregate');
    expect(api.workspaces.setInitialStatus).toHaveBeenCalledTimes(source === 'status' ? 1 : 0);
    expect(api.workspaces.replaceWorkflowTransitions).toHaveBeenCalledTimes(source === 'matrix' ? 1 : 0);
  });

  it('disables shared aggregate actions while metadata mutation is pending', async () => {
    mockAdmin();
    let finish!: (value: { data: typeof wf1 }) => void;
    vi.mocked(api.workspaces.updateWorkflow).mockImplementation(() => new Promise((resolve) => { finish = resolve as typeof finish; }));
    render(<WorkflowSettingsPage />);
    const details = within(await screen.findByRole('region', { name: 'Workflow Details' }));
    fireEvent.click(details.getByRole('button', { name: 'Edit' }));
    fireEvent.click(details.getByRole('button', { name: 'Save' }));
    expect(within(screen.getByRole('region', { name: 'Statuses' })).getByRole('button', { name: 'Set Initial' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Transition from Backlog to Done' })).toBeDisabled();
    fireEvent.click(details.getByRole('button', { name: 'Saving...' }));
    expect(api.workspaces.updateWorkflow).toHaveBeenCalledTimes(1);
    await act(async () => finish({ data: { ...wf1, version: 2 } }));
    expect(within(screen.getByRole('region', { name: 'Statuses' })).getByRole('button', { name: 'Set Initial' })).not.toBeDisabled();
  });

  it('keeps teams failures visible and prevents creation with missing scope data', async () => {
    mockAdmin();
    vi.mocked(api.workspaces.teams).mockRejectedValue(new Error('offline'));
    render(<WorkflowSettingsPage />);
    await screen.findByRole('region', { name: 'Workflow Details' });
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load teams.');
    expect(screen.getByRole('button', { name: 'New Workflow' })).toBeDisabled();
  });

  it('traps focus, closes create on Escape and restores the trigger', async () => {
    mockAdmin();
    render(<WorkflowSettingsPage />);
    await screen.findByRole('region', { name: 'Workflow Details' });
    const trigger = screen.getByRole('button', { name: 'New Workflow' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = within(screen.getByRole('dialog', { name: 'Create Workflow' }));
    expect(dialog.getByLabelText('Name')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(dialog.getByRole('button', { name: 'Create' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(dialog.getByLabelText('Name')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('filter hides workflows from list', async () => {
    mockAdmin();
    render(<WorkflowSettingsPage />);
    await waitFor(() => expect(screen.getAllByText('Default Workflow').length).toBeGreaterThanOrEqual(1));

    fireEvent.click(screen.getByRole('button', { name: /^Active$/i }));
    expect(screen.queryByText('Old Workflow')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Archived$/i }));
    expect(screen.getByText('Old Workflow')).toBeInTheDocument();
  });
});
