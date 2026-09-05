import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CalendarPage from '../app/workspaces/[workspaceId]/calendar/page';
import TasksPage from '../app/workspaces/[workspaceId]/tasks/page';
import { api, ApiError, CalendarTaskSummary, Task } from '../lib/api-client';

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
        calendar: vi.fn(),
        list: vi.fn(),
        get: vi.fn(),
        update: vi.fn(),
        availableTransitions: vi.fn(),
      },
    },
  };
});

const sampleCalendarTask: CalendarTaskSummary = {
  id: 'task-1',
  task_key: 'TASK-1',
  title: 'Inspect pump',
  priority: 'HIGH',
  status: { id: 'st-1', key: 'OPEN', name: 'Open', category: 'UNSTARTED' },
  is_deadline_only: false,
  start_at: '2026-08-18T09:00:00.000Z',
  due_at: '2026-08-18T10:00:00.000Z',
  primary_assignee: { user_id: 'user-1', full_name: 'Admin User' },
};

const sampleTaskDetail: Task = {
  id: 'task-1',
  workspace_id: 'workspace-1',
  task_key: 'TASK-1',
  title: 'Inspect pump',
  description: 'Regular maintenance',
  priority: 'HIGH',
  status_id: 'st-1',
  status: { id: 'st-1', key: 'OPEN', name: 'Open', category: 'UNSTARTED', position: 1, is_terminal: false },
  version: 2,
  creator_id: 'user-1',
  start_at: '2026-08-18T09:00:00.000Z',
  due_at: '2026-08-18T10:00:00.000Z',
  completed_at: null,
  cancelled_at: null,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  is_overdue: false,
  assignees: [{ user_id: 'user-1', full_name: 'Admin User', role: 'ADMIN', is_primary: true }],
};

