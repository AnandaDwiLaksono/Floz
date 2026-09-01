import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MyWorkPage from '../app/workspaces/[workspaceId]/my-work/page';
import MemberDashboardPage from '../app/workspaces/[workspaceId]/dashboard/page';
import { formatDuration, formatRatio } from '../lib/report-format';
import { api, ApiError, MemberDashboard, MyWorkSummary } from '../lib/api-client';

const push = vi.fn();
const workspace = { id: 'workspace-1', name: 'Field Ops', role: 'MEMBER' as const, membership_status: 'ACTIVE', timezone: 'Asia/Jakarta' };

vi.mock('next/navigation', () => ({ useParams: () => ({ workspaceId: 'workspace-1' }), useRouter: () => ({ push }) }));
vi.mock('../lib/auth-context', () => ({ useAuth: () => ({ user: { workspaces: [workspace] } }) }));
vi.mock('../lib/api-client', async (load) => {
  const actual = await load<typeof import('../lib/api-client')>();
  return { ...actual, api: { ...actual.api, workspaces: { ...actual.api.workspaces, myWork: vi.fn(), dashboardMember: vi.fn() } } };
});

const task = { id: 'task-1', taskKey: 'TASK-1', title: 'Inspect pump', dueAt: '2026-09-01T09:00:00.000Z', priority: 'HIGH' };
const emptyWork: MyWorkSummary = { today: [], upcoming: [], overdue: [], counts: { today: 0, upcoming: 0, overdue: 0 } };
const dashboard: MemberDashboard = {
  kpis: {
    completion_rate: '0.500000', overdue_rate: '0.250000', on_time_completion_rate: '0.750000', average_completion_time_seconds: '5400', workload: 4,
    denominators: { due: 4, completed: 2, overdue: 1, onTime: 3 },
    period: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z', evaluationAt: '2026-09-02T00:00:00.000Z' },
    filters: { deleted: 'NULL', category: 'NOT_CANCELLED', due: 'CURRENT_DUE_AT', completion: 'CURRENT_COMPLETED_AT' },
  },
  workload_by_team: [{ key: 'Field', count: 4 }], workload_by_assignee: [{ userId: 'user-1', name: 'Member', count: 4 }], unassigned: 0,
  status_breakdown: [{ key: 'OPEN', count: 3, position: 1, id: 'status-1' }], priority_breakdown: [{ key: 'HIGH', count: 4 }],
};

describe('Task 8 member pages', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

  it('uses exact My Work wire fields, runtime workspace date, distinct canonical links, and drilldown route', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-31T18:30:00.000Z'));
    vi.mocked(api.workspaces.myWork).mockResolvedValue({ data: { ...emptyWork, today: [task], counts: { today: 1, upcoming: 0, overdue: 0 } }, meta: { date: '2026-09-01', timezone: 'Asia/Jakarta' } });
    render(<MyWorkPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(screen.getByRole('heading', { name: 'My Work' })).toBeInTheDocument();
    expect(api.workspaces.myWork).toHaveBeenCalledWith('workspace-1', '2026-09-01');
    fireEvent.click(screen.getByRole('button', { name: /Inspect pump/ }));
    expect(push).toHaveBeenCalledWith('/workspaces/workspace-1/tasks?selected_task_id=task-1');
    expect(screen.getByRole('link', { name: 'View all due today' })).toHaveAttribute('href', '/workspaces/workspace-1/tasks?bucket=active&due_from=2026-08-31T17%3A00%3A00.000Z&due_to=2026-09-01T17%3A00%3A00.000Z&sort=due_at');
    expect(screen.getByRole('link', { name: 'View all upcoming' }).getAttribute('href')).toContain('due_from=2026-09-01T17%3A00%3A00.000Z');
    expect(screen.getByRole('link', { name: 'View all overdue' })).toHaveAttribute('href', '/workspaces/workspace-1/tasks?bucket=active&due_to=2026-08-31T17%3A00%3A00.000Z&sort=due_at');
  });

  it.each([[403, 'You do not have permission to view My Work.'], [500, 'My Work unavailable']])('renders My Work permission/error state for %i', async (status, text) => {
    vi.mocked(api.workspaces.myWork).mockRejectedValue(new ApiError(status, 'ERROR', status === 500 ? text : 'Forbidden'));
    render(<MyWorkPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.workspaces.myWork).toHaveBeenCalledTimes(2));
  });

  it('renders complete My Work empty state', async () => {
    vi.mocked(api.workspaces.myWork).mockResolvedValue({ data: emptyWork, meta: { date: '2026-09-01', timezone: 'Asia/Jakarta' } });
    render(<MyWorkPage />);
    expect(await screen.findByText('No tasks due today.')).toBeInTheDocument();
    expect(screen.getByText('No upcoming tasks.')).toBeInTheDocument();
    expect(screen.getByText('No overdue tasks.')).toBeInTheDocument();
  });

  it('renders typed member dashboard metrics and reusable active/completed links without raw status keys', async () => {
    vi.mocked(api.workspaces.dashboardMember).mockResolvedValue({ data: dashboard });
    render(<MemberDashboardPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    await screen.findByRole('heading', { name: 'Dashboard' });
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
    expect(screen.queryByText('OPEN')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View active tasks' })).toHaveAttribute('href', '/workspaces/workspace-1/tasks?bucket=active&sort=due_at');
    expect(screen.getByRole('link', { name: 'View completed tasks' })).toHaveAttribute('href', '/workspaces/workspace-1/tasks?bucket=completed&sort=-updated_at');
  });

  it('renders dashboard empty state and zero/null-safe formatting', async () => {
    vi.mocked(api.workspaces.dashboardMember).mockResolvedValue({ data: { ...dashboard, kpis: { ...dashboard.kpis, workload: 0 }, status_breakdown: [], priority_breakdown: [] } });
    render(<MemberDashboardPage />);
    expect(await screen.findByText('No assigned task data.')).toBeInTheDocument();
    expect(formatRatio('0.000000')).toBe('0%');
    expect(formatRatio(null)).toBe('—');
    expect(formatDuration('0')).toBe('0m');
    expect(formatDuration(null)).toBe('—');
  });

  it.each([[403, 'You do not have permission to view this page.'], [500, 'Dashboard unavailable']])('renders dashboard permission/error state for %i', async (status, text) => {
    vi.mocked(api.workspaces.dashboardMember).mockRejectedValue(new ApiError(status, 'ERROR', status === 500 ? text : 'Forbidden'));
    render(<MemberDashboardPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.workspaces.dashboardMember).toHaveBeenCalledTimes(2));
  });
});
