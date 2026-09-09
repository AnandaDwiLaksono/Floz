import React, { useState } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import WorkflowTransitionMatrix from '../components/workflow-transition-matrix';
import { api, ApiError, WorkflowDetail } from '../lib/api-client';

vi.mock('../lib/api-client', () => ({
  api: {
    workspaces: {
      replaceWorkflowTransitions: vi.fn(),
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
  name: 'Default',
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
  transitions: [
    { from_status_id: 's-1', to_status_id: 's-2', requires_permission: false },
    { from_status_id: 's-2', to_status_id: 's-3', requires_permission: false },
    { from_status_id: 's-1', to_status_id: 's-4', requires_permission: false },
  ],
};

const mockOnUpdate = vi.fn();
const mockOnError = vi.fn().mockResolvedValue('ERROR');
const mockShowToast = vi.fn();

const renderMatrix = (overrides = {}, width = 1024) => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
  window.dispatchEvent(new Event('resize'));
  return render(
    <WorkflowTransitionMatrix
      workspaceId="ws-1"
      workflow={{ ...baseWorkflow, ...overrides }}
      onWorkflowUpdate={mockOnUpdate}
      onError={mockOnError}
      showToast={mockShowToast}
    />
  );
};

describe('Workflow Transition Matrix — Task 11', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('uses mobile at 767 and desktop at 768', () => {
    renderMatrix({}, 767); expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Backlog' }));
    expect(screen.getByRole('checkbox', { name: /Backlog to In Progress/ })).toBeChecked();
    window.innerWidth = 768; fireEvent(window, new Event('resize'));
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Backlog' })).not.toBeInTheDocument();
  });

  it('mobile saves updated parent aggregate and preserves checked disabled dormant edges', async () => {
    window.innerWidth = 767;
    const fresh = { ...baseWorkflow, version: 2, transitions: [...baseWorkflow.transitions, { from_status_id: 's-1', to_status_id: 's-3', requires_permission: false }] };
    vi.mocked(api.workspaces.replaceWorkflowTransitions).mockResolvedValue({ data: fresh });
    function Parent() { const [workflow, setWorkflow] = useState<WorkflowDetail>(baseWorkflow); return <><output>{workflow.version}</output><WorkflowTransitionMatrix workspaceId="ws-1" workflow={workflow} onWorkflowUpdate={setWorkflow} onError={mockOnError} showToast={mockShowToast} /></>; }
    render(<Parent />); fireEvent.click(screen.getByRole('button', { name: 'Backlog' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Backlog to Done/ })); fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('2'));
    expect(screen.getByRole('checkbox', { name: /Backlog to Done/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Backlog to Old Status/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Backlog to Old Status/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(api.workspaces.replaceWorkflowTransitions).toHaveBeenCalledWith('ws-1', 'wf-1', { version: 1, transitions: [{ from_status_id: 's-1', to_status_id: 's-2' }, { from_status_id: 's-2', to_status_id: 's-3' }, { from_status_id: 's-1', to_status_id: 's-3' }] });
  });

  it('reload replaces conflicting edges with canonical aggregate', async () => {
    window.innerWidth = 768;
    vi.mocked(api.workspaces.replaceWorkflowTransitions).mockRejectedValue(new ApiError(409, 'VERSION_CONFLICT', 'raw'));
    vi.mocked(api.workspaces.workflowDetail).mockResolvedValue({ data: { ...baseWorkflow, version: 9, transitions: [baseWorkflow.transitions[2]] } });
    function Parent() { const [workflow, setWorkflow] = useState<WorkflowDetail>(baseWorkflow); return <><output>{workflow.version}</output><WorkflowTransitionMatrix workspaceId="ws-1" workflow={workflow} onWorkflowUpdate={setWorkflow} onError={mockOnError} showToast={mockShowToast} /></>; }
    render(<Parent />); fireEvent.click(screen.getByRole('checkbox', { name: /Backlog to Done/ })); fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reload Configuration' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('9'));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Backlog to Done/ })).not.toBeChecked());
    expect(screen.getByRole('checkbox', { name: /Backlog to Old Status/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Backlog to Old Status/ })).toBeDisabled();
  });

  it.each([['SELF_LOOP_NOT_ALLOWED', 'A status cannot transition to itself.'], ['INACTIVE_TRANSITION_TARGET', 'An archived status cannot be a new transition target. Reload the configuration.']])('explains %s', async (code, message) => {
    vi.mocked(api.workspaces.replaceWorkflowTransitions).mockRejectedValue(new ApiError(409, code, 'raw'));
    renderMatrix(); fireEvent.click(screen.getByRole('checkbox', { name: /Backlog to Done/ })); fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('checkbox', { name: /Backlog to Done/ })).toBeChecked();
  });

  it('saving locks edits until server aggregate arrives', async () => {
    let resolve!: (value: { data: WorkflowDetail }) => void;
    vi.mocked(api.workspaces.replaceWorkflowTransitions).mockReturnValue(new Promise(done => { resolve = done; }));
    renderMatrix(); fireEvent.click(screen.getByRole('checkbox', { name: /Backlog to Done/ })); fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('checkbox', { name: /Old Status to Backlog/ })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await act(async () => resolve({ data: baseWorkflow }));
    expect(screen.getByRole('checkbox', { name: /Old Status to Backlog/ })).toBeEnabled();
  });

  it('shared pending locks transition controls', () => {
    window.innerWidth = 768;
    render(<WorkflowTransitionMatrix workspaceId="ws-1" workflow={baseWorkflow} onWorkflowUpdate={mockOnUpdate} onError={mockOnError} showToast={mockShowToast} pending />);
    expect(screen.getByRole('checkbox', { name: /Backlog to Done/ })).toBeDisabled();
  });

  it('renders desktop matrix with correct headers', () => {
    renderMatrix();
    expect(screen.getByText('Transitions')).toBeInTheDocument();
    expect(screen.getAllByText('Backlog')).toHaveLength(2);
    expect(screen.getAllByText('In Progress')).toHaveLength(2);
    expect(screen.getAllByText('Done')).toHaveLength(2);
    expect(screen.getAllByText('Old Status')).toHaveLength(2);
  });

  it('self-loop diagonal cells show disabled dash', () => {
    renderMatrix();
    const dashes = screen.getAllByText('Self-loop not allowed');
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });

  it('active source -> active target checkboxes are configurable', () => {
    renderMatrix();
    const checkbox = screen.getByRole('checkbox', { name: /Transition from Backlog to In Progress/i });
    expect(checkbox).toBeChecked();
    expect(checkbox).not.toBeDisabled();
  });

  it('archived target checkboxes are disabled (dormant)', () => {
    renderMatrix();
    const dormantCheckbox = screen.getByRole('checkbox', { name: /Transition from Backlog to Old Status/i });
    expect(dormantCheckbox).toBeDisabled();
  });

  it('archived source -> active target is configurable (escape edge)', () => {
    renderMatrix();
    const escapeCheckbox = screen.getByRole('checkbox', { name: /Transition from Old Status to Backlog/i });
    expect(escapeCheckbox).not.toBeDisabled();
  });

  it('toggling an edge shows Save button', () => {
    renderMatrix();
    expect(screen.queryByRole('button', { name: /^Save$/i })).not.toBeInTheDocument();
    const checkbox = screen.getByRole('checkbox', { name: /Transition from Backlog to Done/i });
    fireEvent.click(checkbox);
    expect(screen.getByRole('button', { name: /^Save$/i })).toBeInTheDocument();
  });

  it('serializer only sends mutable active-target edges', async () => {
    (api.workspaces.replaceWorkflowTransitions as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: baseWorkflow });
    renderMatrix();
    const checkbox = screen.getByRole('checkbox', { name: /Transition from Backlog to Done/i });
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => {
      const call = (api.workspaces.replaceWorkflowTransitions as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe('ws-1');
      expect(call[1]).toBe('wf-1');
      const transitions = call[2].transitions;
      const archivedTargetEdges = transitions.filter((t: { to_status_id: string }) => t.to_status_id === 's-4');
      expect(archivedTargetEdges.length).toBe(0);
    });
  });

  it('dormant archived-target edges remain visible after save', async () => {
    (api.workspaces.replaceWorkflowTransitions as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: baseWorkflow });
    renderMatrix();
    const dormantCheckbox = screen.getByRole('checkbox', { name: /Transition from Backlog to Old Status/i });
    expect(dormantCheckbox).toBeChecked();

    const toggle = screen.getByRole('checkbox', { name: /Transition from Backlog to Done/i });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => {
      expect(api.workspaces.replaceWorkflowTransitions).toHaveBeenCalled();
    });
    expect(screen.getByRole('checkbox', { name: /Transition from Backlog to Old Status/i })).toBeInTheDocument();
  });

  it('handles VERSION_CONFLICT error', async () => {
    mockOnError.mockResolvedValue('VERSION_CONFLICT');
    (api.workspaces.replaceWorkflowTransitions as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(409, 'VERSION_CONFLICT', 'VERSION_CONFLICT'));
    renderMatrix();
    const checkbox = screen.getByRole('checkbox', { name: /Transition from Backlog to Done/i });
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));
    await waitFor(() => { expect(mockOnError).toHaveBeenCalled(); });
  });

  it('accessibility: checkboxes have meaningful aria-labels', () => {
    renderMatrix();
    const labels = screen.getAllByRole('checkbox').map((el) => el.getAttribute('aria-label')).filter(Boolean);
    expect(labels.some((l) => l?.includes('Transition from'))).toBe(true);
    expect(labels.some((l) => l?.includes('Backlog'))).toBe(true);
  });

  it('renders mobile accordion at narrow viewport', () => {
    renderMatrix({}, 600);
    const backlogBtn = screen.getByRole('button', { name: /Backlog/i });
    expect(backlogBtn).toBeInTheDocument();
    expect(backlogBtn.getAttribute('aria-expanded')).toBe('false');
  });

  it('mobile accordion expands and shows target toggles', () => {
    renderMatrix({}, 600);
    const backlogBtn = screen.getByRole('button', { name: /Backlog/i });
    fireEvent.click(backlogBtn);
    expect(backlogBtn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('checkbox', { name: /Transition from Backlog to In Progress/i })).toBeInTheDocument();
  });

  it('mobile accordion: archived target toggles are disabled', () => {
    renderMatrix({}, 600);
    fireEvent.click(screen.getByRole('button', { name: /Backlog/i }));
    const dormant = screen.getByRole('checkbox', { name: /Transition from Backlog to Old Status/i });
    expect(dormant).toBeDisabled();
  });
});