describe('Task 8 Calendar reschedule flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    vi.mocked(api.workspaces.get).mockResolvedValue({
      data: { id: 'workspace-1', name: 'Field Ops', slug: 'field-ops', timezone: 'UTC' },
    });
    vi.mocked(api.workspaces.teams).mockResolvedValue({ data: [] });
    vi.mocked(api.workspaces.members).mockResolvedValue({
      data: [{ workspace_id: 'workspace-1', user_id: 'user-1', role: 'ADMIN', status: 'ACTIVE', user: { full_name: 'Admin User', email: 'admin@example.com' } }],
    });
    vi.mocked(api.workspaces.workflows).mockResolvedValue({
      data: [{ id: 'wf-1', name: 'Default', is_default: true, statuses: [{ id: 'st-1', key: 'OPEN', name: 'Open', category: 'UNSTARTED', position: 1, is_terminal: false }] }],
    });
    vi.mocked(api.tasks.calendar).mockResolvedValue({ data: [sampleCalendarTask] });
    vi.mocked(api.tasks.list).mockResolvedValue({
      data: [sampleTaskDetail],
      meta: { pagination: { has_more: false, next_cursor: null } },
    });
    vi.mocked(api.tasks.get).mockResolvedValue({ data: sampleTaskDetail });
    vi.mocked(api.tasks.availableTransitions).mockResolvedValue({ data: [] });
  });

  it('preserves calendar context and navigates to edit_schedule flow', async () => {
    mockSearchParams = new URLSearchParams('view=week&date=2026-08-18&team_id=team-1&assignee_id=user-1');
    render(<CalendarPage />);
    await waitFor(() => expect(api.tasks.calendar).toHaveBeenCalled());

    const taskBtn = await screen.findByRole('button', { name: /Inspect pump/ });
    fireEvent.click(taskBtn);

    expect(push).toHaveBeenCalledWith(
      expect.stringContaining('selected_task_id=task-1')
    );
    expect(push).toHaveBeenCalledWith(
      expect.stringContaining('cal_view=week')
    );
    expect(push).toHaveBeenCalledWith(
      expect.stringContaining('cal_date=2026-08-18')
    );
  });

  it('opens edit schedule mode directly in tasks page when edit_schedule=1 is present', async () => {
    mockSearchParams = new URLSearchParams('selected_task_id=task-1&edit_schedule=1&cal_view=week&cal_date=2026-08-18');
    render(<TasksPage />);

    await waitFor(() => expect(api.tasks.get).toHaveBeenCalledWith('workspace-1', 'task-1'));

    expect(await screen.findByRole('heading', { name: /Edit Task Fields/i })).toBeInTheDocument();
    const startInput = screen.getByLabelText(/Start Date/i) as HTMLInputElement;
    const dueInput = screen.getByLabelText(/Due Date/i) as HTMLInputElement;

    expect(startInput.value).toBe('2026-08-18T09:00');
    expect(dueInput.value).toBe('2026-08-18T10:00');
  });

  it('saves rescheduled task with version and provides return to calendar button', async () => {
    mockSearchParams = new URLSearchParams('selected_task_id=task-1&edit_schedule=1&cal_view=week&cal_date=2026-08-18');
    vi.mocked(api.tasks.update).mockResolvedValue({
      data: {
        ...sampleTaskDetail,
        start_at: '2026-08-19T09:00:00.000Z',
        due_at: '2026-08-19T10:00:00.000Z',
        version: 3,
      },
    });

    render(<TasksPage />);
    await waitFor(() => expect(api.tasks.get).toHaveBeenCalledWith('workspace-1', 'task-1'));

    const dueInput = screen.getByLabelText(/Due Date/i);
    fireEvent.change(dueInput, { target: { value: '2026-08-19T10:00' } });

    const saveBtn = screen.getByRole('button', { name: /Save Changes/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(api.tasks.update).toHaveBeenCalledWith(
        'workspace-1',
        'task-1',
        expect.objectContaining({
          version: 2,
        })
      );
    });

    const returnBtn = await screen.findByRole('button', { name: /Return to Calendar/i });
    expect(returnBtn).toBeInTheDocument();

    fireEvent.click(returnBtn);
    expect(push).toHaveBeenCalledWith('/workspaces/workspace-1/calendar?view=week&date=2026-08-18');
  });

  it('handles version conflict 409 when saving rescheduled task', async () => {
    mockSearchParams = new URLSearchParams('selected_task_id=task-1&edit_schedule=1&cal_view=month&cal_date=2026-08-01');
    vi.mocked(api.tasks.update).mockRejectedValue(new ApiError(409, 'VERSION_CONFLICT', 'Task was modified by another user'));

    render(<TasksPage />);
    await waitFor(() => expect(api.tasks.get).toHaveBeenCalledWith('workspace-1', 'task-1'));

    const saveBtn = screen.getByRole('button', { name: /Save Changes/i });
    fireEvent.click(saveBtn);

    expect(await screen.findByText(/VERSION_CONFLICT/i)).toBeInTheDocument();
  });

  it('rejects start_at > due_at schedule input before or at submission', async () => {
    mockSearchParams = new URLSearchParams('selected_task_id=task-1&edit_schedule=1&cal_view=month&cal_date=2026-08-01');

    render(<TasksPage />);
    await waitFor(() => expect(api.tasks.get).toHaveBeenCalledWith('workspace-1', 'task-1'));

    const startInput = screen.getByLabelText(/Start Date/i);
    const dueInput = screen.getByLabelText(/Due Date/i);

    fireEvent.change(startInput, { target: { value: '2026-08-20T10:00' } });
    fireEvent.change(dueInput, { target: { value: '2026-08-18T10:00' } });

    const saveBtn = screen.getByRole('button', { name: /Save Changes/i });
    fireEvent.click(saveBtn);

    expect(await screen.findByText(/Start date must be before or equal to due date/i)).toBeInTheDocument();
    expect(api.tasks.update).not.toHaveBeenCalled();
  });
});
