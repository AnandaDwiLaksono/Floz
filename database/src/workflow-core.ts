import type { TransactionSql } from 'postgres';

export type WorkflowAggregateRow = {
  id: string;
  workspace_id: string;
  team_id: string | null;
  code: string;
  name: string;
  description: string | null;
  is_default: boolean;
  is_active: boolean;
  version: number;
  created_by: string;
};

export type TaskStatusAggregateRow = {
  id: string;
  workflow_id: string;
  code: string;
  name: string;
  category: string;
  position: number;
  is_initial: boolean;
  is_terminal: boolean;
  is_active: boolean;
};

export async function lockWorkspaceForWorkflowDefaultTx(sql: TransactionSql, workspaceId: string): Promise<void> {
  await sql`SELECT id FROM workspaces WHERE id = ${workspaceId} FOR UPDATE`;
}

export async function lockWorkflowsDeterministicTx(
  sql: TransactionSql,
  workspaceId: string,
  workflowIds: string[]
): Promise<WorkflowAggregateRow[]> {
  if (workflowIds.length === 0) return [];
  const uniqueSortedIds = [...new Set(workflowIds)].sort();
  return await sql<WorkflowAggregateRow[]>`
    SELECT id, workspace_id, team_id, code, name, description, is_default, is_active, version, created_by
    FROM workflows
    WHERE workspace_id = ${workspaceId} AND id IN ${sql(uniqueSortedIds)}
    ORDER BY id ASC
    FOR UPDATE
  `;
}

export async function lockWorkflowAggregateTx(
  sql: TransactionSql,
  workspaceId: string,
  workflowId: string,
  expectedVersion: number
): Promise<{ workflow: WorkflowAggregateRow; statuses: TaskStatusAggregateRow[] }> {
  const workflow = (await sql<WorkflowAggregateRow[]>`
    SELECT id, workspace_id, team_id, code, name, description, is_default, is_active, version, created_by
    FROM workflows
    WHERE id = ${workflowId} AND workspace_id = ${workspaceId}
    FOR UPDATE
  `)[0];

  if (!workflow) {
    throw new Error('NOT_FOUND');
  }

  if (workflow.version !== expectedVersion) {
    const error = new Error('VERSION_CONFLICT');
    (error as unknown as { currentVersion: number }).currentVersion = workflow.version;
    throw error;
  }

  const statuses = await sql<TaskStatusAggregateRow[]>`
    SELECT id, workflow_id, code, name, category, position, is_initial, is_terminal, is_active
    FROM task_statuses
    WHERE workflow_id = ${workflowId}
    ORDER BY position ASC, id ASC
    FOR UPDATE
  `;

  return { workflow, statuses };
}

export async function bumpWorkflowVersionTx(
  sql: TransactionSql,
  workflowId: string,
  expectedVersion: number
): Promise<number> {
  const updated = (await sql<{ id: string; version: number }[]>`
    UPDATE workflows
    SET version = version + 1, updated_at = NOW()
    WHERE id = ${workflowId} AND version = ${expectedVersion}
    RETURNING id, version
  `)[0];

  if (!updated) {
    const current = (await sql<{ version: number }[]>`SELECT version FROM workflows WHERE id = ${workflowId}`)[0];
    const error = new Error('VERSION_CONFLICT');
    (error as unknown as { currentVersion?: number }).currentVersion = current?.version;
    throw error;
  }

  return updated.version;
}
