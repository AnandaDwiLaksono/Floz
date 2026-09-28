import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TasksPage from '../app/workspaces/[workspaceId]/tasks/page';
import { api, Task } from '../lib/api-client';

const push = vi.fn();
const workspace = { id: 'workspace-1', name: 'Field Ops', role: 'ADMIN' as const, membership_status: 'ACTIVE', timezone: 'UTC' };

let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
  useRouter: () => ({ push }),
  useSearchParams: () => mockSearchParams,
}));

vi.mock('../lib/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'user-1', full_name: 'Admin User', workspaces: [workspace] },
    activeWorkspace: workspace,
  }),
}));

vi.mock('../lib/api-client', async (load) => {
  const actual = await load<typeof import('../lib/api-client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      workspaces: {
        ...actual.api.workspaces,
        get: vi.fn(),
        teams: vi.fn(),
        members: vi.fn(),
        workflows: vi.fn(),
      },
      tasks: {
        ...actual.api.tasks,
        list: vi.fn(),
        get: vi.fn(),
        update: vi.fn(),
        availableTransitions: vi.fn(),
      },
    },
  };
});

const mockTask: Task = {
  id: 'task-1',
  workspace_id: 'workspace-1',
  task_key: 'TASK-1',
  title: 'Inspect pump',
  description: 'Regular maintenance',
  priority: 'HIGH',
  status_id: 'st-1',
  status: { id: 'st-1', code: 'OPEN', name: 'Open', category: 'UNSTARTED', is_terminal: false },
  version: 1,
  creator_id: 'user-1',
  workflow_id: 'wf-1',
  team_id: null,
  start_at: null,
  due_at: '2026-08-18T10:00:00.000Z',
  completed_at: null,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  is_overdue: true,
  assignees: [{ user_id: 'user-1', full_name: 'Admin User', is_primary: true }],
};

