import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import MyWorkPage from '../app/workspaces/[workspaceId]/my-work/page';
import { api, MyWorkTask } from '../lib/api-client';

let workspaceId = 'a';
vi.mock('next/navigation', () => ({ useParams: () => ({ workspaceId }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('../lib/api-client', async (load) => {
  const actual = await load<typeof import('../lib/api-client')>();
  return { ...actual, api: { ...actual.api, workspaces: { ...actual.api.workspaces, get: vi.fn(), myWork: vi.fn() }, tasks: { ...actual.api.tasks, get: vi.fn(), availableTransitions: vi.fn(), transition: vi.fn() } } };
});
const pending = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
const task: MyWorkTask = { id: 'task-1', taskKey: 'A-1', title: 'Task A', dueAt: '2026-08-31T23:00:00Z', priority: 'HIGH', status: { id: 'open', code: 'OPEN', name: 'Open', category: 'UNSTARTED', is_active: true } };
const summary = (title: string, timezone: string) => ({ data: { today: [{ ...task, title }], upcoming: [], overdue: [], counts: { today: 1, upcoming: 0, overdue: 0 } }, meta: { date: '2026-09-01', timezone } });
beforeEach(() => { vi.clearAllMocks(); workspaceId = 'a'; });

it('ignores previous workspace summary, shows due date in workspace timezone', async () => {
  const old = pending<Awaited<ReturnType<typeof api.workspaces.myWork>>>();
  vi.mocked(api.workspaces.get).mockImplementation(async (id) => ({ data: { id, name: id, slug: id, timezone: 'Pacific/Kiritimati' } }));
  vi.mocked(api.workspaces.myWork).mockReturnValueOnce(old.promise).mockResolvedValueOnce(summary('New workspace', 'Pacific/Kiritimati'));
  const page = render(<MyWorkPage />);
  await waitFor(() => expect(api.workspaces.myWork).toHaveBeenCalledTimes(1));
  workspaceId = 'b';
  page.rerender(<MyWorkPage />);
  expect(await screen.findByText('New workspace')).toBeInTheDocument();
  expect(screen.getByText(/Tenggat · 1 Sep 2026/)).toBeInTheDocument();
  await act(async () => old.resolve(summary('Old workspace', 'Pacific/Kiritimati')));
  expect(screen.queryByText('Old workspace')).not.toBeInTheDocument();
});

it('never commits previous workspace tasks under the new route while its load is pending', async () => {
  const next = pending<Awaited<ReturnType<typeof api.workspaces.get>>>();
  vi.mocked(api.workspaces.get).mockImplementation((id) => id === 'a' ? Promise.resolve({ data: { id, name: id, slug: id, timezone: 'UTC' } }) : next.promise);
  vi.mocked(api.workspaces.myWork).mockImplementation(async (id) => summary(id === 'a' ? 'Old workspace' : 'New workspace', 'UTC'));
  const committed: string[] = [];
  function Route() {
    React.useLayoutEffect(() => { if (workspaceId === 'b') committed.push(document.body.textContent || ''); });
    return <MyWorkPage />;
  }
  const page = render(<Route />);
  await screen.findByRole('button', { name: 'Old workspace' });
  workspaceId = 'b';
  page.rerender(<Route />);
  expect(committed.length).toBeGreaterThan(0);
  expect(committed.every((text) => !text.includes('Old workspace'))).toBe(true);
  expect(screen.getByRole('status', { name: 'Memuat Pekerjaan Saya' })).toBeInTheDocument();
  await act(async () => next.resolve({ data: { id: 'b', name: 'b', slug: 'b', timezone: 'UTC' } }));
  expect(await screen.findByRole('button', { name: 'New workspace' })).toBeInTheDocument();
});

it('ignores old quick-status detail after selecting another task', async () => {
  vi.mocked(api.workspaces.get).mockResolvedValue({ data: { id: 'a', name: 'A', slug: 'a', timezone: 'UTC' } });
  vi.mocked(api.workspaces.myWork).mockResolvedValue({ ...summary('First task', 'UTC'), data: { ...summary('First task', 'UTC').data, today: [{ ...task, title: 'First task' }, { ...task, id: 'task-2', taskKey: 'A-2', title: 'Second task' }] } });
  const old = pending<Awaited<ReturnType<typeof api.tasks.get>>>();
  vi.mocked(api.tasks.get).mockReturnValueOnce(old.promise).mockResolvedValueOnce({ data: { id: 'task-2', version: 2 } as never });
  vi.mocked(api.tasks.availableTransitions).mockResolvedValue({ data: [{ to_status_id: 'done', code: 'DONE', name: 'Done' }] });
  render(<MyWorkPage />);
  const first = await screen.findByRole('button', { name: 'First task' });
  fireEvent.click(within(first.closest('li')!).getByRole('button', { name: 'Ubah status A-1' }));
  fireEvent.click(within(screen.getByRole('button', { name: 'Second task' }).closest('li')!).getByRole('button', { name: 'Ubah status A-2' }));
  await waitFor(() => expect(api.tasks.get).toHaveBeenCalledTimes(2));
  await act(async () => old.resolve({ data: { id: 'task-1', version: 1 } as never }));
  expect(within(screen.getByRole('button', { name: 'Second task' }).closest('li')!).getByRole('button', { name: 'Ke Selesai' })).toBeInTheDocument();
});

it('refreshes the summary after a successful transition even if the panel was closed', async () => {
  vi.mocked(api.workspaces.get).mockResolvedValue({ data: { id: 'a', name: 'A', slug: 'a', timezone: 'UTC' } });
  vi.mocked(api.workspaces.myWork).mockResolvedValueOnce(summary('Before transition', 'UTC')).mockResolvedValueOnce(summary('After transition', 'UTC'));
  vi.mocked(api.tasks.get).mockResolvedValue({ data: { id: 'task-1', version: 1 } as never });
  vi.mocked(api.tasks.availableTransitions).mockResolvedValue({ data: [{ to_status_id: 'done', code: 'DONE', name: 'Done' }] });
  const transition = pending<Awaited<ReturnType<typeof api.tasks.transition>>>();
  vi.mocked(api.tasks.transition).mockReturnValue(transition.promise);
  render(<MyWorkPage />);
  const before = await screen.findByRole('button', { name: 'Before transition' });
  fireEvent.click(within(before.closest('li')!).getByRole('button', { name: 'Ubah status A-1' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Ke Selesai' }));
  await waitFor(() => expect(api.tasks.transition).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Ubah status A-1' }));
  await act(async () => transition.resolve({} as Awaited<ReturnType<typeof api.tasks.transition>>));
  expect(await screen.findByRole('button', { name: 'After transition' })).toBeInTheDocument();
  expect(api.workspaces.myWork).toHaveBeenCalledTimes(2);
});

it('refreshes after selecting another detail without replacing the selected panel', async () => {
  vi.mocked(api.workspaces.get).mockResolvedValue({ data: { id: 'a', name: 'A', slug: 'a', timezone: 'UTC' } });
  const first = { ...task, title: 'First task' };
  const second = { ...task, id: 'task-2', taskKey: 'A-2', title: 'Second task' };
  const list = (title: string) => ({ ...summary(title, 'UTC'), data: { ...summary(title, 'UTC').data, today: [{ ...first, title }, second] } });
  vi.mocked(api.workspaces.myWork).mockResolvedValueOnce(list('First task')).mockResolvedValueOnce(list('Updated task'));
  vi.mocked(api.tasks.get).mockImplementation(async (_, id) => ({ data: { id, version: 1 } as never }));
  vi.mocked(api.tasks.availableTransitions).mockResolvedValue({ data: [{ to_status_id: 'done', code: 'DONE', name: 'Done' }] });
  const transition = pending<Awaited<ReturnType<typeof api.tasks.transition>>>();
  vi.mocked(api.tasks.transition).mockReturnValue(transition.promise);
  render(<MyWorkPage />);
  const button = await screen.findByRole('button', { name: 'First task' });
  fireEvent.click(within(button.closest('li')!).getByRole('button', { name: 'Ubah status A-1' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Ke Selesai' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ubah status A-2' }));
  await waitFor(() => expect(api.tasks.get).toHaveBeenCalledTimes(2));
  await act(async () => transition.resolve({} as Awaited<ReturnType<typeof api.tasks.transition>>));
  expect(await screen.findByRole('button', { name: 'Updated task' })).toBeInTheDocument();
  expect(within(screen.getByRole('button', { name: 'Second task' }).closest('li')!).getByRole('button', { name: 'Ke Selesai' })).toBeInTheDocument();
});

it('ignores an old transition and its old load when the workspace changes', async () => {
  vi.mocked(api.workspaces.get).mockImplementation(async (id) => ({ data: { id, name: id, slug: id, timezone: 'UTC' } }));
  vi.mocked(api.workspaces.myWork).mockImplementation(async (id) => summary(id === 'a' ? 'Old workspace' : 'New workspace', 'UTC'));
  vi.mocked(api.tasks.get).mockResolvedValue({ data: { id: 'task-1', version: 1 } as never });
  vi.mocked(api.tasks.availableTransitions).mockResolvedValue({ data: [{ to_status_id: 'done', code: 'DONE', name: 'Done' }] });
  const transition = pending<Awaited<ReturnType<typeof api.tasks.transition>>>();
  vi.mocked(api.tasks.transition).mockReturnValue(transition.promise);
  const page = render(<MyWorkPage />);
  const old = await screen.findByRole('button', { name: 'Old workspace' });
  fireEvent.click(within(old.closest('li')!).getByRole('button', { name: 'Ubah status A-1' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Ke Selesai' }));
  workspaceId = 'b';
  page.rerender(<MyWorkPage />);
  expect(await screen.findByRole('button', { name: 'New workspace' })).toBeInTheDocument();
  await act(async () => transition.resolve({} as Awaited<ReturnType<typeof api.tasks.transition>>));
  expect(api.workspaces.get).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('button', { name: 'Ke Selesai' })).not.toBeInTheDocument();
});
