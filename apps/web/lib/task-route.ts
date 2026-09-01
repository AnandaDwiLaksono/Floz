export function taskRoute(workspaceId: string, taskId: string) {
  return `/workspaces/${workspaceId}/tasks?selected_task_id=${taskId}`;
}
