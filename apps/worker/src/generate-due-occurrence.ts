import type { Sql } from 'postgres';
import { resolveNextOccurrence } from '@floz/domain';
import { createTaskAssigneesTx, createTaskRecordTx, validateTaskTemplateReferences, writeTaskHistoryTx } from '@floz/database';

type Rule = { id: string; workspace_id: string; frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM'; interval_value: number; start_at: Date | string; end_at: Date | string | null; occurrence_limit: number | null; timezone: string; next_run_at: Date | string | null; is_active: boolean; anchor_day: number | null; generated_count: number; template_snapshot: Record<string, unknown>; created_by: string };
export type GenerateDueOccurrenceInput = { sql: Sql; recurrenceRuleId: string; now: Date };

function dueAt(scheduledFor: Date, value: unknown, timezone: string) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const [hour, minute, second = '0'] = value.split(':');
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(scheduledFor).split('-').map(Number);
  const guess = new Date(Date.UTC(local[0], local[1] - 1, local[2], Number(hour), Number(minute), Number(second)));
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(guess);
  const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  const offset = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second) - guess.getTime();
  return new Date(guess.getTime() - offset).toISOString();
}

export async function generateDueOccurrence(input: GenerateDueOccurrenceInput): Promise<'generated' | 'noop'> {
  return input.sql.begin(async (sql) => {
    const rule = (await sql<Rule[]>`SELECT * FROM recurrence_rules WHERE id=${input.recurrenceRuleId} FOR UPDATE`)[0];
    if (!rule?.is_active || !rule.next_run_at) return 'noop';
    const scheduledFor = new Date(rule.next_run_at);
    if (scheduledFor > input.now) return 'noop';
    const template = rule.template_snapshot;
    try {
      await sql.savepoint(async (taskSql) => {
        const workflow = await validateTaskTemplateReferences(taskSql, rule.workspace_id, { workflow_id: typeof template.workflow_id === 'string' ? template.workflow_id : undefined, team_id: typeof template.team_id === 'string' ? template.team_id : null });
        const task = await createTaskRecordTx(taskSql, rule.workspace_id, rule.created_by, { title: typeof template.title === 'string' ? template.title : '', description: typeof template.description === 'string' ? template.description : null, priority: typeof template.priority === 'string' ? template.priority : 'MEDIUM', workflow_id: workflow.workflow_id, status_id: workflow.status_id, team_id: typeof template.team_id === 'string' ? template.team_id : null, recurrence_rule_id: rule.id, start_at: scheduledFor.toISOString(), due_at: dueAt(scheduledFor, template.due_time, rule.timezone) }, workflow);
        await createTaskAssigneesTx(taskSql, rule.workspace_id, task.id, rule.created_by, (Array.isArray(template.assignee_ids) ? template.assignee_ids.filter((value): value is string => typeof value === 'string') : []).map((user_id) => ({ user_id, is_primary: user_id === template.primary_assignee_id })));
        await writeTaskHistoryTx(taskSql, task.id, rule.created_by, { recurrence_rule_id: rule.id, scheduled_for: scheduledFor.toISOString() });
        await taskSql`UPDATE task_history SET event_type='RECURRING_GENERATED' WHERE task_id=${task.id} AND event_type='CREATED'`;
        await taskSql`INSERT INTO recurrence_occurrences(workspace_id,recurrence_rule_id,scheduled_for,task_id) VALUES(${rule.workspace_id},${rule.id},${scheduledFor.toISOString()},${task.id})`;
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') return 'noop';
      throw error;
    }
    const nextRunAt = resolveNextOccurrence({ frequency: rule.frequency, intervalValue: rule.interval_value, timezone: rule.timezone, startAt: new Date(rule.start_at), endAt: rule.end_at ? new Date(rule.end_at) : null, occurrenceLimit: rule.occurrence_limit, generatedCount: rule.generated_count + 1, anchorDay: rule.anchor_day, latestGeneratedScheduledFor: scheduledFor });
    await sql`UPDATE recurrence_rules SET generated_count=generated_count+1,next_run_at=${nextRunAt?.toISOString() ?? null},updated_at=NOW() WHERE id=${rule.id}`;
    if (nextRunAt) await sql`INSERT INTO outbox_events(workspace_id,aggregate_type,aggregate_id,event_type,payload,available_at) VALUES(${rule.workspace_id},'recurrence_rule',${rule.id},'RECURRENCE_WAKEUP',${JSON.stringify({ recurrence_rule_id: rule.id })}::jsonb,${nextRunAt.toISOString()})`;
    return 'generated';
  });
}
