import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { getCalendarLabelInstant } from '../lib/calendar-time';

const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
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
  status: { id: 'st-1', code: 'OPEN', name: 'Open', category: 'UNSTARTED' },
  is_deadline_only: false,
  start_at: '2026-08-18T09:00:00.000Z',
  due_at: '2026-08-18T10:00:00.000Z',
  primary_assignee: { id: 'user-1', full_name: 'Admin User' },
};

const sampleTaskDetail: Task = {
  id: 'task-1',
  workspace_id: 'workspace-1',
  task_key: 'TASK-1',
  title: 'Inspect pump',
  description: 'Regular maintenance',
  priority: 'HIGH',
  status_id: 'st-1',
  status: { id: 'st-1', code: 'OPEN', name: 'Open', category: 'UNSTARTED', is_terminal: false },
  version: 2,
  creator_id: 'user-1',
  workflow_id: 'wf-1',
  team_id: null,
  start_at: '2026-08-18T09:00:00.000Z',
  due_at: '2026-08-18T10:00:00.000Z',
  completed_at: null,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  is_overdue: false,
  assignees: [{ user_id: 'user-1', full_name: 'Admin User', is_primary: true }],
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
      data: [{ user_id: 'user-1', full_name: 'Admin User', email: 'admin@example.com', role: 'ADMIN', status: 'ACTIVE', user: { id: 'user-1', full_name: 'Admin User', email: 'admin@example.com' } }],
    });
    vi.mocked(api.workspaces.workflows).mockResolvedValue({
      data: [{ id: 'wf-1', name: 'Default', team_id: null, is_active: true, is_default: true, statuses: [{ id: 'st-1', code: 'OPEN', name: 'Open', category: 'UNSTARTED', is_terminal: false }] }],
    });
    vi.mocked(api.tasks.calendar).mockResolvedValue({ data: [sampleCalendarTask], meta: { from: '2026-08-18', to: '2026-08-25' } });
    vi.mocked(api.tasks.list).mockResolvedValue({
      data: [sampleTaskDetail],
      meta: { pagination: { limit: 10, has_more: false, next_cursor: null } },
    });
    vi.mocked(api.tasks.get).mockResolvedValue({ data: sampleTaskDetail });
    vi.mocked(api.tasks.availableTransitions).mockResolvedValue({ data: [] });
  });

  it('keeps the shell as the only main landmark', async () => {
    render(<main><CalendarPage /></main>);
    await screen.findByRole('heading', { name: 'Kalender' });
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('keeps newest period response when older calendar request finishes last', async () => {
    const old = deferred<Awaited<ReturnType<typeof api.tasks.calendar>>>();
    vi.mocked(api.tasks.calendar).mockImplementation((_workspace, range) => range.from.startsWith('2026-08-18') ? old.promise : Promise.resolve({ data: [{ ...sampleCalendarTask, title: 'New period', start_at: '2026-08-19T09:00:00.000Z', due_at: '2026-08-19T10:00:00.000Z' }], meta: { from: '2026-08-19', to: '2026-08-20' } }));
    mockSearchParams = new URLSearchParams('view=day&date=2026-08-18');
    const page = render(<CalendarPage />);
    await waitFor(() => expect(api.tasks.calendar).toHaveBeenCalledTimes(1));
    mockSearchParams = new URLSearchParams('view=day&date=2026-08-19');
    page.rerender(<CalendarPage />);
    expect(await screen.findByRole('button', { name: 'New period' })).toBeInTheDocument();
    await act(async () => old.resolve({ data: [sampleCalendarTask], meta: { from: '2026-08-18', to: '2026-08-19' } }));
    expect(screen.getByRole('button', { name: 'New period' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Inspect pump' })).not.toBeInTheDocument();
  });

  it.each(['UTC', 'Asia/Jakarta', 'Pacific/Auckland', 'Pacific/Kiritimati'])('aligns month and day labels with create date in %s', async (timezone) => {
    vi.mocked(api.workspaces.get).mockResolvedValue({ data: { id: 'workspace-1', name: 'Field Ops', slug: 'field-ops', timezone } });
    vi.mocked(api.tasks.calendar).mockResolvedValue({ data: [], meta: { from: '2026-08-01', to: '2026-09-01' } });
    mockSearchParams = new URLSearchParams('view=month&date=2026-08-31');
    const page = render(<CalendarPage />);
    const section = await screen.findAllByRole('region', { name: /Senin, 31 Agustus/ });
    expect(section.length).toBeGreaterThan(0);
    expect(within(section[0]).getByText('31')).toBeInTheDocument();
    fireEvent.click(within(section[0]).getByRole('button', { name: 'Buat tugas pada 2026-08-31' }));
    expect(push).toHaveBeenCalledWith(expect.stringContaining('prefill_start_at=2026-08-31T09%3A00'));
    mockSearchParams = new URLSearchParams('view=day&date=2026-08-31');
    page.rerender(<CalendarPage />);
    expect(await screen.findByText(/Senin, 31 Agustus 2026/)).toBeInTheDocument();
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(getCalendarLabelInstant('2026-08-31', timezone))).filter((part) => part.type === 'year' || part.type === 'month' || part.type === 'day').map((part) => part.value).join('-')).toBe('2026-08-31');
  });

  it('preserves return_to when opening Task Detail from calendar', async () => {
    mockSearchParams = new URLSearchParams('view=week&date=2026-08-18&team_id=team-1&assignee_id=user-1');
    render(<CalendarPage />);
    await waitFor(() => expect(api.tasks.calendar).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect pump' }));

    const target = vi.mocked(push).mock.calls.at(-1)?.[0] as string;
    expect(target).toContain('return_to=');
    expect(target).toContain('calendar');
  });

  it('preserves calendar context on card click without edit_schedule', async () => {
    mockSearchParams = new URLSearchParams('view=week&date=2026-08-18&team_id=team-1&assignee_id=user-1');
    render(<CalendarPage />);
    await waitFor(() => expect(api.tasks.calendar).toHaveBeenCalled());

    const taskBtn = await screen.findByRole('button', { name: /^Inspect pump$/ });
    fireEvent.click(taskBtn);

    expect(push).toHaveBeenCalledWith(expect.stringContaining('selected_task_id=task-1'));
    expect(push).toHaveBeenCalledWith(expect.stringContaining('cal_view=week'));
    expect(push).toHaveBeenCalledWith(expect.stringContaining('cal_date=2026-08-18'));
    const lastCall = vi.mocked(push).mock.calls[vi.mocked(push).mock.calls.length - 1][0] as string;
    expect(lastCall).not.toContain('edit_schedule=1');
  });

  it('preserves calendar context and navigates to edit_schedule flow via Reschedule button', async () => {
    mockSearchParams = new URLSearchParams('view=week&date=2026-08-18&team_id=team-1&assignee_id=user-1');
    render(<CalendarPage />);
    await waitFor(() => expect(api.tasks.calendar).toHaveBeenCalled());

    const rescheduleBtn = await screen.findByRole('button', { name: /Ubah jadwal Inspect pump/ });
    fireEvent.click(rescheduleBtn);

    expect(push).toHaveBeenCalledWith(expect.stringContaining('selected_task_id=task-1'));
    expect(push).toHaveBeenCalledWith(expect.stringContaining('edit_schedule=1'));
    expect(push).toHaveBeenCalledWith(expect.stringContaining('cal_view=week'));
    expect(push).toHaveBeenCalledWith(expect.stringContaining('cal_date=2026-08-18'));
  });

  it('opens edit schedule mode directly in tasks page when edit_schedule=1 is present', async () => {
    mockSearchParams = new URLSearchParams('selected_task_id=task-1&edit_schedule=1&cal_view=week&cal_date=2026-08-18');
    render(<TasksPage />);

    await waitFor(() => expect(api.tasks.get).toHaveBeenCalledWith('workspace-1', 'task-1'));

    expect(await screen.findByRole('heading', { name: /(Edit|Ubah) tugas/i })).toBeInTheDocument();
    const startInput = screen.getByLabelText(/Mulai/i) as HTMLInputElement;
    const dueInput = screen.getByLabelText(/Tenggat/i) as HTMLInputElement;

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

    const dueInput = screen.getByLabelText(/Tenggat/i);
    fireEvent.change(dueInput, { target: { value: '2026-08-19T10:00' } });

    const saveBtn = screen.getByRole('button', { name: /Simpan perubahan/i });
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

    const returnBtn = await screen.findByRole('button', { name: /Kembali ke kalender/i });
    expect(returnBtn).toBeInTheDocument();

    fireEvent.click(returnBtn);
    expect(push).toHaveBeenCalledWith('/workspaces/workspace-1/calendar?view=week&date=2026-08-18');
  });

  it('renders Indonesian calendar navigation, period heading, and filters', async () => {
    mockSearchParams = new URLSearchParams('view=week&date=2026-08-18');
    vi.mocked(api.tasks.calendar).mockResolvedValue({ data: [], meta: { from: '2026-08-16', to: '2026-08-23' } });

    render(<CalendarPage />);

    expect(await screen.findByRole('heading', { name: 'Kalender' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hari ini' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Periode sebelumnya' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Periode berikutnya' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tampilan minggu' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Tampilan bulan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tampilan hari' })).toBeInTheDocument();
    expect(screen.getByLabelText('Filter tim')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter penanggung jawab')).toBeInTheDocument();
    expect(screen.getByText('17 Agu - 23 Agu 2026')).toBeInTheDocument();
  });

  it('shows deadline-only tasks as Tenggat without a fabricated start time', async () => {
    mockSearchParams = new URLSearchParams('view=day&date=2026-08-18');
    vi.mocked(api.tasks.calendar).mockResolvedValue({
      data: [{ ...sampleCalendarTask, is_deadline_only: true, start_at: null, due_at: '2026-08-18T10:00:00.000Z' }],
      meta: { from: '2026-08-18', to: '2026-08-19' },
    });

    render(<CalendarPage />);

    expect(await screen.findByRole('button', { name: 'Inspect pump' })).toBeInTheDocument();
    expect(screen.getByText('Tenggat')).toBeInTheDocument();
    expect(screen.queryByText(/09\.00|10\.00/)).not.toBeInTheDocument();
  });

  it('creates a task with workspace-timezone prefill and calendar return context', async () => {
    mockSearchParams = new URLSearchParams('view=day&date=2026-08-18&team_id=team-1&assignee_id=user-1');
    render(<CalendarPage />);
    await waitFor(() => expect(api.tasks.calendar).toHaveBeenCalled());

    fireEvent.click(await screen.findByRole('button', { name: 'Buat tugas pada 2026-08-18' }));

    const target = vi.mocked(push).mock.calls.at(-1)?.[0] as string;
    expect(target).toContain('/workspaces/workspace-1/tasks?');
    expect(target).toContain('create=1');
    expect(target).toContain('prefill_start_at=2026-08-18T09%3A00');
    expect(target).toContain('prefill_due_at=2026-08-18T10%3A00');
    expect(target).toContain('prefill_timezone=UTC');
    expect(target).toContain('return_to=');
    expect(target).toContain('cal_view=day');
    expect(target).toContain('cal_date=2026-08-18');
    expect(target).toContain('cal_team_id=team-1');
    expect(target).toContain('cal_assignee_id=user-1');
  });

  it('shows localized empty and request error states without hiding navigation', async () => {
    mockSearchParams = new URLSearchParams('view=month&date=2026-08-18&team_id=team-1');
    vi.mocked(api.tasks.calendar).mockResolvedValue({ data: [], meta: { from: '2026-08-01', to: '2026-09-01' } });
    render(<CalendarPage />);

    expect(await screen.findByText('Tidak ada tugas yang sesuai filter.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hari ini' })).toBeInTheDocument();

    vi.mocked(api.tasks.calendar).mockRejectedValueOnce(new Error('network failed'));
    mockSearchParams = new URLSearchParams('view=month&date=2026-08-19');
    render(<CalendarPage />);
    expect(await screen.findByText('Kalender belum dapat dimuat.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
  });

  it('handles version conflict 409 when saving rescheduled task', async () => {
    mockSearchParams = new URLSearchParams('selected_task_id=task-1&edit_schedule=1&cal_view=month&cal_date=2026-08-01');
    vi.mocked(api.tasks.update).mockRejectedValue(new ApiError(409, 'VERSION_CONFLICT', 'Task was modified by another user'));

    render(<TasksPage />);
    await waitFor(() => expect(api.tasks.get).toHaveBeenCalledWith('workspace-1', 'task-1'));

    const saveBtn = screen.getByRole('button', { name: /Simpan perubahan/i });
    fireEvent.click(saveBtn);

    expect(await screen.findByText(/Versi tugas berubah/i)).toBeInTheDocument();
  });

  it('rejects start_at > due_at schedule input before or at submission', async () => {
    mockSearchParams = new URLSearchParams('selected_task_id=task-1&edit_schedule=1&cal_view=month&cal_date=2026-08-01');

    render(<TasksPage />);
    await waitFor(() => expect(api.tasks.get).toHaveBeenCalledWith('workspace-1', 'task-1'));

    const startInput = screen.getByLabelText(/Mulai/i);
    const dueInput = screen.getByLabelText(/Tenggat/i);

    fireEvent.change(startInput, { target: { value: '2026-08-20T10:00' } });
    fireEvent.change(dueInput, { target: { value: '2026-08-18T10:00' } });

    const saveBtn = screen.getByRole('button', { name: /Simpan perubahan/i });
    fireEvent.click(saveBtn);

    expect(await screen.findByText(/Waktu mulai harus sebelum atau sama dengan tenggat/i)).toBeInTheDocument();
    expect(api.tasks.update).not.toHaveBeenCalled();
  });

  it('renders real 7-weekday month grid headers and quiet create affordance', async () => {
    mockSearchParams = new URLSearchParams('view=month&date=2026-09-01');
    vi.mocked(api.tasks.calendar).mockResolvedValue({
      data: [
        {
          id: 'task-month-1',
          task_key: 'FLZ-M1',
          title: 'Tugas bulan September',
          priority: 'MEDIUM',
          start_at: '2026-09-01T09:00:00.000Z',
          due_at: '2026-09-01T11:00:00.000Z',
          is_deadline_only: false,
          status: { id: 'todo', code: 'TODO', name: 'Belum dimulai' },
          primary_assignee: null,
        },
      ],
      meta: { from: '2026-09-01', to: '2026-10-01' },
    });

    render(<CalendarPage />);
    expect((await screen.findAllByRole('button', { name: /^Tugas bulan September$/ })).length).toBeGreaterThan(0);

    // Weekday headers
    expect(screen.getByText('Sen')).toBeInTheDocument();
    expect(screen.getByText('Sel')).toBeInTheDocument();
    expect(screen.getByText('Rab')).toBeInTheDocument();
    expect(screen.getByText('Kam')).toBeInTheDocument();
    expect(screen.getByText('Jum')).toBeInTheDocument();
    expect(screen.getByText('Sab')).toBeInTheDocument();
    expect(screen.getByText('Min')).toBeInTheDocument();

    // Quiet create button with accessible label
    expect(screen.getAllByRole('button', { name: 'Buat tugas pada 2026-09-01' }).length).toBeGreaterThan(0);

    // No repetitive "Jadwal" reschedule button taking title width in Month view
    expect(screen.queryByRole('button', { name: /Ubah jadwal Tugas bulan September/ })).not.toBeInTheDocument();
  });
});
