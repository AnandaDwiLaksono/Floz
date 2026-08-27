export interface ApiErrorResponse {
  code?: string;
  message?: string;
  details?: Record<string, unknown> | unknown[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message || code);
    this.name = 'ApiError';
  }
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  timezone: string;
  locale: string;
  is_active: boolean;
}

export interface WorkspaceMembershipInfo {
  id: string;
  name: string;
  role: 'ADMIN' | 'MANAGER' | 'MEMBER' | 'FIELD_WORKER';
  membership_status: string;
  slug?: string;
  timezone?: string;
}

export interface CurrentUser extends User {
  workspaces: WorkspaceMembershipInfo[];
}

export interface TaskAssignee {
  user_id: string;
  is_primary: boolean;
  full_name: string;
}

export interface TaskStatus {
  id: string;
  code: string;
  name: string;
  category: string;
  is_initial?: boolean;
  is_terminal?: boolean;
}

export interface Task {
  id: string;
  workspace_id: string;
  task_key: string;
  title: string;
  description: string | null;
  workflow_id: string;
  status_id: string;
  status: TaskStatus;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  team_id: string | null;
  creator_id: string;
  start_at: string | null;
  due_at: string | null;
  completed_at: string | null;
  is_overdue?: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  assignees: TaskAssignee[];
}

