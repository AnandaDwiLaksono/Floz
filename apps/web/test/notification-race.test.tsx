import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api-client';
import { useNotifications, useUnreadCount } from '../lib/hooks/use-notifications';

vi.mock('../lib/api-client', async (load) => {
  const actual = await load<typeof import('../lib/api-client')>();
  return { ...actual, api: { ...actual.api, notifications: { ...actual.api.notifications, unreadCount: vi.fn(), list: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn() } } };
});

const pending = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

beforeEach(() => vi.resetAllMocks());

it.each(['markRead', 'markAllRead'] as const)('refreshes the current workspace after a late %s completes across A-B-A', async (action) => {
  const mutation = pending<Awaited<ReturnType<typeof api.notifications.markRead>>>();
  let committed = false;
  vi.mocked(api.notifications.unreadCount).mockImplementation(async () => ({ data: { count: committed ? 6 : 7 } }));
  vi.mocked(api.notifications.list).mockImplementation(async () => ({ data: [{ id: 'notice', is_read: committed }] as never, meta: { pagination: { has_more: false, next_cursor: null, limit: 20 } } }));
  vi.mocked(api.notifications[action]).mockReturnValueOnce(mutation.promise as never);
  const { result, rerender } = renderHook(({ workspace }) => {
    const count = useUnreadCount(workspace);
    return { count, notices: useNotifications(workspace, null, count.setUnreadCount, count.refetch) };
  }, { initialProps: { workspace: 'a' } });
  await waitFor(() => expect(result.current.notices.notifications).toHaveLength(1));
  act(() => { void (action === 'markRead' ? result.current.notices.markRead('notice') : result.current.notices.markAllRead()); });
  rerender({ workspace: 'b' });
  await waitFor(() => expect(result.current.notices.loading).toBe(false));
  rerender({ workspace: 'a' });
  await waitFor(() => expect(result.current.notices.loading).toBe(false));
  committed = true;
  await act(async () => mutation.resolve({ data: {} } as never));
  await waitFor(() => expect(result.current.notices.notifications[0].is_read).toBe(true));
  expect(result.current.count.unreadCount).toBe(6);
});

it('recovers a failed mutation count after the list filter changes', async () => {
  const mutation = pending<Awaited<ReturnType<typeof api.notifications.markRead>>>();
  vi.mocked(api.notifications.unreadCount).mockResolvedValue({ data: { count: 7 } });
  vi.mocked(api.notifications.list).mockResolvedValue({ data: [{ id: 'notice', is_read: false }] as never, meta: { pagination: { has_more: false, next_cursor: null, limit: 20 } } });
  vi.mocked(api.notifications.markRead).mockReturnValueOnce(mutation.promise);
  const { result, rerender } = renderHook(({ filter }) => {
    const count = useUnreadCount('a');
    return { count, notices: useNotifications('a', filter, count.setUnreadCount, count.refetch) };
  }, { initialProps: { filter: false } });
  await waitFor(() => expect(result.current.count.unreadCount).toBe(7));
  act(() => { void result.current.notices.markRead('notice'); });
  rerender({ filter: true });
  await act(async () => mutation.reject(new Error('mark failed')));
  expect(result.current.count.unreadCount).toBe(7);
});

it.each(['markRead', 'markAllRead'] as const)('keeps server-confirmed state through a refresh while %s is pending', async (action) => {
  const mutation = pending<Awaited<ReturnType<typeof api.notifications.markRead>>>();
  vi.mocked(api.notifications.unreadCount).mockResolvedValue({ data: { count: 7 } });
  vi.mocked(api.notifications.list).mockResolvedValue({ data: [{ id: 'notice', is_read: false }] as never, meta: { pagination: { has_more: false, next_cursor: null, limit: 20 } } });
  vi.mocked(api.notifications[action]).mockReturnValueOnce(mutation.promise as never);
  const { result } = renderHook(() => {
    const count = useUnreadCount('a');
    return { count, notices: useNotifications('a', null, count.setUnreadCount, count.refetch) };
  });
  await waitFor(() => expect(result.current.count.unreadCount).toBe(7));
  act(() => { void (action === 'markRead' ? result.current.notices.markRead('notice') : result.current.notices.markAllRead()); });
  expect(result.current.count.unreadCount).toBe(7);
  expect(result.current.notices.notifications[0].is_read).toBe(false);
  await act(async () => { await result.current.notices.fetchNotifications(); await result.current.count.refetch(); });
  expect(result.current.count.unreadCount).toBe(7);
  expect(result.current.notices.notifications[0].is_read).toBe(false);
  await act(async () => mutation.reject(new Error('mark failed')));
  expect(result.current.count.unreadCount).toBe(7);
});

