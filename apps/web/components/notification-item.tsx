import { User, Clock } from 'lucide-react';

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

export function NotificationItem({ notification, onSelect }: NotificationItemProps) {
  const Icon = notification.type === 'TASK_ASSIGNED' ? User : Clock;

  // ponytail: Use standard Date logic instead of date-fns for simpler relative time to avoid extra dependencies if not already heavily used.
  const dateStr = new Date(notification.created_at).toLocaleDateString();

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
          {dateStr}
        </time>
      </div>
    </button>
  );
}