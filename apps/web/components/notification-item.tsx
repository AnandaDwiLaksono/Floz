import React from 'react';
import { User, Clock, CheckCircle2, MessageSquare } from 'lucide-react';

export interface NotificationResource {
  id: string;
  type: 'TASK_ASSIGNED' | 'TASK_DUE_SOON' | 'TASK_OVERDUE' | string;
  title: string;
  body: string;
  entity_type: string;
  entity_id: string;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  context?: { route?: string };
}

interface NotificationItemProps {
  notification: NotificationResource;
  onSelect: (notification: NotificationResource) => void;
}

// ponytail: Native Intl.RelativeTimeFormat helper
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.round((date.getTime() - now.getTime()) / 1000);

  const rtf = new Intl.RelativeTimeFormat('id', { numeric: 'auto' });

  const cutoffs = [
    { unit: 'year', seconds: 31536000 },
    { unit: 'month', seconds: 2592000 },
    { unit: 'day', seconds: 86400 },
    { unit: 'hour', seconds: 3600 },
    { unit: 'minute', seconds: 60 },
  ] as const;

  for (const { unit, seconds } of cutoffs) {
    if (Math.abs(diffInSeconds) >= seconds || unit === 'minute') {
      const delta = Math.round(diffInSeconds / seconds);
      return rtf.format(delta, unit);
    }
  }

  return 'baru saja';
}

export function NotificationItem({ notification, onSelect }: NotificationItemProps) {
  const getIcon = () => {
    switch (notification.type) {
      case 'APPROVAL_REQUESTED':
      case 'APPROVAL_APPROVED':
      case 'APPROVAL_REJECTED':
      case 'APPROVAL_CANCELLED':
        return CheckCircle2;
      case 'COMMENT_MENTIONED':
        return MessageSquare;
      case 'TASK_ASSIGNED':
        return User;
      default:
        return Clock;
    }
  };
  const Icon = getIcon();
  const relativeTime = formatRelativeTime(notification.created_at);

  return (
    <button
      onClick={() => onSelect(notification)}
      className={`flex w-full gap-3 p-3 text-left transition hover:bg-surface-subtle ${
              !notification.is_read ? 'bg-info/10' : ''
            }`}
    >
      <div className="mt-1 flex-shrink-0">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm truncate ${!notification.is_read ? 'font-bold' : 'font-medium'}`}>
          {notification.title}
          {!notification.is_read && <span className="sr-only">Belum dibaca</span>}
        </p>
        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
          {notification.body}
        </p>
        <time dateTime={notification.created_at} className="mt-1 block text-xs text-muted-foreground">
          {relativeTime}
        </time>
      </div>
    </button>
  );
}