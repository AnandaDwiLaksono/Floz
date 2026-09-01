import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MyWorkPage from '../app/workspaces/[workspaceId]/my-work/page';
import MemberDashboardPage from '../app/workspaces/[workspaceId]/dashboard/page';
import { api, ApiError } from '../lib/api-client';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
  useRouter: () => ({ push }),
}));

vi.mock('../lib/api-client', async (load) => {
  const actual = await load<typeof import('../lib/api-client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      workspaces: {
        ...actual.api.workspaces,
        myWork: vi.fn(),
        dashboardMember: vi.fn(),
      },
    },
  };
});

const task = { id: 'task-1', taskKey: 'TASK-1', title: 'Inspect pump', dueAt: '2026-09-01T09:00:00.000Z', priority: 'HIGH' };
const dashboard = {
  kpis: {
    completion_rate: '0.500000', overdue_rate: '0.250000', on_time_completion_rate: '0.750000',
    average_completion_time_seconds: '5400', workload: 4,
    denominators: { due: 4, completed: 2, overdue: 1, onTime: 3 },
    period: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z', evaluationAt: '2026-09-02T00:00:00.000Z' },
    filters: {},
  },
  workload_by_team: [{ key: 'Field', count: 4 }],
  workload_by_assignee: [{ userId: 'user-1', name: 'Member', count: 4 }],
  unassigned: 0,
  status_breakdown: [{ key: 'OPEN', count: 3, position: 1, id: 'status-1' }],
  priority_breakdown: [{ key: 'HIGH', count: 4 }],
};

describe('Task 8 member pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders My Work API buckets and uses canonical task drilldowns and full-list filters', async () => {
    vi.mocked(api.workspaces.myWork).mockResolvedValue({
      data: { today: [task], upcoming: [], overdue: [], counts: { today: 1, upcoming: 0, overdue: 0 } },
      meta: { date: '2026-09-01', timezone: 'UTC' },
    });

    render(<MyWorkPage />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(await screen.findByRole('heading', { name: 'My Work' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Inspect pump/ }));
    expect(push).toHaveBeenCalledWith('/workspaces/workspace-1/tasks?selected_task_id=task-1');
    expect(screen.getByRole('link', { name: 'View all due today' })).toHaveAttribute('href', '/workspaces/workspace-1/tasks?bucket=active&sort=due_at');
    expect(screen.getByText('No upcoming tasks.')).toBeInTheDocument();
  });

  it('renders member dashboard values supplied by the API without deriving buckets', async () => {
    vi.mocked(api.workspaces.dashboardMember).mockResolvedValue({ data: dashboard });

    render(<MemberDashboardPage />);

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
    expect(screen.getByText('OPEN')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View my tasks' })).toHaveAttribute('href', '/workspaces/workspace-1/tasks?bucket=active&sort=due_at');
  });

  it.each([
    [403, 'You do not have permission to view this page.'],
    [500, 'Dashboard unavailable'],
  ])('renders member dashboard error state for %i', async (status, message) => {
    vi.mocked(api.workspaces.dashboardMember).mockRejectedValue(new ApiError(status, 'ERROR', message));
    render(<MemberDashboardPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(status === 403 ? 'You do not have permission to view this page.' : message);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.workspaces.dashboardMember).toHaveBeenCalledTimes(2));
  });
});
