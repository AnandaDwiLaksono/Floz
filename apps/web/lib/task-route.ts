export function taskRoute(workspaceId: string, taskId: string) {
  return `/workspaces/${workspaceId}/tasks?selected_task_id=${taskId}`;
}

export function tasksRoute(workspaceId: string, params: Record<string, string>) {
  return `/workspaces/${workspaceId}/tasks?${new URLSearchParams(params)}`;
}

export function notificationRoute(workspaceId: string, taskId: string, contextRoute?: string) {
  return contextRoute || taskRoute(workspaceId, taskId);
}