it('rejects pre-completion polling after successful mutation reconciliation', async () => {
  const polling = pending<Awaited<ReturnType<typeof api.notifications.unreadCount>>>();
  const mutation = pending<Awaited<ReturnType<typeof api.notifications.markRead>>>();
  vi.mocked(api.notifications.unreadCount).mockResolvedValueOnce({ data: { count: 7 } }).mockReturnValueOnce(polling.promise).mockResolvedValue({ data: { count: 6 } });
  vi.mocked(api.notifications.list).mockResolvedValue({ data: [{ id: 'notice', is_read: false }] as never, meta: { pagination: { has_more: false, next_cursor: null, limit: 20 } } });
  vi.mocked(api.notifications.markRead).mockReturnValueOnce(mutation.promise);
  const { result } = renderHook(() => {
    const count = useUnreadCount('a');
    return { count, notices: useNotifications('a', null, count.setUnreadCount, count.refetch) };
  });
  await waitFor(() => expect(result.current.count.unreadCount).toBe(7));
  act(() => { void result.current.count.refetch(); });
  act(() => { void result.current.notices.markRead('notice'); });
  await act(async () => mutation.resolve({ data: {} } as never));
  await act(async () => polling.resolve({ data: { count: 7 } }));
  expect(api.notifications.unreadCount).toHaveBeenCalledTimes(3);
  expect(result.current.count.unreadCount).toBe(6);
});

it('keeps unread count when markRead fails after a same-workspace refresh', async () => {
  const mutation = pending<Awaited<ReturnType<typeof api.notifications.markRead>>>();
  vi.mocked(api.notifications.unreadCount).mockResolvedValue({ data: { count: 7 } });
  vi.mocked(api.notifications.list).mockResolvedValue({ data: [{ id: 'notice', is_read: false }] as never, meta: { pagination: { has_more: false, next_cursor: null, limit: 20 } } });
  vi.mocked(api.notifications.markRead).mockReturnValueOnce(mutation.promise);
  const { result } = renderHook(() => {
    const count = useUnreadCount('a');
    return { count, notices: useNotifications('a', null, count.setUnreadCount, count.refetch) };
  });
  await waitFor(() => expect(result.current.count.unreadCount).toBe(7));
  act(() => { void result.current.notices.markRead('notice'); });
  expect(result.current.count.unreadCount).toBe(7);
  await act(async () => { await result.current.notices.fetchNotifications(); });
  await act(async () => mutation.reject(new Error('mark failed')));
  expect(result.current.count.unreadCount).toBe(7);
});

it('keeps the full unread count when markAllRead fails after a refresh', async () => {
  const mutation = pending<Awaited<ReturnType<typeof api.notifications.markAllRead>>>();
  vi.mocked(api.notifications.unreadCount).mockResolvedValue({ data: { count: 27 } });
  vi.mocked(api.notifications.list).mockResolvedValue({ data: [{ id: 'notice', is_read: false }] as never, meta: { pagination: { has_more: false, next_cursor: null, limit: 20 } } });
  vi.mocked(api.notifications.markAllRead).mockReturnValueOnce(mutation.promise);
  const { result } = renderHook(() => {
    const count = useUnreadCount('a');
    return { count, notices: useNotifications('a', null, count.setUnreadCount, count.refetch) };
  });
  await waitFor(() => expect(result.current.count.unreadCount).toBe(27));
  act(() => { void result.current.notices.markAllRead(); });
  expect(result.current.count.unreadCount).toBe(27);
  await act(async () => { await result.current.notices.fetchNotifications(); });
  await act(async () => mutation.reject(new Error('mark all failed')));
  await waitFor(() => expect(result.current.count.unreadCount).toBe(27));
});

