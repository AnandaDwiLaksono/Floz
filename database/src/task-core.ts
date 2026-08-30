import type { TransactionSql } from 'postgres';

export type TaskTemplateReferences = { workflow_id: string; status_id: string };
export type TaskCreationInput = { title?: string; description?: string | null; priority?: string; workflow_id?: string; status_id?: string; team_id?: string | null; start_at?: string | null; due_at?: string | null; recurrence_rule_id?: string | null };
export type TaskAssigneeInput = { user_id: string; is_primary?: boolean };

export async function validateTaskTemplateReferences(sql: TransactionSql, workspaceId: string, input: TaskCreationInput): Promise<TaskTemplateReferences> {
  const workflow = (await sql<{ workflow_id: string; status_id: string }[]>`SELECT w.id AS workflow_id,s.id AS status_id FROM workflows w JOIN task_statuses s ON s.workflow_id=w.id AND s.is_initial WHERE w.workspace_id=${workspaceId} AND w.id=COALESCE(${input.workflow_id ?? null},(SELECT id FROM workflows WHERE workspace_id=${workspaceId} AND is_default AND is_active LIMIT 1)) AND w.is_active LIMIT 1`)[0];
  if (!workflow) throw new Error('WORKFLOW_SCOPE_MISMATCH');
  if (input.status_id && !(await sql`SELECT id FROM task_statuses WHERE id=${input.status_id} AND workflow_id=${workflow.workflow_id}`)[0]) throw new Error('STATUS_SCOPE_MISMATCH');
  if (input.team_id && !(await sql`SELECT id FROM teams WHERE id=${input.team_id} AND workspace_id=${workspaceId}`)[0]) throw new Error('TEAM_SCOPE_MISMATCH');
  return workflow;
}

export async function createTaskRecordTx(sql: TransactionSql, workspaceId: string, actorId: string, input: TaskCreationInput, workflow: TaskTemplateReferences) {
  await sql`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
  const key = (await sql<{ key: string }[]>`SELECT 'TASK-' || (COUNT(*) + 1)::text AS key FROM tasks WHERE workspace_id=${workspaceId}`)[0];
  if (!key || !input.title?.trim()) throw new Error('VALIDATION_ERROR');
  const task = (await sql<{ id: string }[]>`INSERT INTO tasks(workspace_id,task_key,title,description,workflow_id,status_id,priority,team_id,creator_id,recurrence_rule_id,start_at,due_at) VALUES(${workspaceId},${key.key},${input.title.trim()},${input.description ?? null},${workflow.workflow_id},${input.status_id ?? workflow.status_id},${input.priority ?? 'MEDIUM'},${input.team_id ?? null},${actorId},${input.recurrence_rule_id ?? null},${input.start_at ?? null},${input.due_at ?? null}) RETURNING id`)[0];
  return { id: task.id, taskKey: key.key };
}

export async function createTaskAssigneesTx(sql: TransactionSql, workspaceId: string, taskId: string, actorId: string, assignees: TaskAssigneeInput[]) {
  if (assignees.filter((a) => a.is_primary).length > 1) throw new Error('VALIDATION_ERROR');
  for (const assignee of assignees) if (!(await sql<{ user_id: string }[]>`SELECT user_id FROM workspace_memberships WHERE workspace_id=${workspaceId} AND user_id=${assignee.user_id} AND status='ACTIVE'`)[0]) throw new Error('CROSS_WORKSPACE_REFERENCE');
  for (const assignee of assignees) await sql`INSERT INTO task_assignees(task_id,user_id,is_primary,assigned_by) VALUES(${taskId},${assignee.user_id},${assignee.is_primary ?? false},${actorId})`;
}

export async function writeTaskHistoryTx(sql: TransactionSql, taskId: string, actorId: string, metadata: Record<string, unknown> = {}) {
  await sql`INSERT INTO task_history(task_id,actor_user_id,event_type,metadata) VALUES(${taskId},${actorId},'CREATED',${JSON.stringify(metadata)}::jsonb)`;
}
