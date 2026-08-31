import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api-client';
import { NotificationResource } from '../../components/notification-item';

export function useUnreadCount(workspaceId: string | undefined) {
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUnreadCount = useCallback(async () => {
    if (!workspaceId) {
      setUnreadCount(0);
      return;
    }
    try {
      setError(null);
      const res = await api.notifications.unreadCount(workspaceId);
      setUnreadCount(res.data.count);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch unread count';
      setError(msg);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      setUnreadCount(0);
      return;
    }

    setLoading(true);
    fetchUnreadCount().finally(() => setLoading(false));

    // ~60 second polling interval when document is visible
    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchUnreadCount();
      }
    }, 60000);

    const handleFocus = () => {
      if (document.visibilityState === 'visible') {
        fetchUnreadCount();
      }
    };

    window.addEventListener('visibilitychange', handleFocus);
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('visibilitychange', handleFocus);
      window.removeEventListener('focus', handleFocus);
    };
  }, [workspaceId, fetchUnreadCount]);

  return {
    unreadCount,
    setUnreadCount,
    loading,
    error,
    refetch: fetchUnreadCount,
  };
}

export function useNotifications(
  workspaceId: string | undefined,
  filterRead: boolean | null = null,
  onUnreadCountChange?: (updater: (prev: number) => number) => void
) {
  const [notifications, setNotifications] = useState<NotificationResource[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filterReadRef = useRef(filterRead);
  filterReadRef.current = filterRead;

  const fetchNotifications = useCallback(async () => {
    if (!workspaceId) {
      setNotifications([]);
      setHasMore(false);
      setNextCursor(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const readParam = filterReadRef.current === null ? undefined : !filterReadRef.current;
      const res = await api.notifications.list(workspaceId, {
        read: readParam,
        limit: 20,
      });

      setNotifications(res.data);
      setHasMore(res.meta.pagination.has_more);
      setNextCursor(res.meta.pagination.next_cursor);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch notifications';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchNotifications();
  }, [workspaceId, filterRead, fetchNotifications]);

  const loadMore = useCallback(async () => {
    if (!workspaceId || !hasMore || !nextCursor || loading) return;

    setLoading(true);
    try {
      const readParam = filterReadRef.current === null ? undefined : !filterReadRef.current;
      const res = await api.notifications.list(workspaceId, {
        read: readParam,
        limit: 20,
        cursor: nextCursor,
      });

      setNotifications((prev) => [...prev, ...res.data]);
      setHasMore(res.meta.pagination.has_more);
      setNextCursor(res.meta.pagination.next_cursor);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load more notifications';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, hasMore, nextCursor, loading]);

  const markRead = useCallback(
    async (notificationId: string) => {
      if (!workspaceId) return;

      const target = notifications.find((n) => n.id === notificationId);
      const wasUnread = target && !target.is_read;

      // Optimistic update
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, is_read: true, read_at: new Date().toISOString() } : n))
      );

      if (wasUnread && onUnreadCountChange) {
        onUnreadCountChange((prev) => Math.max(0, prev - 1));
      }

      try {
        await api.notifications.markRead(workspaceId, notificationId, true);
      } catch {
        // Revert on error
        fetchNotifications();
        if (wasUnread && onUnreadCountChange) {
          onUnreadCountChange((prev) => prev + 1);
        }
      }
    },
    [workspaceId, notifications, fetchNotifications, onUnreadCountChange]
  );

  const markAllRead = useCallback(async () => {
    if (!workspaceId) return;

    const previousNotifications = notifications;

    // Optimistic update
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, is_read: true, read_at: n.read_at || new Date().toISOString() }))
    );

    if (onUnreadCountChange) {
      onUnreadCountChange(() => 0);
    }

    try {
      await api.notifications.markAllRead(workspaceId);
    } catch {
      // Revert on error
      setNotifications(previousNotifications);
      fetchNotifications();
    }
  }, [workspaceId, notifications, fetchNotifications, onUnreadCountChange]);

  return {
    notifications,
    loading,
    hasMore,
    error,
    fetchNotifications,
    loadMore,
    markRead,
    markAllRead,
  };
}