it('reconciles concurrent mutations independently without premature read state', async () => {
  const first = pending<Awaited<ReturnType<typeof api.notifications.markRead>>>();
  const second = pending<Awaited<ReturnType<typeof api.notifications.markRead>>>();
  const read = new Set<string>();
  vi.mocked(api.notifications.unreadCount).mockImplementation(async () => ({ data: { count: 7 - read.size } }));
  vi.mocked(api.notifications.list).mockImplementation(async () => ({ data: ['first', 'second'].map((id) => ({ id, is_read: read.has(id) })) as never, meta: { pagination: { has_more: false, next_cursor: null, limit: 20 } } }));
  vi.mocked(api.notifications.markRead).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const { result } = renderHook(() => {
    const count = useUnreadCount('a');
    return { count, notices: useNotifications('a', null, count.setUnreadCount, count.refetch) };
  });
  await waitFor(() => expect(result.current.notices.notifications).toHaveLength(2));
  act(() => { void result.current.notices.markRead('first'); void result.current.notices.markRead('second'); });
  expect(result.current.count.unreadCount).toBe(7);
  read.add('first');
  await act(async () => first.resolve({ data: {} } as never));
  expect(result.current.count.unreadCount).toBe(6);
  expect(result.current.notices.notifications.map((n) => n.is_read)).toEqual([true, false]);
  read.add('second');
  await act(async () => second.resolve({ data: {} } as never));
  expect(result.current.count.unreadCount).toBe(5);
  expect(result.current.notices.notifications.map((n) => n.is_read)).toEqual([true, true]);
});

it('discards pending mutation recovery after leaving and returning to a workspace', async () => {
  const recovery = pending<Awaited<ReturnType<typeof api.notifications.unreadCount>>>();
  vi.mocked(api.notifications.unreadCount)
    .mockResolvedValueOnce({ data: { count: 7 } })
    .mockReturnValueOnce(recovery.promise)
    .mockResolvedValue({ data: { count: 2 } });
  vi.mocked(api.notifications.list).mockResolvedValue({ data: [{ id: 'notice', is_read: false }] as never, meta: { pagination: { has_more: false, next_cursor: null, limit: 20 } } });
  vi.mocked(api.notifications.markRead).mockRejectedValueOnce(new Error('mark failed'));
  const { result, rerender } = renderHook(({ workspace }) => {
    const count = useUnreadCount(workspace);
    return { count, notices: useNotifications(workspace, null, count.setUnreadCount, count.refetch) };
  }, { initialProps: { workspace: 'a' } });
  await waitFor(() => expect(result.current.count.unreadCount).toBe(7));
  act(() => { void result.current.notices.markRead('notice'); });
  await waitFor(() => expect(api.notifications.unreadCount).toHaveBeenCalledTimes(2));
  rerender({ workspace: 'b' });
  await waitFor(() => expect(result.current.count.unreadCount).toBe(2));
  rerender({ workspace: 'a' });
  await waitFor(() => expect(result.current.count.unreadCount).toBe(2));
  await act(async () => recovery.resolve({ data: { count: 99 } }));
  expect(result.current.count.unreadCount).toBe(2);
});

it('ignores unread response from workspace removed while request is pending', async () => {
  const old = pending<Awaited<ReturnType<typeof api.notifications.unreadCount>>>();
  vi.mocked(api.notifications.unreadCount).mockReturnValueOnce(old.promise);
  const { result, rerender } = renderHook(({ workspace }: { workspace?: string }) => useUnreadCount(workspace), { initialProps: { workspace: 'a' as string | undefined } });
  expect(api.notifications.unreadCount).toHaveBeenCalledWith('a');
  rerender({ workspace: undefined });
  await act(async () => old.resolve({ data: { count: 7 } }));
  expect(result.current.unreadCount).toBe(0);
  expect(result.current.loading).toBe(false);
});

