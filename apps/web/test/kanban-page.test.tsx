import React from 'react';
import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import KanbanPage from '../app/workspaces/[workspaceId]/kanban/page';
import { api, KanbanBoard } from '../lib/api-client';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('../lib/api-client', async (load) => {
  const actual = await load<typeof import('../lib/api-client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      workspaces: {
        ...actual.api.workspaces,
        teams: vi.fn(),
        members: vi.fn(),
        workflows: vi.fn(),
      },
      tasks: {
        ...actual.api.tasks,
        kanban: vi.fn(),
        availableTransitions: vi.fn(),
        transition: vi.fn(),
      },
    },
  };
});

const activeStatus = { id: 'active', code: 'TODO', name: 'To Do', category: 'TODO', is_active: true };
const archivedStatus = { id: 'archived', code: 'OLD', name: 'Archived: Old Review', category: 'IN_PROGRESS', is_active: false };
const card = (id: string, title: string, status: typeof activeStatus) => ({ id, task_key: id.toUpperCase(), title, priority: 'HIGH' as const, due_at: null, assignees: [], status, version: 1, workflow_id: 'workflow-1', team_id: null, creator_id: 'user-1' });
const board: KanbanBoard = {
  workflow: { id: 'workflow-1', name: 'Default', team_id: null, is_default: true, is_active: true, statuses: [activeStatus] },
  columns: [
    { status: activeStatus, task_count: 1, cards: [card('task-1', 'Active task', activeStatus)] },
    { status: archivedStatus, task_count: 1, cards: [card('task-2', 'Archived task', archivedStatus)] },
  ],
};

describe('Kanban archived columns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.tasks.kanban).mockResolvedValue({ data: board });
    vi.mocked(api.workspaces.workflows).mockResolvedValue({ data: [board.workflow] });
    vi.mocked(api.workspaces.teams).mockResolvedValue({ data: [] });
    vi.mocked(api.workspaces.members).mockResolvedValue({ data: [] });
    vi.mocked(api.tasks.availableTransitions).mockResolvedValue({ data: [{ to_status_id: 'active', code: 'TODO', name: 'To Do' }] });
    vi.mocked(api.tasks.transition).mockResolvedValue({} as never);
  });

  it('keeps archived cards visible while marking their column as unavailable for drops', async () => {
    render(<KanbanPage />);
    const archivedColumn = await screen.findByRole('region', { name: 'Archived: Old Review (archived, drop unavailable)' });

    expect(within(archivedColumn).getByText('Archived task')).toBeVisible();
    expect(within(archivedColumn).getByText('Drop unavailable')).toBeVisible();
    expect(archivedColumn).toHaveClass('border-dashed');

    fireEvent.dragStart(screen.getByText('Active task').closest('article')!);
    const dragOver = createEvent.dragOver(archivedColumn);
    fireEvent(archivedColumn, dragOver);
    expect(dragOver.defaultPrevented).toBe(false);
    await act(async () => { fireEvent.drop(archivedColumn); });

    expect(api.tasks.availableTransitions).not.toHaveBeenCalled();
    expect(api.tasks.transition).not.toHaveBeenCalled();
  });

  it('excludes archived targets but lets archived cards move to active targets', async () => {
    render(<KanbanPage />);
    const activeSelect = await screen.findByLabelText('Change status for Active task');
    const archivedSelect = screen.getByLabelText('Change status for Archived task');

    expect(within(activeSelect).queryByRole('option', { name: 'Archived: Old Review' })).not.toBeInTheDocument();
    expect(within(archivedSelect).getByRole('option', { name: 'To Do' })).toBeInTheDocument();

    fireEvent.change(archivedSelect, { target: { value: 'active' } });
    await waitFor(() => expect(api.tasks.transition).toHaveBeenCalledWith('workspace-1', 'task-2', { version: 1, to_status_id: 'active' }));
  });

  it('rejects an archived target even if a stale selector offers it', async () => {
    render(<KanbanPage />);
    const select = await screen.findByLabelText('Change status for Active task');
    const option = document.createElement('option');
    option.value = 'archived';
    select.append(option);
    await act(async () => { fireEvent.change(select, { target: { value: 'archived' } }); });

    expect(api.tasks.availableTransitions).not.toHaveBeenCalled();
    expect(api.tasks.transition).not.toHaveBeenCalled();
    expect(within(screen.getByRole('region', { name: 'To Do' })).getByText('Active task')).toBeVisible();
  });

  it('preserves drops onto active columns', async () => {
    render(<KanbanPage />);
    const activeColumn = await screen.findByRole('region', { name: 'To Do' });
    fireEvent.dragStart(screen.getByText('Archived task').closest('article')!);
    const dragOver = createEvent.dragOver(activeColumn);
    fireEvent(activeColumn, dragOver);
    expect(dragOver.defaultPrevented).toBe(true);
    fireEvent.drop(activeColumn);

    await waitFor(() => expect(api.tasks.transition).toHaveBeenCalledWith('workspace-1', 'task-2', { version: 1, to_status_id: 'active' }));
  });
});
