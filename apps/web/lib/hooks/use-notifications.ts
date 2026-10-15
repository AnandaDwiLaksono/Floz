import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api-client';
import { NotificationResource } from '../../components/notification-item';

export function useUnreadCount(workspaceId: string | undefined) {
  const [unreadCount, updateUnreadCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const requestId = useRef(0);
  const [scope, setScope] = useState({ workspaceId });
  const activeScope = useRef<typeof scope | null>(null);

  // Reset before children render; an effect alone exposes the previous workspace.
  if (scope.workspaceId !== workspaceId) {
    setScope({ workspaceId });
    updateUnreadCount(0);
    setLoading(!!workspaceId);
    setError(null);
  }

  const setUnreadCount = useCallback((updater: number | ((prev: number) => number)) => {
    if (activeScope.current === scope) {
      requestId.current++;
      updateUnreadCount(updater);
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchUnreadCount = useCallback(async () => {
    if (activeScope.current !== scope) return;
    const id = ++requestId.current;
    if (!workspaceId) {
      if (isMountedRef.current) { setUnreadCount(0); setLoading(false); setError(null); }
      return;
    }
    setLoading(true);
    try {
      if (isMountedRef.current) setError(null);
      const res = await api.notifications.unreadCount(workspaceId);
      if (isMountedRef.current && id === requestId.current && activeScope.current === scope) updateUnreadCount(res.data.count);
    } catch (err: unknown) {
      if (isMountedRef.current && id === requestId.current) {
        const msg = err instanceof Error ? err.message : 'Failed to fetch unread count';
        setError(msg);
      }
    } finally {
      if (isMountedRef.current && id === requestId.current) setLoading(false);
    }
  }, [workspaceId, scope, setUnreadCount]);


  useEffect(() => {
    const request = requestId;
    const active = activeScope;
    active.current = scope;
    void fetchUnreadCount();

    // ~60 second polling interval when document is visible
    const intervalId = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchUnreadCount();
      }
    }, 60000);

    const handleFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchUnreadCount();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('visibilitychange', handleFocus);
      window.addEventListener('focus', handleFocus);
    }

    return () => {
      active.current = null;
      request.current++;
      clearInterval(intervalId);
      if (typeof window !== 'undefined') {
        window.removeEventListener('visibilitychange', handleFocus);
        window.removeEventListener('focus', handleFocus);
      }
    };
  }, [workspaceId, scope, fetchUnreadCount]);

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
  _onUnreadCountChange?: (updater: (prev: number) => number) => void,
  refreshUnreadCount?: () => Promise<void>
) {
  const [notifications, setNotifications] = useState<NotificationResource[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const requestId = useRef(0);
  const [scope, setScope] = useState({ workspaceId, filterRead });
  const activeScope = useRef<typeof scope | null>(null);
  const currentFetch = useRef<(() => Promise<void>) | null>(null);
  const currentRefreshUnreadCount = useRef(refreshUnreadCount);

  if (scope.workspaceId !== workspaceId || scope.filterRead !== filterRead) {
    setScope({ workspaceId, filterRead });
    setNotifications([]);
    setHasMore(false);
    setNextCursor(null);
    setLoading(!!workspaceId);
    setError(null);
  }

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchNotifications = useCallback(async () => {
    if (activeScope.current !== scope) return;
    const id = ++requestId.current;
    if (!workspaceId) {
      if (isMountedRef.current) {
        setNotifications([]);
        setHasMore(false);
        setNextCursor(null);
        setLoading(false);
        setError(null);
      }
      return;
    }

    if (isMountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      const readParam = filterRead === null ? undefined : !filterRead;
      const res = await api.notifications.list(workspaceId, {
        read: readParam,
        limit: 20,
      });

      if (isMountedRef.current && id === requestId.current) {
        setNotifications(res.data);
        setHasMore(res.meta.pagination.has_more);
        setNextCursor(res.meta.pagination.next_cursor);
      }
    } catch (err: unknown) {
      if (isMountedRef.current && id === requestId.current) {
        const msg = err instanceof Error ? err.message : 'Failed to fetch notifications';
        setError(msg);
      }
    } finally {
      if (isMountedRef.current && id === requestId.current) {
        setLoading(false);
      }
    }
  }, [workspaceId, filterRead, scope]);

  useEffect(() => {
    const request = requestId;
    const active = activeScope;
    active.current = scope;
    void fetchNotifications();
    return () => { active.current = null; request.current++; };
  }, [workspaceId, filterRead, scope, fetchNotifications]);

  useEffect(() => {
    currentFetch.current = fetchNotifications;
    currentRefreshUnreadCount.current = refreshUnreadCount;
  }, [workspaceId, filterRead, scope, fetchNotifications, refreshUnreadCount]);

  const loadMore = useCallback(async () => {
    if (activeScope.current !== scope || !workspaceId || !hasMore || !nextCursor || loading) return;
    const id = ++requestId.current;

    if (isMountedRef.current) setLoading(true);
    try {
      const readParam = filterRead === null ? undefined : !filterRead;
      const res = await api.notifications.list(workspaceId, {
        read: readParam,
        limit: 20,
        cursor: nextCursor,
      });

      if (isMountedRef.current && id === requestId.current) {
        setNotifications((prev) => [...prev, ...res.data]);
        setHasMore(res.meta.pagination.has_more);
        setNextCursor(res.meta.pagination.next_cursor);
      }
    } catch (err: unknown) {
      if (isMountedRef.current && id === requestId.current) {
        const msg = err instanceof Error ? err.message : 'Failed to load more notifications';
        setError(msg);
      }
    } finally {
      if (isMountedRef.current && id === requestId.current) {
        setLoading(false);
      }
    }
  }, [workspaceId, hasMore, nextCursor, loading, filterRead, scope]);

  const reconcileMutation = useCallback(async () => {
    if (!isMountedRef.current || activeScope.current?.workspaceId !== workspaceId || !workspaceId) return;
    // A late mutation may invalidate a newer visit; fetch anew, never apply its old response.
    await Promise.all([currentFetch.current?.(), currentRefreshUnreadCount.current?.()]);
  }, [workspaceId]);

  const markRead = useCallback(
    async (notificationId: string) => {
      if (activeScope.current !== scope || !workspaceId) return;

      try {
        await api.notifications.markRead(workspaceId, notificationId, true);
      } catch {
        // Keep server-confirmed state; refresh also handles uncertain failures.
      } finally {
        await reconcileMutation();
      }
    },
    [workspaceId, reconcileMutation, scope]
  );

  const markAllRead = useCallback(async () => {
    if (activeScope.current !== scope || !workspaceId) return;

    try {
      await api.notifications.markAllRead(workspaceId);
    } catch {
      // Keep server-confirmed state; refresh also handles uncertain failures.
    } finally {
      await reconcileMutation();
    }
  }, [workspaceId, reconcileMutation, scope]);

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
