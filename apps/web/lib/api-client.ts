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

export interface RecurringTask {
  id: string;
  name: string;
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';
  interval_value: number;
  timezone: string;
  start_at: string;
  end_at: string | null;
  occurrence_limit: number | null;
  next_run_at: string | null;
  first_occurrence: Task;
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

export interface ApprovalStep {
  id: string;
  step_order: number;
  approver: { id: string; full_name: string };
  decided_by: { id: string; full_name: string } | null;
  status: string;
  decision: string | null;
  reason: string | null;
  decided_at: string | null;
}

export interface ApprovalRequestSummary {
  id: string;
  workspace_id: string;
  task_id: string | null;
  requester: { id: string; full_name: string };
  approver: { id: string; full_name: string };
  title: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  submitted_at: string;
  submitted_at_raw?: string;
  created_at: string;
}

export interface ApprovalRequestDetail {
  id: string;
  workspace_id: string;
  task_id: string | null;
  task: { id: string; task_key: string; title: string } | null;
  requester: { id: string; full_name: string };
  title: string;
  description: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  submitted_at: string;
  completed_at: string | null;
  cancelled_by: { id: string; full_name: string } | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
  step: ApprovalStep;
}

export interface CommentMention {
  user_id: string;
  full_name: string;
}

export interface Comment {
  id: string;
  workspace_id: string;
  task_id: string;
  author: { id: string; full_name: string };
  content: string;
  created_at: string;
  created_at_raw?: string;
  updated_at: string;
  deleted_at: string | null;
  mentions: CommentMention[];
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

export interface ReportingKpis { completion_rate: string; overdue_rate: string; on_time_completion_rate: string; average_completion_time_seconds: string; workload: number; denominators: { due: number; completed: number; overdue: number; onTime: number }; period: { from: string; to: string; evaluationAt: string }; filters: { deleted: 'NULL'; category: 'NOT_CANCELLED'; due: 'CURRENT_DUE_AT'; completion: 'CURRENT_COMPLETED_AT' }; }
export interface DashboardCount { key: string | null; count: number; }
export interface DashboardStatusCount extends DashboardCount { position: number; id: string; }
export interface DashboardAssigneeCount { userId: string | null; name: string | null; count: number; }
export interface MemberDashboard { kpis: ReportingKpis; workload_by_team: DashboardCount[]; workload_by_assignee: DashboardAssigneeCount[]; unassigned: number; pending_approvals?: number; drilldown_url?: string; status_breakdown: DashboardStatusCount[]; priority_breakdown: DashboardCount[]; }
export type Dashboard = MemberDashboard;
export interface MyWorkTask { id: string; taskKey: string; title: string; dueAt: string; priority: string; }
export interface MyWorkSummary { today: MyWorkTask[]; upcoming: MyWorkTask[]; overdue: MyWorkTask[]; counts: { today: number; upcoming: number; overdue: number }; }

export interface Team {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  manager_user_id: string | null;
  isActive: boolean;
}

export interface TaskComment {
  id: string;
  workspace_id: string;
  task_id: string;
  author: { id: string; full_name: string };
  content: string;
  created_at: string;
  updated_at: string;
  mentions: { user_id: string; full_name: string }[];
}

export interface WorkspaceMember {
  user_id: string;
  full_name: string;
  email: string;
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
    updateProfile: (body: { full_name?: string; timezone?: string; locale?: string; avatar_url?: string | null }) => apiFetch<{ data: CurrentUser }>('/me', { method: 'PATCH', body: JSON.stringify(body) }),
    changePassword: (body: { current_password: string; new_password: string }) => apiFetch<void>('/me/password', { method: 'PATCH', body: JSON.stringify(body) }),
  },
  workspaces: {
    myWork: (workspaceId: string, date: string) => apiFetch<{ data: MyWorkSummary; meta: { date: string; timezone: string } }>(`/workspaces/${workspaceId}/my-work?date=${encodeURIComponent(date)}`),
    dashboardMember: (workspaceId: string) => apiFetch<{ data: Dashboard }>(`/workspaces/${workspaceId}/dashboard/member`),
    dashboardManager: (workspaceId: string, params: { from: string; to: string; team_id?: string }) => apiFetch<{ data: Dashboard }>(`/workspaces/${workspaceId}/dashboard/manager?${new URLSearchParams(params)}`),
    kpis: (workspaceId: string, params: { from: string; to: string; team_id?: string; assignee_id?: string }) => apiFetch<{ data: ReportingKpis }>(`/workspaces/${workspaceId}/reports/kpis?${new URLSearchParams(params)}`),
    list: () => apiFetch<{ data: WorkspaceMembershipInfo[] }>('/workspaces'),
    get: (workspaceId: string) =>
      apiFetch<{ data: { id: string; name: string; slug: string; timezone: string } }>(
        `/workspaces/${workspaceId}`
      ),
    update: (workspaceId: string, body: { name?: string; timezone?: string }) => apiFetch<{ data: { id: string; name: string; slug: string; timezone: string } }>(`/workspaces/${workspaceId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    members: (workspaceId: string) =>
      apiFetch<{ data: WorkspaceMember[] }>(`/workspaces/${workspaceId}/members`),
    lookupUser: (workspaceId: string, email: string) =>
      apiFetch<{ data: User }>(`/workspaces/${workspaceId}/users?email=${encodeURIComponent(email)}`),
    provisionAccount: (workspaceId: string, body: { email: string; full_name: string }) => apiFetch<{ data: { user: User; temporary_password: string } }>(`/workspaces/${workspaceId}/accounts`, { method: 'POST', body: JSON.stringify(body) }),
    addMember: (workspaceId: string, body: { user_id: string; role: string; status?: string }) => apiFetch<{ data: WorkspaceMember }>(`/workspaces/${workspaceId}/members`, { method: 'POST', body: JSON.stringify(body) }),
    patchMember: (workspaceId: string, userId: string, body: { role?: string; status?: string }) => apiFetch<{ data: WorkspaceMember }>(`/workspaces/${workspaceId}/members/${userId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    teams: (workspaceId: string) =>
      apiFetch<{ data: Team[] }>(`/workspaces/${workspaceId}/teams`),
    updateTeam: (workspaceId: string, teamId: string, body: { name?: string; description?: string | null; manager_user_id?: string | null; is_active?: boolean }) => apiFetch<{ data: Team }>(`/workspaces/${workspaceId}/teams/${teamId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    createTeam: (workspaceId: string, body: { name: string; description?: string; manager_user_id?: string | null }) => apiFetch<{ data: Team }>(`/workspaces/${workspaceId}/teams`, { method: 'POST', body: JSON.stringify(body) }),
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
    createRecurring: (workspaceId: string, input: {
      name: string;
      frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
      interval_value: number;
      timezone: string;
      start_at: string;
      end_at?: string;
      occurrence_limit?: number;
      title: string;
      description?: string | null;
      workflow_id?: string;
      status_id?: string;
      priority?: string;
      team_id?: string | null;
      assignee_ids?: string[];
      primary_assignee_id?: string | null;
      due_time?: string | null;
    }, idempotencyKey: string) =>
      apiFetch<{ data: RecurringTask }>(`/workspaces/${workspaceId}/recurring-tasks`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(input),
      }),
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
  approvals: {
    list: (
      workspaceId: string,
      params: { view?: 'inbox' | 'sent' | 'managed' | 'all'; status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'; team_id?: string; limit?: number; cursor?: string } = {}
    ) => {
      const searchParams = new URLSearchParams();
      if (params.view) searchParams.set('view', params.view);
      if (params.status) searchParams.set('status', params.status);
      if (params.team_id) searchParams.set('team_id', params.team_id);
      if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
      if (params.cursor) searchParams.set('cursor', params.cursor);
      const query = searchParams.toString();
      return apiFetch<PaginatedList<ApprovalRequestSummary>>(`/workspaces/${workspaceId}/approval-requests${query ? `?${query}` : ''}`);
    },
    get: (workspaceId: string, approvalRequestId: string) =>
      apiFetch<{ data: ApprovalRequestDetail }>(`/workspaces/${workspaceId}/approval-requests/${approvalRequestId}`),
    create: (
      workspaceId: string,
      body: { title: string; description?: string | null; task_id?: string | null; approver_user_id: string }
    ) =>
      apiFetch<{ data: ApprovalRequestDetail }>(`/workspaces/${workspaceId}/approval-requests`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    approve: (workspaceId: string, approvalRequestId: string, stepId: string, body?: { reason?: string | null }) =>
      apiFetch<{ data: ApprovalRequestDetail }>(
        `/workspaces/${workspaceId}/approval-requests/${approvalRequestId}/steps/${stepId}/approve`,
        {
          method: 'POST',
          body: JSON.stringify(body || {}),
        }
      ),
    reject: (workspaceId: string, approvalRequestId: string, stepId: string, body: { reason: string }) =>
      apiFetch<{ data: ApprovalRequestDetail }>(
        `/workspaces/${workspaceId}/approval-requests/${approvalRequestId}/steps/${stepId}/reject`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        }
      ),
    cancel: (workspaceId: string, approvalRequestId: string, body?: { reason?: string | null }) =>
      apiFetch<{ data: ApprovalRequestDetail }>(
        `/workspaces/${workspaceId}/approval-requests/${approvalRequestId}/cancel`,
        {
          method: 'POST',
          body: JSON.stringify(body || {}),
        }
      ),
  },
  comments: {
    list: (
      workspaceId: string,
      taskId: string,
      params: { limit?: number; cursor?: string } = {}
    ) => {
      const searchParams = new URLSearchParams();
      if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
      if (params.cursor) searchParams.set('cursor', params.cursor);
      const query = searchParams.toString();
      return apiFetch<PaginatedList<TaskComment>>(
        `/workspaces/${workspaceId}/tasks/${taskId}/comments${query ? `?${query}` : ''}`
      );
    },
    create: (
      workspaceId: string,
      taskId: string,
      body: { content: string; mentioned_user_ids?: string[] }
    ) =>
      apiFetch<{ data: TaskComment }>(
        `/workspaces/${workspaceId}/tasks/${taskId}/comments`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        }
      ),
    delete: (workspaceId: string, taskId: string, commentId: string) =>
      apiFetch<void>(
        `/workspaces/${workspaceId}/tasks/${taskId}/comments/${commentId}`,
        {
          method: 'DELETE',
        }
      ),
  },
  notifications: {
    unreadCount: (workspaceId: string) =>
      apiFetch<{ data: { count: number } }>(`/workspaces/${workspaceId}/notifications/unread-count`),
    list: (
      workspaceId: string,
      params: { read?: boolean; limit?: number; cursor?: string } = {}
    ) => {
      const searchParams = new URLSearchParams();
      if (params.read !== undefined) searchParams.set('read', String(params.read));
      if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
      if (params.cursor) searchParams.set('cursor', params.cursor);
      const query = searchParams.toString();
      return apiFetch<PaginatedList<import('../components/notification-item').NotificationResource>>(
        `/workspaces/${workspaceId}/notifications${query ? `?${query}` : ''}`
      );
    },
    markRead: (workspaceId: string, notificationId: string, isRead = true) =>
      apiFetch<{ data: import('../components/notification-item').NotificationResource }>(
        `/workspaces/${workspaceId}/notifications/${notificationId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ is_read: isRead }),
        }
      ),
    markAllRead: (workspaceId: string) =>
      apiFetch<{ data: { updated_count: number } }>(
        `/workspaces/${workspaceId}/notifications/mark-all-read`,
        {
          method: 'POST',
        }
      ),
  },
};
