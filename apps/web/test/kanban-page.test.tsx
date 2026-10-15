import React from 'react';
import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import KanbanPage from '../app/workspaces/[workspaceId]/kanban/page';
import { api, ApiError, KanbanBoard } from '../lib/api-client';

const push = vi.fn();
let currentSearch = '';

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

const filterBoard = (cards: KanbanBoard['columns'][number]['cards'] = []) => ({
  ...board,
  columns: board.columns.map((column) => ({ ...column, task_count: cards.length, cards: column.status.id === 'active' ? cards : [] })),
});

// Tests added before implementation to expose the requested Phase 3 behavior.
describe('Kanban Phase 3 presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSearch = '';
    vi.mocked(api.tasks.kanban).mockResolvedValue({ data: filterBoard([card('task-1', 'Active task', activeStatus)]) });
    vi.mocked(api.workspaces.workflows).mockResolvedValue({ data: [board.workflow] });
    vi.mocked(api.workspaces.teams).mockResolvedValue({ data: [] });
    vi.mocked(api.workspaces.members).mockResolvedValue({ data: [] });
    vi.mocked(api.tasks.availableTransitions).mockResolvedValue({ data: [{ to_status_id: 'active', code: 'TODO', name: 'To Do' }] });
  });

  it('shows Indonesian filter labels, filter summary, and reset action', async () => {
    currentSearch = 'priority=HIGH&due_from=2026-09-01';
    render(<KanbanPage />);
    expect(await screen.findByRole('heading', { name: 'Kanban' })).toBeVisible();
    expect(screen.getByLabelText('Prioritas')).toBeVisible();
    expect(screen.getByText(/Filter aktif/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Hapus filter' })).toBeVisible();
  });

  it('binds task card surface to semantic tokens', async () => {
    render(<KanbanPage />);
    const cardSurface = (await screen.findByText('Active task')).closest('article')!;
    expect(cardSurface).toHaveStyle({ backgroundColor: 'var(--surface)', color: 'var(--foreground)' });
  });

  it('opens task detail with the exact Kanban filter URL as return_to', async () => {
    currentSearch = 'priority=HIGH&team_id=team-1';
    render(<KanbanPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Active task/ }));
    expect(push).toHaveBeenCalledWith('/workspaces/workspace-1/tasks?selected_task_id=task-1&return_to=%2Fworkspaces%2Fworkspace-1%2Fkanban%3Fpriority%3DHIGH%26team_id%3Dteam-1');
  });

  it('renders the successful empty board in Indonesian', async () => {
    vi.mocked(api.tasks.kanban).mockResolvedValue({ data: filterBoard() });
    render(<KanbanPage />);
    expect(await screen.findByText('Belum ada tugas')).toBeVisible();
  });

  it('shows loading again while retrying a failed board request', async () => {
    vi.mocked(api.tasks.kanban).mockRejectedValueOnce(new Error('offline'));
    render(<KanbanPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Papan Kanban gagal dimuat');
    let resolve!: (value: { data: KanbanBoard }) => void;
    vi.mocked(api.tasks.kanban).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    fireEvent.click(screen.getByRole('button', { name: 'Muat ulang' }));
    expect(screen.getByRole('status')).toHaveTextContent('Memuat papan Kanban');
    await act(async () => { resolve({ data: board }); });
    expect(await screen.findByRole('region', { name: 'Belum dimulai' })).toBeVisible();
  });

  it('rolls back and refetches a version conflict without retrying the transition', async () => {
    vi.mocked(api.tasks.availableTransitions).mockResolvedValue({ data: [{ to_status_id: 'active', code: 'TODO', name: 'Belum dimulai' }] });
    vi.mocked(api.tasks.transition).mockRejectedValue(new ApiError(409, 'VERSION_CONFLICT', 'stale'));
    const conflictBoard: KanbanBoard = { ...board, columns: [
      { status: activeStatus, task_count: 0, cards: [] },
      { status: archivedStatus, task_count: 1, cards: [card('task-2', 'Archived task', archivedStatus)] },
    ] };
    vi.mocked(api.tasks.kanban).mockResolvedValue({ data: conflictBoard });
    render(<KanbanPage />);
    const select = await screen.findByLabelText('Ubah status Archived task');
    fireEvent.focus(select);
    await within(select).findByRole('option', { name: 'Belum dimulai' });
    fireEvent.change(select, { target: { value: 'active' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Tugas telah berubah');
    expect(api.tasks.transition).toHaveBeenCalledTimes(1);
    expect(api.tasks.kanban).toHaveBeenCalledTimes(2);
    expect(within(screen.getByRole('region', { name: 'Archived: Old Review (diarsipkan, tidak dapat menerima tugas)' })).getByText('Archived task')).toBeVisible();
  });
});

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

const activeStatus = { id: 'active', code: 'TODO', name: 'Belum dimulai', category: 'TODO', is_active: true };
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
    currentSearch = '';
    vi.mocked(api.tasks.kanban).mockResolvedValue({ data: board });
    vi.mocked(api.workspaces.workflows).mockResolvedValue({ data: [board.workflow] });
    vi.mocked(api.workspaces.teams).mockResolvedValue({ data: [] });
    vi.mocked(api.workspaces.members).mockResolvedValue({ data: [] });
    vi.mocked(api.tasks.availableTransitions).mockResolvedValue({ data: [{ to_status_id: 'active', code: 'TODO', name: 'To Do' }] });
    vi.mocked(api.tasks.transition).mockResolvedValue({} as never);
  });

  it('keeps archived cards visible while marking their column as unavailable for drops', async () => {
    render(<KanbanPage />);
    const archivedColumn = await screen.findByRole('region', { name: 'Archived: Old Review (diarsipkan, tidak dapat menerima tugas)' });

    expect(within(archivedColumn).getByText('Archived task')).toBeVisible();
    expect(within(archivedColumn).getByText('Tidak dapat menerima tugas')).toBeVisible();
    expect(archivedColumn).toHaveClass('border-dashed');

    fireEvent.dragStart(screen.getByText('Active task').closest('article')!);
    await waitFor(() => expect(api.tasks.availableTransitions).toHaveBeenCalledWith('workspace-1', 'task-1'));
    const dragOver = createEvent.dragOver(archivedColumn);
    fireEvent(archivedColumn, dragOver);
    expect(dragOver.defaultPrevented).toBe(false);
    await act(async () => { fireEvent.drop(archivedColumn); });

    expect(api.tasks.transition).not.toHaveBeenCalled();
  });

  it('excludes archived targets but lets archived cards move to active targets', async () => {
    render(<KanbanPage />);
    const activeSelect = await screen.findByLabelText('Ubah status Active task');
    const archivedSelect = screen.getByLabelText('Ubah status Archived task');

    expect(within(activeSelect).queryByRole('option', { name: 'Archived: Old Review' })).not.toBeInTheDocument();
    fireEvent.focus(archivedSelect);
    expect(await within(archivedSelect).findByRole('option', { name: 'Belum dimulai' })).toBeInTheDocument();

    fireEvent.change(archivedSelect, { target: { value: 'active' } });
    await waitFor(() => expect(api.tasks.transition).toHaveBeenCalledWith('workspace-1', 'task-2', { version: 1, to_status_id: 'active' }));
  });

  it('rejects an archived target even if a stale selector offers it', async () => {
    render(<KanbanPage />);
    const select = await screen.findByLabelText('Ubah status Active task');
    const option = document.createElement('option');
    option.value = 'archived';
    select.append(option);
    await act(async () => { fireEvent.change(select, { target: { value: 'archived' } }); });

    expect(api.tasks.availableTransitions).not.toHaveBeenCalled();
    expect(api.tasks.transition).not.toHaveBeenCalled();
    expect(within(screen.getByRole('region', { name: 'Belum dimulai' })).getByText('Active task')).toBeVisible();
  });

  it('accepts drop while transition lookup is pending, then validates before mutation', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof api.tasks.availableTransitions>>) => void;
    vi.mocked(api.tasks.availableTransitions).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    render(<KanbanPage />);
    const activeColumn = await screen.findByRole('region', { name: 'Belum dimulai' });
    fireEvent.dragStart(screen.getByText('Archived task').closest('article')!);
    await waitFor(() => expect(api.tasks.availableTransitions).toHaveBeenCalledWith('workspace-1', 'task-2'));
    const dragOver = createEvent.dragOver(activeColumn);
    fireEvent(activeColumn, dragOver);
    expect(dragOver.defaultPrevented).toBe(true);
    fireEvent.drop(activeColumn);
    expect(api.tasks.transition).not.toHaveBeenCalled();
    await act(async () => resolve({ data: [{ to_status_id: 'active', code: 'TODO', name: 'Belum dimulai' }] }));
    await waitFor(() => expect(api.tasks.transition).toHaveBeenCalledWith('workspace-1', 'task-2', { version: 1, to_status_id: 'active' }));
  });

  it('preserves drops onto active columns', async () => {
    render(<KanbanPage />);
    const activeColumn = await screen.findByRole('region', { name: 'Belum dimulai' });
    fireEvent.dragStart(screen.getByText('Archived task').closest('article')!);
    await waitFor(() => expect(api.tasks.availableTransitions).toHaveBeenCalledWith('workspace-1', 'task-2'));
    const dragOver = createEvent.dragOver(activeColumn);
    fireEvent(activeColumn, dragOver);
    expect(dragOver.defaultPrevented).toBe(true);
    expect(screen.getByText('Lepaskan untuk memindahkan')).toBeVisible();
    fireEvent.drop(activeColumn);

    await waitFor(() => expect(api.tasks.transition).toHaveBeenCalledWith('workspace-1', 'task-2', { version: 1, to_status_id: 'active' }));
  });
});
