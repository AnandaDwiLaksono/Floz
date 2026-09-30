import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ManagerDashboardPage from '../app/workspaces/[workspaceId]/manager-dashboard/page';
import { reportingDefaults, reportingPeriod } from '../lib/reporting-period';
import { api, Dashboard, ReportingKpis } from '../lib/api-client';

const auth = vi.hoisted(() => ({ role: 'MANAGER' as 'MANAGER' | 'ADMIN' | 'MEMBER' }));
vi.mock('next/navigation', () => ({ useParams: () => ({ workspaceId: 'workspace-1' }) }));
vi.mock('../lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'user-1', workspaces: [{ id: 'workspace-1', role: auth.role, timezone: 'America/New_York' }] }, activeWorkspace: { id: 'workspace-1', role: auth.role, timezone: 'America/New_York' }, workspaceResolving: false }) }));
vi.mock('../lib/api-client', async (load) => {
  const actual = await load<typeof import('../lib/api-client')>();
  return { ...actual, api: { ...actual.api, workspaces: { ...actual.api.workspaces, get: vi.fn(), dashboardManager: vi.fn(), kpis: vi.fn(), teams: vi.fn(), members: vi.fn() } } };
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
    vi.mocked(api.workspaces.teams).mockResolvedValue({ data: [{ id: 'team-1', workspace_id: 'workspace-1', name: 'Operasional', description: null, manager_user_id: 'user-1', isActive: true }] });
    vi.mocked(api.workspaces.members).mockResolvedValue({ data: [{ user_id: 'user-2', full_name: 'Alex', email: 'alex@example.test', role: 'MEMBER', status: 'ACTIVE' }] });
  });

  it('converts to the first representable instant on or after the requested local date', () => {
    expect(reportingPeriod('2026-03-08', '2026-03-08', 'America/New_York')).toEqual({ from: '2026-03-08T00:00:00.000-05:00', to: '2026-03-09T00:00:00.000-04:00' });
    const apia = reportingPeriod('2011-12-29', '2011-12-29', 'Pacific/Apia');
    expect(apia.to).toBe('2011-12-31T00:00:00.000+14:00');
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Apia', dateStyle: 'short', timeStyle: 'medium', hourCycle: 'h23' }).format(new Date(apia.to))).toBe('2011-12-31, 00:00:00');
    const saoPaulo = reportingPeriod('2018-11-03', '2018-11-03', 'America/Sao_Paulo');
    expect(saoPaulo.to).toBe('2018-11-04T01:00:00.000-02:00');
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium', hourCycle: 'h23' }).format(new Date(saoPaulo.to))).toBe('2018-11-04, 01:00:00');
  });

  it('derives MTD defaults from workspace-local today', () => {
    expect(reportingDefaults('Pacific/Kiritimati', new Date('2026-08-31T12:30:00.000Z'))).toEqual({ from: '2026-09-01', to: '2026-09-01' });
  });

  it.each(['MANAGER', 'ADMIN'] as const)('is visible to %s and uses exact scope', async (role) => {
    auth.role = role; render(<ManagerDashboardPage />);
    expect(await screen.findByRole('heading', { name: 'Dasbor Manajer' })).toBeInTheDocument();
    expect(api.workspaces.dashboardManager).toHaveBeenCalledWith('workspace-1', expect.objectContaining({ from: expect.stringMatching(/[+-]\d\d:\d\d$/), to: expect.stringMatching(/[+-]\d\d:\d\d$/) }));
    expect(api.workspaces.kpis).toHaveBeenCalledWith('workspace-1', expect.objectContaining({ from: expect.any(String), to: expect.any(String) }));
  });

  it('hides manager reporting from members', async () => {
    auth.role = 'MEMBER'; render(<ManagerDashboardPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Akses hanya untuk Manajer atau Admin.');
    expect(api.workspaces.dashboardManager).not.toHaveBeenCalled();
  });

  it('loads Indonesian filters and forwards the selected team without changing the period contract', async () => {
    render(<ManagerDashboardPage />);
    await screen.findByRole('heading', { name: 'Dasbor Manajer' });
    expect(screen.getByLabelText('Tim')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Tim'), { target: { value: 'team-1' } });
    await waitFor(() => expect(api.workspaces.dashboardManager).toHaveBeenLastCalledWith('workspace-1', expect.objectContaining({ team_id: 'team-1' })));
    await waitFor(() => expect(api.workspaces.kpis).toHaveBeenLastCalledWith('workspace-1', expect.objectContaining({ team_id: 'team-1' })));
    expect(screen.getByText(/Ruang lingkup:/)).toBeInTheDocument();
  });

  it('renders supported pending approvals and workload actions', async () => {
    vi.mocked(api.workspaces.dashboardManager).mockResolvedValue({ data: { ...dashboard, pending_approvals: 2, drilldown_url: '/workspaces/workspace-1/approvals?view=managed&status=PENDING' } });
    render(<ManagerDashboardPage />);
    expect(await screen.findByText('Persetujuan menunggu')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Buka persetujuan menunggu' })).toHaveAttribute('href', '/workspaces/workspace-1/approvals?view=managed&status=PENDING');
    expect(screen.getByText('Alex')).toBeInTheDocument();
  });

  it('uses API evaluation_at for MTD and formats API values only', async () => {
    render(<ManagerDashboardPage />);
    expect(await screen.findByText('62.5%')).toBeInTheDocument();
    expect(screen.getByText('1 jam 30 menit')).toBeInTheDocument();
    expect(screen.getByLabelText('Dari')).toHaveAttribute('id', 'report-from');
    expect(screen.getByLabelText('Sampai')).toHaveAttribute('id', 'report-to');
    expect(screen.getByText(/Interval/)).toBeInTheDocument();
  });

  it('shows unassigned workload, canonical priority order, and canonical links', async () => {
    render(<ManagerDashboardPage />); await screen.findByText('Belum ditugaskan');
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Tugas berdasarkan prioritas' })).toBeInTheDocument();
    expect(screen.getByText('Mendesak')).toBeInTheDocument();
    const unassigned = new URL(screen.getByRole('link', { name: 'Lihat daftar tugas' }).getAttribute('href')!, 'https://floz.test');
    expect(Object.fromEntries(unassigned.searchParams)).toMatchObject({ sort: 'priority' });
    expect(new URL(screen.getByRole('link', { name: 'Lihat tugas mendesak' }).getAttribute('href')!, 'https://floz.test').searchParams.get('priority')).toBe('URGENT');
  });

  it('keeps dashboard and KPI loading/error states independent', async () => {
    let resolveDashboard!: (value: { data: Dashboard }) => void;
    vi.mocked(api.workspaces.dashboardManager).mockReturnValue(new Promise((resolve) => { resolveDashboard = resolve; }));
    vi.mocked(api.workspaces.kpis).mockRejectedValue(new Error('KPI unavailable'));
    render(<ManagerDashboardPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('KPI unavailable');
    expect(screen.getByRole('status', { name: 'Dashboard loading' })).toBeInTheDocument();
    resolveDashboard({ data: dashboard });
    expect(await screen.findByText('Belum ditugaskan')).toBeInTheDocument();
  });
});