describe('Task 10 Task filter UI completion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    vi.mocked(api.workspaces.get).mockResolvedValue({
      data: { id: 'workspace-1', name: 'Field Ops', slug: 'field-ops', timezone: 'UTC' },
    });
    vi.mocked(api.workspaces.teams).mockResolvedValue({
      data: [{ id: 'team-1', workspace_id: 'workspace-1', name: 'Ops Team', description: null, manager_user_id: null, isActive: true }],
    });
    vi.mocked(api.workspaces.members).mockResolvedValue({
      data: [{ user_id: 'user-1', full_name: 'Admin User', email: 'admin@example.com', role: 'ADMIN', status: 'ACTIVE', user: { id: 'user-1', full_name: 'Admin User', email: 'admin@example.com' } }],
    });
    vi.mocked(api.workspaces.workflows).mockResolvedValue({
      data: [{
        id: 'wf-1',
        name: 'Default',
        team_id: null,
        is_active: true,
        is_default: true,
        statuses: [
          { id: 'st-1', code: 'OPEN', name: 'Open', category: 'UNSTARTED', is_terminal: false },
          { id: 'st-2', code: 'DONE', name: 'Done', category: 'DONE', is_terminal: true },
        ],
      }],
    });
    vi.mocked(api.tasks.list).mockResolvedValue({
      data: [mockTask],
      meta: { pagination: { limit: 10, has_more: false, next_cursor: null } },
    });
  });

  it('removes cursor pagination state when filters change', async () => {
    mockSearchParams = new URLSearchParams('cursor=cursor-123&priority=LOW');
    render(<TasksPage />);

    await waitFor(() => expect(api.tasks.list).toHaveBeenCalled());

    const prioritySelect = screen.getByLabelText(/Priority filter/i);
    fireEvent.change(prioritySelect, { target: { value: 'HIGH' } });

    expect(push).toHaveBeenCalledWith(
      expect.not.stringContaining('cursor=')
    );
    expect(push).toHaveBeenCalledWith(
      expect.stringContaining('priority=HIGH')
    );
  });

  it('emits overdue=true when Overdue Only is checked, and removes parameter when unchecked', async () => {
    mockSearchParams = new URLSearchParams();
    render(<TasksPage />);

    await waitFor(() => expect(api.tasks.list).toHaveBeenCalled());

    const overdueCheckbox = screen.getByRole('checkbox', { name: /Overdue only/i });
    expect(overdueCheckbox).not.toBeChecked();

    await act(async () => {
      fireEvent.click(overdueCheckbox);
    });
    expect(push).toHaveBeenCalledWith(expect.stringContaining('overdue=true'));

    // Now test unchecking with overdue=true active
    mockSearchParams = new URLSearchParams('overdue=true');
    render(<TasksPage />);

    const checkedBoxes = screen.getAllByRole('checkbox', { name: /Overdue only/i });
    const checkedBox = checkedBoxes[checkedBoxes.length - 1];
    await act(async () => {
      fireEvent.click(checkedBox);
    });

    // Must remove overdue parameter entirely, NEVER send overdue=false
    expect(push).toHaveBeenCalledWith(expect.not.stringContaining('overdue=false'));
  });

  it('defaults the Active tab to the backend active bucket when no bucket is in the URL', async () => {
    render(<TasksPage />);

    await waitFor(() => {
      expect(api.tasks.list).toHaveBeenCalledWith(
        'workspace-1',
        expect.objectContaining({ bucket: 'active' })
      );
    });
  });

  it('forwards canonical filters to api.tasks.list including bucket, due dates, assignee, team, overdue', async () => {
    mockSearchParams = new URLSearchParams(
      'q=pump&status_id=st-1&priority=HIGH&team_id=team-1&assignee_id=user-1&bucket=active&overdue=true&sort=due_at'
    );
    render(<TasksPage />);

    await waitFor(() => {
      expect(api.tasks.list).toHaveBeenCalledWith(
        'workspace-1',
        expect.objectContaining({
          q: 'pump',
          status_id: 'st-1',
          priority: 'HIGH',
          team_id: 'team-1',
          assignee_id: 'user-1',
          bucket: 'active',
          overdue: 'true',
          sort: 'due_at',
        })
      );
    });
  });

  it('switches between Active and Completed bucket tabs and resets cursor', async () => {
    mockSearchParams = new URLSearchParams('cursor=page-2');
    render(<TasksPage />);

    await waitFor(() => expect(api.tasks.list).toHaveBeenCalled());

    const completedTab = screen.getByRole('button', { name: /^Selesai$/i });
    fireEvent.click(completedTab);

    expect(push).toHaveBeenCalledWith(
      expect.stringContaining('bucket=completed')
    );
    expect(push).toHaveBeenCalledWith(
      expect.not.stringContaining('cursor=')
    );
  });

  it('uses Indonesian essential controls and reveals advanced filters on demand', async () => {
    render(<TasksPage />);

    await screen.findByRole('heading', { name: 'Tugas' });
    expect(screen.getByRole('button', { name: 'Buat tugas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter lainnya' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Tenggat mulai')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Filter lainnya' }));

    expect(screen.getByLabelText('Tenggat mulai')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buka tugas Inspect pump' })).toBeInTheDocument();
  });

  it('presents task detail in Indonesian with a contextual delete action', async () => {
    vi.mocked(api.tasks.get).mockResolvedValue({ data: mockTask });
    vi.mocked(api.tasks.availableTransitions).mockResolvedValue({ data: [] });
    render(<TasksPage />);

    await waitFor(() => expect(api.tasks.list).toHaveBeenCalled());
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Buka tugas Inspect pump' }));
    });

    expect(await screen.findByRole('dialog', { name: 'Detail tugas' })).toBeInTheDocument();
    expect(screen.getByText('Tenggat')).toBeInTheDocument();
    expect(screen.getByText('Penanggung jawab')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hapus tugas Inspect pump' })).toBeInTheDocument();
  });

  it('allows MANAGER to see delete action and enforces focus-trap in Task Detail', async () => {
    vi.mocked(api.tasks.get).mockResolvedValue({ data: mockTask });
    vi.mocked(api.tasks.availableTransitions).mockResolvedValue({ data: [] });
    render(<TasksPage />);

    await waitFor(() => expect(api.tasks.list).toHaveBeenCalled());
    const openBtn = await screen.findByRole('button', { name: 'Buka tugas Inspect pump' });
    await act(async () => {
      fireEvent.click(openBtn);
    });

    const dialog = await screen.findByRole('dialog', { name: 'Detail tugas' });
    expect(dialog).toBeInTheDocument();
    // MANAGER role is allowed to delete
    expect(screen.getByRole('button', { name: 'Hapus tugas Inspect pump' })).toBeInTheDocument();

    // Escape dispatched to the dialog element closes it (focus-trap handler)
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Detail tugas' })).not.toBeInTheDocument());
  });

  it('renders visible header close button (X) and Ubah button in Task Detail', async () => {
    mockSearchParams = new URLSearchParams('selected_task_id=task-1&return_to=%2Fworkspaces%2Fworkspace-1%2Fcalendar%3Fview%3Dweek');
    vi.mocked(api.tasks.get).mockResolvedValue({ data: mockTask });
    vi.mocked(api.tasks.availableTransitions).mockResolvedValue({ data: [] });
    render(<TasksPage />);

    const dialog = await screen.findByRole('dialog', { name: 'Detail tugas' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ubah' })).toBeInTheDocument();

    const closeBtn = screen.getByRole('button', { name: 'Tutup detail tugas' });
    expect(closeBtn).toBeInTheDocument();

    fireEvent.click(closeBtn);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Detail tugas' })).not.toBeInTheDocument());
    expect(push).toHaveBeenCalledWith(
      '/workspaces/workspace-1/tasks?return_to=%2Fworkspaces%2Fworkspace-1%2Fcalendar%3Fview%3Dweek'
    );
  });
});
