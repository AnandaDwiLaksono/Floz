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
  filterRead?: boolean | null;
  onFilterReadChange?: (filter: boolean | null) => void;
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
  filterRead: externalFilterRead,
  onFilterReadChange,
  error,
  onRetry,
}: NotificationCenterProps) {
  const [internalFilterRead, setInternalFilterRead] = useState<boolean | null>(null);

  const filterRead = externalFilterRead !== undefined ? externalFilterRead : internalFilterRead;
  const setFilterRead = (val: boolean | null) => {
    if (onFilterReadChange) {
      onFilterReadChange(val);
    } else {
      setInternalFilterRead(val);
    }
  };

  const filtered = notifications.filter((n) => {
    if (filterRead === null) return true;
    return filterRead ? !n.is_read : n.is_read;
  });

  return (
    <div id="notification-panel" role="region" aria-label="Notifikasi" className="flex max-h-[min(480px,calc(100dvh-5rem))] w-full flex-col overflow-hidden rounded-lg border border-border bg-surface-raised shadow-xl">
      <div className="flex items-center justify-between border-b border-border bg-surface-subtle p-3">
        <div><h2 className="text-sm font-semibold">Notifikasi</h2><p className="text-xs text-muted-foreground">{unreadCount} belum dibaca</p></div>
        <button
          onClick={onMarkAllRead}
          disabled={unreadCount === 0}
          className="text-xs text-primary hover:text-primary-hover disabled:text-muted-foreground disabled:cursor-not-allowed font-medium"
        >
          Tandai semua dibaca
        </button>
      </div>

      <div className="flex border-b border-border text-xs">
        <button
          onClick={() => setFilterRead(null)}
          className={`flex-1 py-2 text-center font-medium border-b-2 transition ${
            filterRead === null
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
Semua
        </button>
        <button
          onClick={() => setFilterRead(true)}
          className={`flex-1 py-2 text-center font-medium border-b-2 transition ${
            filterRead === true
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Belum dibaca ({unreadCount})
        </button>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-border min-h-[150px]">
        {error && (
          <div className="p-4 text-center">
            <p className="text-xs text-danger">{error}</p>
            {onRetry && (
              <button
                onClick={onRetry}
                className="mt-2 text-xs text-primary hover:underline font-medium"
              >
Coba lagi
              </button>
            )}
          </div>
        )}

        {loading && notifications.length === 0 && (
          <div className="p-3 space-y-3 animate-pulse" aria-label="Memuat notifikasi">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3 items-center">
                <div className="h-5 w-5 rounded-full bg-muted flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-2/3 bg-muted rounded" />
                  <div className="h-2.5 w-4/5 bg-surface-subtle rounded" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="p-8 text-center text-xs text-muted-foreground">
            {filterRead === true ? 'Tidak ada notifikasi belum dibaca' : 'Kotak masuk kosong'}
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
          <div className="p-2 border-t border-border flex justify-center">
            <button
              onClick={onLoadMore}
              disabled={loading}
              className="flex min-h-11 items-center gap-1 px-3 py-1 text-xs font-medium text-primary hover:text-primary-hover disabled:text-muted-foreground"
            >
              {loading && <Loader2 className="h-3 w-3 animate-spin" />}
              Muat lebih banyak
            </button>
          </div>
        )}
      </div>
    </div>
  );
}