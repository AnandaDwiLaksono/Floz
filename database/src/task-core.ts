import { randomUUID } from 'node:crypto';
import type { TransactionSql } from 'postgres';
import { insertOutboxEvent } from './outbox.js';

export type TaskTemplateReferences = { workflow_id: string; status_id: string };
export type TaskCreationInput = { title?: string; description?: string | null; priority?: string; workflow_id?: string; status_id?: string; team_id?: string | null; start_at?: string | null; due_at?: string | null; recurrence_rule_id?: string | null };
export type TaskAssigneeInput = { user_id: string; is_primary?: boolean };
export type TaskPatchInput = { title?: string; description?: string | null; priority?: string; start_at?: string | null; due_at?: string | null; version: number };
export type TaskAssignPatchInput = { version: number; assignees: TaskAssigneeInput[] };

export async function validateTaskTemplateReferences(sql: TransactionSql, workspaceId: string, input: TaskCreationInput): Promise<TaskTemplateReferences> {
  if (input.team_id) {
    const team = (await sql<{ id: string }[]>`SELECT id FROM teams WHERE id=${input.team_id} AND workspace_id=${workspaceId}`)[0];
    if (!team) throw new Error('TEAM_SCOPE_MISMATCH');
  }

  let workflowId: string | undefined;

  if (input.workflow_id) {
    const wf = (await sql<{ id: string; team_id: string | null; is_active: boolean }[]>`SELECT id, team_id, is_active FROM workflows WHERE id=${input.workflow_id} AND workspace_id=${workspaceId}`)[0];
    if (!wf || !wf.is_active) {
      throw new Error('WORKFLOW_SCOPE_MISMATCH');
    }

    if (input.team_id) {
      if (wf.team_id && wf.team_id !== input.team_id) {
        throw new Error('WORKFLOW_SCOPE_MISMATCH');
      }
    } else {
      if (wf.team_id !== null) {
        throw new Error('WORKFLOW_SCOPE_MISMATCH');
      }
    }
    workflowId = wf.id;
  } else {
    if (input.team_id) {
      const teamDefault = (await sql<{ id: string }[]>`SELECT id FROM workflows WHERE workspace_id=${workspaceId} AND team_id=${input.team_id} AND is_default AND is_active LIMIT 1`)[0];
      if (teamDefault) {
        workflowId = teamDefault.id;
      } else {
        const wsDefault = (await sql<{ id: string }[]>`SELECT id FROM workflows WHERE workspace_id=${workspaceId} AND team_id IS NULL AND is_default AND is_active LIMIT 1`)[0];
        if (wsDefault) {
          workflowId = wsDefault.id;
        }
      }
    } else {
      const wsDefault = (await sql<{ id: string }[]>`SELECT id FROM workflows WHERE workspace_id=${workspaceId} AND team_id IS NULL AND is_default AND is_active LIMIT 1`)[0];
      if (wsDefault) {
        workflowId = wsDefault.id;
      }
    }

    if (!workflowId) {
      throw new Error('WORKFLOW_SCOPE_MISMATCH');
    }
  }

  const initialStatus = (await sql<{ id: string }[]>`SELECT id FROM task_statuses WHERE workflow_id=${workflowId} AND is_initial AND is_active LIMIT 1`)[0];
  if (!initialStatus) {
    throw new Error('WORKFLOW_SCOPE_MISMATCH');
  }

  if (input.status_id) {
    const status = (await sql<{ id: string }[]>`SELECT id FROM task_statuses WHERE id=${input.status_id} AND workflow_id=${workflowId} AND is_active LIMIT 1`)[0];
    if (!status) {
      throw new Error('STATUS_SCOPE_MISMATCH');
    }
  }

  return { workflow_id: workflowId, status_id: input.status_id ?? initialStatus.id };
}