it('settles unread loading after a focus refresh supersedes the initial request', async () => {
  const first = pending<Awaited<ReturnType<typeof api.notifications.unreadCount>>>();
  const second = pending<Awaited<ReturnType<typeof api.notifications.unreadCount>>>();
  vi.mocked(api.notifications.unreadCount).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const { result } = renderHook(() => useUnreadCount('a'));
  act(() => window.dispatchEvent(new Event('focus')));
  expect(api.notifications.unreadCount).toHaveBeenCalledTimes(2);
  await act(async () => second.resolve({ data: { count: 4 } }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => first.resolve({ data: { count: 1 } }));
  expect(result.current.unreadCount).toBe(4);
});

it('does not revive requests or setters after returning to the same workspace', async () => {
  const oldCount = pending<Awaited<ReturnType<typeof api.notifications.unreadCount>>>();
  const oldList = pending<Awaited<ReturnType<typeof api.notifications.list>>>();
  vi.mocked(api.notifications.unreadCount).mockReturnValueOnce(oldCount.promise).mockResolvedValue({ data: { count: 2 } });
  vi.mocked(api.notifications.list).mockReturnValueOnce(oldList.promise).mockResolvedValue({ data: [{ id: 'current' }] as never, meta: { pagination: { has_more: false, next_cursor: null, limit: 20 } } });
  const { result, rerender } = renderHook(({ workspace }) => ({ notices: useNotifications(workspace), count: useUnreadCount(workspace) }), { initialProps: { workspace: 'a' } });
  const oldUpdater = result.current.count.setUnreadCount;
  rerender({ workspace: 'b' });
  await waitFor(() => expect(result.current.count.unreadCount).toBe(2));
  rerender({ workspace: 'a' });
  await waitFor(() => expect(result.current.count.unreadCount).toBe(2));
  await act(async () => {
    oldCount.resolve({ data: { count: 99 } });
    oldList.resolve({ data: [{ id: 'stale' }] as never, meta: { pagination: { has_more: true, next_cursor: 'old', limit: 20 } } });
    oldUpdater(() => 99);
  });
  expect(result.current.count.unreadCount).toBe(2);
  expect(result.current.notices.notifications.map((notice) => notice.id)).toEqual(['current']);
  expect(result.current.notices.hasMore).toBe(false);
});

it('keeps newer notification filter after old request resolves', async () => {
  const old = pending<Awaited<ReturnType<typeof api.notifications.list>>>();
  vi.mocked(api.notifications.list).mockReturnValueOnce(old.promise).mockResolvedValueOnce({ data: [], meta: { pagination: { has_more: false, next_cursor: null, limit: 20 } } });
  const { result, rerender } = renderHook(({ filter }) => useNotifications('a', filter), { initialProps: { filter: false } });
  rerender({ filter: true });
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => old.resolve({ data: [{ id: 'stale' }] as never, meta: { pagination: { has_more: false, next_cursor: null, limit: 20 } } }));
  expect(result.current.notifications).toEqual([]);
});

it('discards pending load-more page after filter changes', async () => {
  const old = pending<Awaited<ReturnType<typeof api.notifications.list>>>();
  vi.mocked(api.notifications.list)
    .mockResolvedValueOnce({ data: [{ id: 'first' }] as never, meta: { pagination: { has_more: true, next_cursor: 'page-2', limit: 20 } } })
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce({ data: [{ id: 'filtered' }] as never, meta: { pagination: { has_more: false, next_cursor: null, limit: 20 } } });
  const { result, rerender } = renderHook(({ filter }) => useNotifications('a', filter), { initialProps: { filter: false } });
  await waitFor(() => expect(result.current.hasMore).toBe(true));
  act(() => { void result.current.loadMore(); });
  await waitFor(() => expect(api.notifications.list).toHaveBeenCalledTimes(2));
  rerender({ filter: true });
  await waitFor(() => expect(result.current.notifications.map((notice) => notice.id)).toEqual(['filtered']));
  await act(async () => old.resolve({ data: [{ id: 'stale-page' }] as never, meta: { pagination: { has_more: false, next_cursor: null, limit: 20 } } }));
  expect(result.current.notifications.map((notice) => notice.id)).toEqual(['filtered']);
  expect(result.current.loading).toBe(false);
});

