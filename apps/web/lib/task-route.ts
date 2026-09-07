export function taskRoute(
  workspaceId: string,
  taskId: string,
  options?: {
    edit_schedule?: boolean;
    calendarContext?: {
      view?: string;
      date?: string;
      team_id?: string;
      assignee_id?: string;
    };
  }
) {
  const params = new URLSearchParams();
  params.set('selected_task_id', taskId);
  if (options?.edit_schedule) {
    params.set('edit_schedule', '1');
  }
  if (options?.calendarContext) {
    if (options.calendarContext.view) params.set('cal_view', options.calendarContext.view);
    if (options.calendarContext.date) params.set('cal_date', options.calendarContext.date);
    if (options.calendarContext.team_id) params.set('cal_team_id', options.calendarContext.team_id);
    if (options.calendarContext.assignee_id) params.set('cal_assignee_id', options.calendarContext.assignee_id);
  }
  return `/workspaces/${workspaceId}/tasks?${params.toString()}`;
}

export function tasksRoute(workspaceId: string, params: Record<string, string>) {
  return `/workspaces/${workspaceId}/tasks?${new URLSearchParams(params)}`;
}

export function notificationRoute(
  workspaceId: string,
  entityId: string,
  contextRoute?: string,
  notificationType?: string,
  entityType?: string
) {
  if (contextRoute) return contextRoute;

  switch (notificationType) {
    case 'APPROVAL_REQUESTED':
      return `/workspaces/${workspaceId}/approvals?view=inbox&selected_approval_request_id=${entityId}`;
    case 'APPROVAL_APPROVED':
      return `/workspaces/${workspaceId}/approvals?view=sent&selected_approval_request_id=${entityId}`;
    case 'APPROVAL_REJECTED':
      return `/workspaces/${workspaceId}/approvals?view=sent&selected_approval_request_id=${entityId}`;
    case 'APPROVAL_CANCELLED':
      return `/workspaces/${workspaceId}/approvals?view=inbox&selected_approval_request_id=${entityId}`;
    case 'COMMENT_MENTIONED':
      return `/workspaces/${workspaceId}/tasks?selected_task_id=${entityId}`;
    default:
      if (entityType === 'APPROVAL_REQUEST') {
        return `/workspaces/${workspaceId}/approvals?selected_approval_request_id=${entityId}`;
      }
      return taskRoute(workspaceId, entityId);
  }
}
