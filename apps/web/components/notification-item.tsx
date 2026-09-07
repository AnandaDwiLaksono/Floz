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

  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

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

  return 'just now';
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
      className={`w-full text-left p-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition flex gap-3 ${
        !notification.is_read ? 'bg-blue-50/50 dark:bg-blue-900/20' : ''
      }`}
    >
      <div className="mt-1 flex-shrink-0">
        <Icon className="h-5 w-5 text-gray-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm truncate ${!notification.is_read ? 'font-bold' : 'font-medium'}`}>
          {notification.title}
          {!notification.is_read && <span className="sr-only">Unread</span>}
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 mt-0.5">
          {notification.body}
        </p>
        <time dateTime={notification.created_at} className="text-xs text-gray-400 mt-1 block">
          {relativeTime}
        </time>
      </div>
    </button>
  );
}