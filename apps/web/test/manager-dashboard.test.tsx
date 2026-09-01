import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ManagerDashboardPage from '../app/workspaces/[workspaceId]/manager-dashboard/page';
import { reportingDefaults, reportingPeriod } from '../lib/reporting-period';
import { api, Dashboard, ReportingKpis } from '../lib/api-client';

const auth = vi.hoisted(() => ({ role: 'MANAGER' as 'MANAGER' | 'ADMIN' | 'MEMBER' }));
vi.mock('next/navigation', () => ({ useParams: () => ({ workspaceId: 'workspace-1' }) }));
vi.mock('../lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'user-1', workspaces: [{ id: 'workspace-1', role: auth.role, timezone: 'America/New_York' }] } }) }));
vi.mock('../lib/api-client', async (load) => {
  const actual = await load<typeof import('../lib/api-client')>();
  return { ...actual, api: { ...actual.api, workspaces: { ...actual.api.workspaces, get: vi.fn(), dashboardManager: vi.fn(), kpis: vi.fn() } } };
});

const kpis: ReportingKpis = {
  completion_rate: '0.625000', overdue_rate: '0.125000', on_time_completion_rate: '0.500000', average_completion_time_seconds: '5400', workload: 8,
  denominators: { due: 8, completed: 5, overdue: 1, onTime: 4 },
  period: { from: '2026-03-01T05:00:00.000Z', to: '2026-03-20T16:00:00.000Z', evaluationAt: '2026-03-20T16:00:00.000Z' },
  filters: { deleted: 'NULL', category: 'NOT_CANCELLED', due: 'CURRENT_DUE_AT', completion: 'CURRENT_COMPLETED_AT' },
};
const dashboard: Dashboard = {
  kpis, workload_by_team: [{ key: 'Field', count: 5 }, { key: null, count: 2 }],
  workload_by_assignee: [{ userId: 'user-2', name: 'Alex', count: 3 }], unassigned: 2,
  status_breakdown: [{ key: 'OPEN', count: 4, position: 1, id: 'status-1' }],
  priority_breakdown: [{ key: 'LOW', count: 1 }, { key: 'URGENT', count: 4 }, { key: 'MEDIUM', count: 2 }, { key: 'HIGH', count: 3 }],
};

describe('Task 9 manager dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks(); auth.role = 'MANAGER';
    vi.mocked(api.workspaces.get).mockResolvedValue({ data: { id: 'workspace-1', name: 'Field Ops', slug: 'field-ops', timezone: 'America/New_York' } });
    vi.mocked(api.workspaces.dashboardManager).mockResolvedValue({ data: dashboard });
    vi.mocked(api.workspaces.kpis).mockResolvedValue({ data: kpis });
  });

  it('converts each target local midnight with its actual offset', () => {
    expect(reportingPeriod('2026-03-08', '2026-03-08', 'America/New_York')).toEqual({ from: '2026-03-08T00:00:00.000-05:00', to: '2026-03-09T00:00:00.000-04:00' });
    expect(reportingPeriod('2011-12-29', '2011-12-29', 'Pacific/Apia')).toEqual({ from: '2011-12-29T00:00:00.000-10:00', to: '2011-12-30T00:00:00.000+14:00' });
  });

  it('derives MTD defaults from workspace-local today', () => {
    expect(reportingDefaults('Pacific/Kiritimati', new Date('2026-08-31T12:30:00.000Z'))).toEqual({ from: '2026-09-01', to: '2026-09-01' });
  });

  it.each(['MANAGER', 'ADMIN'] as const)('is visible to %s and uses exact scope', async (role) => {
    auth.role = role; render(<ManagerDashboardPage />);
    expect(await screen.findByRole('heading', { name: 'Manager dashboard' })).toBeInTheDocument();
    expect(api.workspaces.dashboardManager).toHaveBeenCalledWith('workspace-1', expect.objectContaining({ from: expect.stringMatching(/[+-]\d\d:\d\d$/), to: expect.stringMatching(/[+-]\d\d:\d\d$/) }));
    expect(api.workspaces.kpis).toHaveBeenCalledWith('workspace-1', expect.objectContaining({ from: expect.any(String), to: expect.any(String) }));
  });

  it('hides manager reporting from members', async () => {
    auth.role = 'MEMBER'; render(<ManagerDashboardPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('MANAGER or ADMIN');
    expect(api.workspaces.dashboardManager).not.toHaveBeenCalled();
  });

  it('uses API evaluation_at for MTD and formats API values only', async () => {
    render(<ManagerDashboardPage />);
    expect(await screen.findByText('62.5%')).toBeInTheDocument();
    expect(screen.getAllByRole('definition')[0]).toHaveTextContent('62.5%');
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
    expect(screen.getByLabelText('From')).toHaveAttribute('id', 'report-from');
    expect(screen.getByLabelText('To')).toHaveAttribute('id', 'report-to');
    expect(screen.getByText(/Evaluated Mar 20, 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/pending approvals/i)).not.toBeInTheDocument();
  });

  it('shows unassigned workload, canonical priority order, text tables, and canonical links', async () => {
    render(<ManagerDashboardPage />); await screen.findByText('Unassigned workload');
    expect(screen.getByText('2', { selector: 'strong' })).toBeInTheDocument();
    const priority = screen.getByRole('table', { name: 'Priority breakdown' });
    expect(within(priority).getAllByRole('row').slice(1).map((row) => row.textContent)).toEqual(['Urgent4', 'High3', 'Medium2', 'Low1']);
    expect(screen.getByRole('table', { name: 'Workload by team' })).toBeInTheDocument();
    const unassigned = new URL(screen.getByRole('link', { name: 'View unassigned tasks' }).getAttribute('href')!, 'https://floz.test');
    expect(Object.fromEntries(unassigned.searchParams)).toMatchObject({ assignee_id: 'unassigned', sort: 'priority' });
    expect(unassigned.searchParams.has('bucket')).toBe(false);
    expect(new URL(screen.getByRole('link', { name: 'View urgent tasks' }).getAttribute('href')!, 'https://floz.test').searchParams.get('priority')).toBe('URGENT');
  });

  it('keeps dashboard and KPI loading/error states independent', async () => {
    let resolveDashboard!: (value: { data: Dashboard }) => void;
    vi.mocked(api.workspaces.dashboardManager).mockReturnValue(new Promise((resolve) => { resolveDashboard = resolve; }));
    vi.mocked(api.workspaces.kpis).mockRejectedValue(new Error('KPI unavailable'));
    render(<ManagerDashboardPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('KPI unavailable');
    expect(screen.getByRole('status', { name: 'Dashboard loading' })).toBeInTheDocument();
    resolveDashboard({ data: dashboard });
    expect(await screen.findByText('Unassigned workload')).toBeInTheDocument();
  });
});