export async function createTaskRecordTx(sql: TransactionSql, workspaceId: string, actorId: string, input: TaskCreationInput, workflow: TaskTemplateReferences) {
  await sql`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
  const key = (await sql<{ key: string }[]>`SELECT 'TASK-' || (COUNT(*) + 1)::text AS key FROM tasks WHERE workspace_id=${workspaceId}`)[0];
  if (!key || !input.title?.trim()) throw new Error('VALIDATION_ERROR');
  const task = (await sql<{ id: string }[]>`INSERT INTO tasks(workspace_id,task_key,title,description,workflow_id,status_id,priority,team_id,creator_id,recurrence_rule_id,start_at,due_at) VALUES(${workspaceId},${key.key},${input.title.trim()},${input.description ?? null},${workflow.workflow_id},${input.status_id ?? workflow.status_id},${input.priority ?? 'MEDIUM'},${input.team_id ?? null},${actorId},${input.recurrence_rule_id ?? null},${input.start_at ?? null},${input.due_at ?? null}) RETURNING id`)[0];
  if (input.due_at) {
    await insertOutboxEvent(sql, { workspaceId, aggregateType: 'TASK', aggregateId: task.id, eventType: 'task.due_changed', payload: { taskId: task.id, workspaceId, dueAt: new Date(input.due_at).toISOString(), dueVersion: 0 } });
  }
  return { id: task.id, taskKey: key.key };
}

export async function createTaskAssigneesTx(sql: TransactionSql, workspaceId: string, taskId: string, actorId: string, assignees: TaskAssigneeInput[]) {
  if (assignees.filter((a) => a.is_primary).length > 1) throw new Error('VALIDATION_ERROR');
  for (const assignee of assignees) if (!(await sql<{ user_id: string }[]>`SELECT user_id FROM workspace_memberships WHERE workspace_id=${workspaceId} AND user_id=${assignee.user_id} AND status='ACTIVE'`)[0]) throw new Error('CROSS_WORKSPACE_REFERENCE');
  for (const assignee of assignees) await sql`INSERT INTO task_assignees(task_id,user_id,is_primary,assigned_by) VALUES(${taskId},${assignee.user_id},${assignee.is_primary ?? false},${actorId})`;
  if (assignees.length > 0) {
    await insertOutboxEvent(sql, { workspaceId, aggregateType: 'TASK', aggregateId: taskId, eventType: 'task.assigned', payload: { taskId, workspaceId, addedAssigneeIds: assignees.map((a) => a.user_id), eventId: randomUUID() } });
  }
}

export async function patchTaskRecordTx(sql: TransactionSql, workspaceId: string, actorId: string, taskId: string, input: TaskPatchInput) {
  const current = (await sql<{ id: string; due_at: Date | null; due_version: number; version: number }[]>`SELECT id,due_at,due_version,version FROM tasks WHERE id=${taskId} AND workspace_id=${workspaceId} AND version=${input.version} AND deleted_at IS NULL FOR UPDATE`)[0];
  if (!current) throw new Error('VERSION_CONFLICT');

  const oldDueTime = current.due_at ? new Date(current.due_at).getTime() : null;
  const newDueTime = input.due_at !== undefined ? (input.due_at ? new Date(input.due_at).getTime() : null) : oldDueTime;
  const dueChanged = input.due_at !== undefined && oldDueTime !== newDueTime;
  const nextDueVersion = dueChanged ? current.due_version + 1 : current.due_version;
  const nextDueAt = input.due_at !== undefined ? (input.due_at ? new Date(input.due_at).toISOString() : null) : (current.due_at ? new Date(current.due_at).toISOString() : null);

  await sql`UPDATE tasks SET title=COALESCE(${input.title?.trim() ?? null},title),description=CASE WHEN ${input.description === undefined} THEN description ELSE ${input.description ?? null} END,priority=COALESCE(${input.priority ?? null},priority),start_at=CASE WHEN ${input.start_at === undefined} THEN start_at ELSE ${input.start_at ?? null} END,due_at=CASE WHEN ${input.due_at === undefined} THEN due_at ELSE ${input.due_at ?? null} END,due_version=${nextDueVersion},version=version+1,updated_at=NOW() WHERE id=${taskId}`;

  if (dueChanged) {
    await insertOutboxEvent(sql, { workspaceId, aggregateType: 'TASK', aggregateId: taskId, eventType: 'task.due_changed', payload: { taskId, workspaceId, dueAt: nextDueAt, dueVersion: nextDueVersion } });
  }
  await sql`INSERT INTO task_history(task_id,actor_user_id,event_type,metadata) VALUES(${taskId},${actorId},'UPDATED',${JSON.stringify({})}::jsonb)`;
}

export async function patchTaskAssigneesTx(sql: TransactionSql, workspaceId: string, actorId: string, taskId: string, input: TaskAssignPatchInput) {
  const current = (await sql<{ id: string; version: number }[]>`SELECT id,version FROM tasks WHERE id=${taskId} AND workspace_id=${workspaceId} AND version=${input.version} AND deleted_at IS NULL FOR UPDATE`)[0];
  if (!current) throw new Error('VERSION_CONFLICT');
  if (input.assignees.filter((a) => a.is_primary).length > 1) throw new Error('VALIDATION_ERROR');

  for (const assignee of input.assignees) {
    const member = (await sql<{ user_id: string }[]>`SELECT user_id FROM workspace_memberships WHERE workspace_id=${workspaceId} AND user_id=${assignee.user_id} AND status='ACTIVE'`)[0];
    if (!member) throw new Error('CROSS_WORKSPACE_REFERENCE');
  }

  const existingAssignees = await sql<{ user_id: string }[]>`SELECT user_id FROM task_assignees WHERE task_id=${taskId}`;
  const existingSet = new Set(existingAssignees.map((a) => a.user_id));
  const addedAssigneeIds = input.assignees.map((a) => a.user_id).filter((uid) => !existingSet.has(uid));

  await sql`DELETE FROM task_assignees WHERE task_id=${taskId}`;
  for (const assignee of input.assignees) {
    await sql`INSERT INTO task_assignees(task_id,user_id,is_primary,assigned_by) VALUES(${taskId},${assignee.user_id},${assignee.is_primary ?? false},${actorId})`;
  }

  await sql`UPDATE tasks SET version=version+1,updated_at=NOW() WHERE id=${taskId}`;
  await sql`INSERT INTO task_history(task_id,actor_user_id,event_type,metadata) VALUES(${taskId},${actorId},'ASSIGNEES_CHANGED',${JSON.stringify({})}::jsonb)`;

  if (addedAssigneeIds.length > 0) {
    await insertOutboxEvent(sql, { workspaceId, aggregateType: 'TASK', aggregateId: taskId, eventType: 'task.assigned', payload: { taskId, workspaceId, addedAssigneeIds, eventId: randomUUID() } });
  }
}

export async function writeTaskHistoryTx(sql: TransactionSql, taskId: string, actorId: string, metadata: Record<string, unknown> = {}) {
  await sql`INSERT INTO task_history(task_id,actor_user_id,event_type,metadata) VALUES(${taskId},${actorId},'CREATED',${JSON.stringify(metadata)}::jsonb)`;
}
