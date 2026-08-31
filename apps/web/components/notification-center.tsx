import React, { useState } from 'react';
import { NotificationResource, NotificationItem } from './notification-item';
import { Loader2 } from 'lucide-react';

interface NotificationCenterProps {
  notifications: NotificationResource[];
  loading: boolean;
  hasMore: boolean;
  unreadCount: number;
  onSelect: (notification: NotificationResource) => void;
  onMarkAllRead: () => void;
  onLoadMore: () => void;
  error?: string | null;
  onRetry?: () => void;
}

export function NotificationCenter({
  notifications,
  loading,
  hasMore,
  unreadCount,
  onSelect,
  onMarkAllRead,
  onLoadMore,
  error,
  onRetry,
}: NotificationCenterProps) {
  const [filterRead, setFilterRead] = useState<boolean | null>(null);

  const filtered = notifications.filter((n) => {
    if (filterRead === null) return true;
    return filterRead ? !n.is_read : n.is_read;
  });

  return (
    <div className="w-80 max-h-[480px] flex flex-col bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-xl overflow-hidden">
      <div className="p-3 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-gray-800/50">
        <h2 className="text-sm font-semibold">Notifications</h2>
        <button
          onClick={onMarkAllRead}
          disabled={unreadCount === 0}
          className="text-xs text-blue-600 hover:text-blue-500 disabled:text-gray-400 disabled:cursor-not-allowed font-medium"
        >
          Mark all as read
        </button>
      </div>

      <div className="flex border-b border-gray-200 dark:border-gray-800 text-xs">
        <button
          onClick={() => setFilterRead(null)}
          className={`flex-1 py-2 text-center font-medium border-b-2 transition ${
            filterRead === null
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          All
        </button>
        <button
          onClick={() => setFilterRead(true)}
          className={`flex-1 py-2 text-center font-medium border-b-2 transition ${
            filterRead === true
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Unread ({unreadCount})
        </button>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800 min-h-[150px]">
        {error && (
          <div className="p-4 text-center">
            <p className="text-xs text-red-500">{error}</p>
            {onRetry && (
              <button
                onClick={onRetry}
                className="mt-2 text-xs text-blue-600 hover:underline font-medium"
              >
                Retry
              </button>
            )}
          </div>
        )}

        {loading && notifications.length === 0 && (
          <div className="p-4 flex flex-col items-center justify-center space-y-2 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-xs">Loading notifications...</span>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="p-8 text-center text-xs text-gray-400">
            {filterRead === true ? 'No unread notifications' : 'Inbox is empty'}
          </div>
        )}

        {filtered.map((notification) => (
          <NotificationItem
            key={notification.id}
            notification={notification}
            onSelect={onSelect}
          />
        ))}

        {hasMore && (
          <div className="p-2 border-t border-gray-100 dark:border-gray-800 flex justify-center">
            <button
              onClick={onLoadMore}
              disabled={loading}
              className="text-xs text-blue-600 hover:text-blue-500 disabled:text-gray-400 font-medium py-1 px-3 flex items-center gap-1"
            >
              {loading && <Loader2 className="h-3 w-3 animate-spin" />}
              Load more
            </button>
          </div>
        )}
      </div>
    </div>
  );
}