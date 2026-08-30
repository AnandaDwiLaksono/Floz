import type { Sql, TransactionSql } from 'postgres';
import { resolveNextOccurrence } from '@floz/domain';
type Rule = { id: string; workspace_id: string; frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM'; interval_value: number; start_at: Date | string; end_at: Date | string | null; occurrence_limit: number | null; timezone: string; next_run_at: Date | string | null; is_active: boolean; anchor_day: number | null; generated_count: number; template_snapshot: Record<string, unknown>; created_by: string };
type Workflow = { workflow_id: string; status_id: string };

export type GenerateDueOccurrenceInput = { sql: Sql; recurrenceRuleId: string; now: Date };

async function createTask(sql: TransactionSql, rule: Rule, scheduledFor: Date) {
  const template = rule.template_snapshot;
  const workflowId = typeof template.workflow_id === 'string' ? template.workflow_id : '';
  const title = typeof template.title === 'string' ? template.title.trim() : '';
  const description = typeof template.description === 'string' ? template.description : null;
  const priority = typeof template.priority === 'string' ? template.priority : 'MEDIUM';
  const teamId = typeof template.team_id === 'string' ? template.team_id : null;
  const dueAt = typeof template.due_at === 'string' ? template.due_at : null;
  const primaryAssigneeId = typeof template.primary_assignee_id === 'string' ? template.primary_assignee_id : null;
  const workflow = (await sql<Workflow[]>`SELECT w.id AS workflow_id,s.id AS status_id FROM workflows w JOIN task_statuses s ON s.workflow_id=w.id AND s.is_initial WHERE w.id=${workflowId} AND w.workspace_id=${rule.workspace_id} AND w.is_active LIMIT 1`)[0];
  if (!workflow) throw new Error('WORKFLOW_SCOPE_MISMATCH');
  const assigneeIds = Array.isArray(template.assignee_ids) ? template.assignee_ids.filter((value): value is string => typeof value === 'string') : [];
  for (const userId of assigneeIds) if (!(await sql`SELECT user_id FROM workspace_memberships WHERE workspace_id=${rule.workspace_id} AND user_id=${userId} AND status='ACTIVE'`)[0]) throw new Error('CROSS_WORKSPACE_REFERENCE');
  const key = (await sql<{ key: string }[]>`SELECT 'TASK-' || (COUNT(*) + 1)::text AS key FROM tasks WHERE workspace_id=${rule.workspace_id}`)[0].key;
  const task = (await sql<{ id: string }[]>`INSERT INTO tasks(workspace_id,task_key,title,description,workflow_id,status_id,priority,team_id,creator_id,recurrence_rule_id,start_at,due_at) VALUES(${rule.workspace_id},${key},${title},${description},${workflow.workflow_id},${workflow.status_id},${priority},${teamId},${rule.created_by},${rule.id},${scheduledFor.toISOString()},${dueAt}) RETURNING id`)[0];
  for (const userId of assigneeIds) await sql`INSERT INTO task_assignees(task_id,user_id,is_primary,assigned_by) VALUES(${task.id},${userId},${userId === primaryAssigneeId},${rule.created_by})`;
  await sql`INSERT INTO task_history(task_id,actor_user_id,event_type,metadata) VALUES(${task.id},${rule.created_by},'RECURRING_GENERATED',${JSON.stringify({ recurrence_rule_id: rule.id, scheduled_for: scheduledFor.toISOString() })}::jsonb)`;
  return task.id;
}

export async function generateDueOccurrence(input: GenerateDueOccurrenceInput): Promise<'generated' | 'noop'> {
  return input.sql.begin(async (sql) => {
    const rule = (await sql<Rule[]>`SELECT * FROM recurrence_rules WHERE id=${input.recurrenceRuleId} FOR UPDATE`)[0];
    if (!rule?.is_active || !rule.next_run_at) return 'noop';
    const scheduledFor = new Date(rule.next_run_at);
    if (scheduledFor > input.now || (await sql`SELECT id FROM recurrence_occurrences WHERE recurrence_rule_id=${rule.id} AND scheduled_for=${scheduledFor.toISOString()}`)[0]) return 'noop';
    const taskId = await createTask(sql, rule, scheduledFor);
    await sql`INSERT INTO recurrence_occurrences(workspace_id,recurrence_rule_id,scheduled_for,task_id) VALUES(${rule.workspace_id},${rule.id},${scheduledFor.toISOString()},${taskId})`;
    const nextRunAt = resolveNextOccurrence({ frequency: rule.frequency, intervalValue: rule.interval_value, timezone: rule.timezone, startAt: new Date(rule.start_at), endAt: rule.end_at ? new Date(rule.end_at) : null, occurrenceLimit: rule.occurrence_limit, generatedCount: rule.generated_count + 1, anchorDay: rule.anchor_day, latestGeneratedScheduledFor: scheduledFor });
    await sql`UPDATE recurrence_rules SET generated_count=generated_count+1,next_run_at=${nextRunAt?.toISOString() ?? null},updated_at=NOW() WHERE id=${rule.id}`;
    if (nextRunAt) await sql`INSERT INTO outbox_events(workspace_id,aggregate_type,aggregate_id,event_type,payload,available_at) VALUES(${rule.workspace_id},'recurrence_rule',${rule.id},'RECURRENCE_WAKEUP',${JSON.stringify({ recurrence_rule_id: rule.id })}::jsonb,${nextRunAt.toISOString()})`;
    return 'generated';
  });
}