export interface TaskHistoryItem {
  id: string;
  task_id: string;
  actor_user_id: string;
  event_type: string;
  from_status_id?: string | null;
  to_status_id?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Workflow {
  id: string;
  name: string;
  team_id: string | null;
  is_default: boolean;
  is_active: boolean;
  statuses: TaskStatus[];
}

export interface KanbanCardSummary {
  id: string;
  task_key: string;
  title: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  due_at: string | null;
  is_overdue?: boolean;
  assignees: TaskAssignee[];
  status: TaskStatus;
  version: number;
  workflow_id: string;
  team_id: string | null;
  creator_id: string;
}

export interface KanbanBoard {
  workflow: Workflow;
  columns: Array<{ status: TaskStatus; task_count: number; cards: KanbanCardSummary[] }>;
}

export interface CalendarTaskSummary {
  id: string;
  task_key: string;
  title: string;
  status: { id: string; name: string; code?: string; category?: string };
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  start_at: string | null;
  due_at: string | null;
  is_deadline_only: boolean;
  primary_assignee: { id: string; full_name: string } | null;
}

export interface CalendarTaskList {
  data: CalendarTaskSummary[];
  meta: { from: string; to: string };
}

export interface Team {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  manager_user_id: string | null;
  is_active: boolean;
}

export interface WorkspaceMember {
  user_id: string;
  role: string;
  status: string;
  user?: {
    id: string;
    email: string;
    full_name: string;
  };
}

export interface PaginatedList<T> {
  data: T[];
  meta: {
    pagination: {
      limit: number;
      next_cursor: string | null;
      has_more: boolean;
    };
  };
}

const getApiBaseUrl = () => {
  if (typeof window !== 'undefined') {
    return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  }
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
};

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/api/v1${path.startsWith('/') ? path : `/${path}`}`;

  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }

  const errObj = (body?.error as Record<string, unknown>) || undefined;
  if (!response.ok) {
    const code = String(errObj?.code || body?.code || errObj?.message || body?.message || response.statusText);
    const message = String(errObj?.message || body?.message || errObj?.code || body?.code || 'An error occurred');
    throw new ApiError(response.status, code, message, errObj?.details || body?.details);
  }

  return body as T;
}

export const api = {
  auth: {
    login: (body: { email?: string; password?: string }) =>
      apiFetch<{ data: { user: User } }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    logout: () =>
      apiFetch<void>('/auth/logout', {
        method: 'POST',
      }),
    me: () => apiFetch<{ data: CurrentUser }>('/me'),
  },
  workspaces: {
    list: () => apiFetch<{ data: WorkspaceMembershipInfo[] }>('/workspaces'),
    get: (workspaceId: string) =>
      apiFetch<{ data: { id: string; name: string; slug: string; timezone: string } }>(
        `/workspaces/${workspaceId}`
      ),
    members: (workspaceId: string) =>
      apiFetch<{ data: WorkspaceMember[] }>(`/workspaces/${workspaceId}/members`),
    teams: (workspaceId: string) =>
      apiFetch<{ data: Team[] }>(`/workspaces/${workspaceId}/teams`),
    workflows: (workspaceId: string) =>
      apiFetch<{ data: Workflow[] }>(`/workspaces/${workspaceId}/workflows`),
  },
  tasks: {
    list: (workspaceId: string, params: Record<string, string | number | undefined> = {}) => {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, val]) => {
        if (val !== undefined && val !== '') {
          searchParams.set(key, String(val));
        }
      });
      const query = searchParams.toString();
      return apiFetch<PaginatedList<Task>>(
        `/workspaces/${workspaceId}/tasks${query ? `?${query}` : ''}`
      );
    },
    get: (workspaceId: string, taskId: string) =>
      apiFetch<{ data: Task }>(`/workspaces/${workspaceId}/tasks/${taskId}`),
    create: (
      workspaceId: string,
      body: {
        title: string;
        description?: string | null;
        priority?: string;
        workflow_id?: string;
        status_id?: string;
        team_id?: string | null;
        start_at?: string | null;
        due_at?: string | null;
        assignees?: { user_id: string; is_primary?: boolean }[];
      }
    ) =>
      apiFetch<{ data: Task }>(`/workspaces/${workspaceId}/tasks`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (
      workspaceId: string,
      taskId: string,
      body: {
        version: number;
        title?: string;
        description?: string | null;
        priority?: string;
        start_at?: string | null;
        due_at?: string | null;
      }
    ) =>
      apiFetch<{ data: Task }>(`/workspaces/${workspaceId}/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    assign: (
      workspaceId: string,
      taskId: string,
      body: {
        version: number;
        assignees: { user_id: string; is_primary?: boolean }[];
      }
    ) =>
      apiFetch<{ data: Task }>(`/workspaces/${workspaceId}/tasks/${taskId}/assignments`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    delete: (workspaceId: string, taskId: string, version: number) =>
      apiFetch<void>(`/workspaces/${workspaceId}/tasks/${taskId}?version=${version}`, {
        method: 'DELETE',
      }),
    availableTransitions: (workspaceId: string, taskId: string) =>
      apiFetch<{ data: { to_status_id: string; code: string; name: string }[] }>(
        `/workspaces/${workspaceId}/tasks/${taskId}/available-transitions`
      ),
    transition: (
      workspaceId: string,
      taskId: string,
      body: {
        version: number;
        to_status_id: string;
      }
    ) =>
      apiFetch<{ task: Task; transition: { to_status_id: string } }>(
        `/workspaces/${workspaceId}/tasks/${taskId}/transitions`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        }
      ),
    history: (workspaceId: string, taskId: string) =>
      apiFetch<{ data: TaskHistoryItem[] }>(`/workspaces/${workspaceId}/tasks/${taskId}/history`),
    kanban: (workspaceId: string, params: Record<string, string | undefined> = {}) => {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, val]) => { if (val) searchParams.set(key, val); });
      const query = searchParams.toString();
      return apiFetch<{ data: KanbanBoard }>(`/workspaces/${workspaceId}/kanban${query ? `?${query}` : ''}`);
    },
    calendar: (workspaceId: string, params: { from: string; to: string; team_id?: string; assignee_id?: string }) => {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, val]) => {
        if (val !== undefined && val !== '') searchParams.set(key, String(val));
      });
      return apiFetch<CalendarTaskList>(`/workspaces/${workspaceId}/calendar/tasks?${searchParams.toString()}`);
    }
  },
};