it('clears resolved workspace state even when the next workspace requests fail', async () => {
  const nextList = pending<Awaited<ReturnType<typeof api.notifications.list>>>();
  const nextCount = pending<Awaited<ReturnType<typeof api.notifications.unreadCount>>>();
  vi.mocked(api.notifications.list)
    .mockResolvedValueOnce({ data: [{ id: 'a-only' }] as never, meta: { pagination: { has_more: true, next_cursor: 'a-cursor', limit: 20 } } })
    .mockReturnValueOnce(nextList.promise);
  vi.mocked(api.notifications.unreadCount).mockResolvedValueOnce({ data: { count: 7 } }).mockReturnValueOnce(nextCount.promise);
  const { result, rerender } = renderHook(({ workspace }) => ({ notices: useNotifications(workspace), count: useUnreadCount(workspace) }), { initialProps: { workspace: 'a' } });
  await waitFor(() => expect(result.current.count.unreadCount).toBe(7));
  const oldUpdater = result.current.count.setUnreadCount;
  rerender({ workspace: 'b' });
  expect(result.current.notices.notifications).toEqual([]);
  expect(result.current.notices.hasMore).toBe(false);
  expect(result.current.count.unreadCount).toBe(0);
  act(() => oldUpdater(() => 99));
  expect(result.current.count.unreadCount).toBe(0);
  await act(async () => { nextList.reject(new Error('b list failed')); nextCount.reject(new Error('b count failed')); });
  expect(result.current.notices.notifications).toEqual([]);
  expect(result.current.notices.error).toBe('b list failed');
  expect(result.current.count.unreadCount).toBe(0);
  expect(result.current.count.error).toBe('b count failed');
});

it('discards cross-workspace pagination, mutation rollbacks and retained actions', async () => {
  const oldPage = pending<Awaited<ReturnType<typeof api.notifications.list>>>();
  const oldMutation = pending<Awaited<ReturnType<typeof api.notifications.markAllRead>>>();
  const nextList = pending<Awaited<ReturnType<typeof api.notifications.list>>>();
  vi.mocked(api.notifications.list)
    .mockResolvedValueOnce({ data: [{ id: 'a-only', is_read: false }] as never, meta: { pagination: { has_more: true, next_cursor: 'a-cursor', limit: 20 } } })
    .mockReturnValueOnce(oldPage.promise)
    .mockReturnValueOnce(nextList.promise);
  vi.mocked(api.notifications.markAllRead).mockReturnValueOnce(oldMutation.promise);
  const changeCount = vi.fn();
  const { result, rerender } = renderHook(({ workspace }) => useNotifications(workspace, null, changeCount), { initialProps: { workspace: 'a' } });
  await waitFor(() => expect(result.current.hasMore).toBe(true));
  const oldActions = result.current;
  act(() => { void oldActions.loadMore(); void oldActions.markAllRead(); });
  rerender({ workspace: 'b' });
  expect(result.current.notifications).toEqual([]);
  await act(async () => nextList.resolve({ data: [{ id: 'b-only' }] as never, meta: { pagination: { has_more: false, next_cursor: null, limit: 20 } } }));
  await act(async () => {
    oldPage.resolve({ data: [{ id: 'a-page' }] as never, meta: { pagination: { has_more: true, next_cursor: 'a-next', limit: 20 } } });
    oldMutation.reject(new Error('a mutation failed'));
  });
  await act(async () => { await oldActions.fetchNotifications(); await oldActions.markRead('a-only'); });
  expect(result.current.notifications.map((notice) => notice.id)).toEqual(['b-only']);
  expect(result.current.hasMore).toBe(false);
  expect(result.current.loading).toBe(false);
  expect(api.notifications.list).toHaveBeenCalledTimes(3);
  expect(api.notifications.markRead).not.toHaveBeenCalled();
  expect(changeCount).not.toHaveBeenCalled();
});
