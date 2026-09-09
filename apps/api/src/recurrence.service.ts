import { BadRequestException, ConflictException, Injectable, Inject, NotFoundException } from '@nestjs/common';
import type { Sql, TransactionSql } from 'postgres';
import { resolveFirstOccurrence, resolveNextOccurrence, resolveNextOccurrenceAfterUpdate, validateExecutableRecurrence } from '@floz/domain';
import { AuthService } from './auth';
import { createTaskAssigneesTx, createTaskRecordTx, validateTaskTemplateReferences, writeTaskHistoryTx } from './task-core';
import { enqueueWakeupIntentTx } from './outbox.service';
import type { CreateRecurringTaskDto, RecurrenceRuleQueryDto, UpdateRecurrenceRuleDto } from './recurrence.dto';

type RootSql = Sql;
type SqlClient = Sql | TransactionSql;
type RecurrenceFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';
type RuleRow = { id: string; workspace_id: string; name: string; frequency: RecurrenceFrequency; interval_value: number; start_at: Date; end_at: Date | null; occurrence_limit: number | null; timezone: string; next_run_at: Date | null; is_active: boolean; anchor_day: number | null; generated_count: number; rule_config: Record<string, unknown>; template_snapshot: Record<string, unknown>; created_by: string; created_at: Date; updated_at: Date };
type IdempotencyRow = { request_fingerprint: string; recurrence_rule_id: string | null; first_occurrence_task_id: string | null };
type TaskRow = { id: string; workspace_id: string; task_key: string; title: string; description: string | null; workflow_id: string; status_id: string; priority: string; team_id: string | null; creator_id: string; start_at: Date | null; due_at: Date | null; completed_at: Date | null; version: number; recurrence_rule_id: string | null; created_at: Date; updated_at: Date; status_code: string; status_name: string; status_category: string };

function iso(value: Date | string | null) { return value === null ? null : new Date(value).toISOString(); }
function stable(value: unknown): unknown { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)])); return value; }
function fingerprint(input: CreateRecurringTaskDto) { return JSON.stringify(stable(input)); }
function encodeCursor(row: RuleRow) { return Buffer.from(JSON.stringify({ created_at: iso(row.created_at), id: row.id })).toString('base64url'); }
function decodeCursor(value: string) { try { const cursor = JSON.parse(Buffer.from(value, 'base64url').toString()) as { created_at?: string; id?: string }; if (!cursor.created_at || Number.isNaN(new Date(cursor.created_at).getTime()) || !cursor.id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cursor.id)) throw new Error(); return cursor as { created_at: string; id: string }; } catch { throw new BadRequestException('VALIDATION_ERROR'); } }
function rule(row: RuleRow) { return { ...row, start_at: iso(row.start_at), end_at: iso(row.end_at), next_run_at: iso(row.next_run_at), created_at: iso(row.created_at), updated_at: iso(row.updated_at) }; }
function task(row: TaskRow, assignees: { user_id: string; is_primary: boolean; full_name: string }[]) { const { status_code, status_name, status_category, ...rest } = row; return { ...rest, start_at: iso(row.start_at), due_at: iso(row.due_at), completed_at: iso(row.completed_at), created_at: iso(row.created_at), updated_at: iso(row.updated_at), status: { id: row.status_id, code: status_code, name: status_name, category: status_category }, assignees }; }
function rethrowRecurrenceValidation(error: unknown): never {
  if (error instanceof BadRequestException || error instanceof ConflictException || error instanceof NotFoundException) throw error;
  if (error instanceof Error && (error.message === 'VALIDATION_ERROR' || error.message === 'UNSUPPORTED_RECURRENCE_RULE')) throw new BadRequestException('VALIDATION_ERROR');
  throw error;
}

@Injectable()
export class RecurrenceService {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}
  private get sql(): RootSql { return this.authService.database.sql; }
  private schedule(row: RuleRow) { return { frequency: row.frequency, intervalValue: row.interval_value, timezone: row.timezone, startAt: new Date(row.start_at), endAt: row.end_at, occurrenceLimit: row.occurrence_limit, anchorDay: row.anchor_day, generatedCount: row.generated_count }; }
  private async getRule(sql: SqlClient, workspaceId: string, id: string) { const row = (await sql<RuleRow[]>`SELECT * FROM recurrence_rules WHERE id=${id} AND workspace_id=${workspaceId}`)[0]; if (!row) throw new NotFoundException('NOT_FOUND'); return row; }
  private async getTask(sql: SqlClient, workspaceId: string, id: string) { const row = (await sql<TaskRow[]>`SELECT t.*,s.code AS status_code,s.name AS status_name,s.category AS status_category FROM tasks t JOIN task_statuses s ON s.id=t.status_id WHERE t.id=${id} AND t.workspace_id=${workspaceId} AND t.deleted_at IS NULL`)[0]; if (!row) throw new NotFoundException('NOT_FOUND'); const assignees = await sql<{ user_id: string; is_primary: boolean; full_name: string }[]>`SELECT ta.user_id,ta.is_primary,u.name AS full_name FROM task_assignees ta JOIN users u ON u.id=ta.user_id WHERE ta.task_id=${id} ORDER BY ta.is_primary DESC,u.name`; return task(row, assignees); }
  private async validateAssignees(sql: SqlClient, workspaceId: string, ids: string[]) { for (const id of ids) if (!(await sql`SELECT user_id FROM workspace_memberships WHERE workspace_id=${workspaceId} AND user_id=${id} AND status='ACTIVE'`)[0]) throw new BadRequestException('CROSS_WORKSPACE_REFERENCE'); }
  async create(workspaceId: string, actorId: string, idempotencyKey: string | undefined, input: CreateRecurringTaskDto) {
    if (!idempotencyKey) throw new BadRequestException('IDEMPOTENCY_KEY_REQUIRED');
    return this.sql.begin(async (sql: TransactionSql) => {
      const fp = fingerprint(input);
      const existing = (await sql<IdempotencyRow[]>`SELECT request_fingerprint,recurrence_rule_id,first_occurrence_task_id FROM recurrence_idempotency_keys WHERE workspace_id=${workspaceId} AND idempotency_key=${idempotencyKey}`)[0];
      if (existing?.request_fingerprint && existing.request_fingerprint !== fp) throw new ConflictException('IDEMPOTENCY_REUSE');
      if (existing?.recurrence_rule_id && existing.first_occurrence_task_id) return { ...rule(await this.getRule(sql, workspaceId, existing.recurrence_rule_id)), first_occurrence: await this.getTask(sql, workspaceId, existing.first_occurrence_task_id) };
      let firstAt: Date;
      let nextRunAt: Date | null;
      try {
        validateExecutableRecurrence({ frequency: input.frequency, intervalValue: input.interval_value, timezone: input.timezone, startAt: new Date(input.start_at), endAt: input.end_at ? new Date(input.end_at) : null, occurrenceLimit: input.occurrence_limit ?? null });
        firstAt = resolveFirstOccurrence({ frequency: input.frequency, intervalValue: input.interval_value, timezone: input.timezone, startAt: new Date(input.start_at), endAt: input.end_at ? new Date(input.end_at) : null, occurrenceLimit: input.occurrence_limit ?? null });
        nextRunAt = resolveNextOccurrence({ frequency: input.frequency, intervalValue: input.interval_value, timezone: input.timezone, startAt: new Date(input.start_at), endAt: input.end_at ? new Date(input.end_at) : null, occurrenceLimit: input.occurrence_limit ?? null, generatedCount: 1, latestGeneratedScheduledFor: firstAt });
      } catch (error) { rethrowRecurrenceValidation(error); }
      await this.validateAssignees(sql, workspaceId, input.assignee_ids ?? []);
      const workflow = await validateTaskTemplateReferences(sql, workspaceId, { title: input.title, description: input.description ?? null, workflow_id: input.workflow_id, status_id: input.status_id, priority: input.priority, team_id: input.team_id, start_at: firstAt.toISOString(), due_at: null });
      const created = (await sql<{ id: string }[]>`INSERT INTO recurrence_rules(workspace_id,name,frequency,interval_value,start_at,end_at,occurrence_limit,timezone,next_run_at,is_active,generated_count,rule_config,template_snapshot,created_by) VALUES(${workspaceId},${input.name},${input.frequency},${input.interval_value},${input.start_at},${input.end_at ?? null},${input.occurrence_limit ?? null},${input.timezone},${nextRunAt?.toISOString() ?? null},true,1,${JSON.stringify({})}::jsonb,${JSON.stringify(input)}::jsonb,${actorId}) RETURNING id`)[0];
      const taskRow = await createTaskRecordTx(sql, workspaceId, actorId, { title: input.title, description: input.description ?? null, priority: input.priority, workflow_id: workflow.workflow_id, status_id: workflow.status_id, team_id: input.team_id, start_at: firstAt.toISOString(), due_at: null }, workflow);
      await createTaskAssigneesTx(sql, workspaceId, taskRow.id, actorId, (input.assignee_ids ?? []).map((user_id) => ({ user_id, is_primary: user_id === input.primary_assignee_id })));
      await sql`UPDATE tasks SET recurrence_rule_id=${created.id} WHERE id=${taskRow.id}`;
      await sql`INSERT INTO recurrence_occurrences(workspace_id,recurrence_rule_id,scheduled_for,task_id) VALUES(${workspaceId},${created.id},${firstAt.toISOString()},${taskRow.id})`;
      await writeTaskHistoryTx(sql, taskRow.id, actorId);
      await sql`UPDATE task_history SET event_type='RECURRING_GENERATED',metadata=${JSON.stringify({ recurrence_rule_id: created.id, scheduled_for: firstAt.toISOString() })}::jsonb WHERE task_id=${taskRow.id} AND event_type='CREATED'`;
      await sql`INSERT INTO recurrence_idempotency_keys(workspace_id,idempotency_key,request_fingerprint,recurrence_rule_id,first_occurrence_task_id) VALUES(${workspaceId},${idempotencyKey},${fp},${created.id},${taskRow.id})`;
      if (nextRunAt) await enqueueWakeupIntentTx(sql, { workspaceId, aggregateId: created.id, payload: { recurrence_rule_id: created.id }, availableAt: nextRunAt });
      return { ...rule(await this.getRule(sql, workspaceId, created.id)), first_occurrence: await this.getTask(sql, workspaceId, taskRow.id) };
    });
  }
  async list(workspaceId: string, query: RecurrenceRuleQueryDto) {
    const activeValue = query.active as boolean | string | undefined;
    const active = activeValue === 'true' ? true : activeValue === 'false' ? false : activeValue;
    const limit = Math.min(Math.max(query.limit === undefined ? 50 : Number(query.limit), 1), 100);
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    if (query.team_id && !(await this.sql`SELECT id FROM teams WHERE id=${query.team_id} AND workspace_id=${workspaceId}`)[0]) throw new BadRequestException('TEAM_SCOPE_MISMATCH');
    if (query.assignee_id) await this.validateAssignees(this.sql, workspaceId, [query.assignee_id]);
    const rows = await this.sql<RuleRow[]>`SELECT * FROM recurrence_rules WHERE workspace_id=${workspaceId}${active === undefined ? this.sql`` : this.sql` AND is_active=${active}`}${query.team_id ? this.sql` AND template_snapshot->>'team_id'=${query.team_id}` : this.sql``}${query.assignee_id ? this.sql` AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(template_snapshot->'assignee_ids') assignee_id WHERE assignee_id=${query.assignee_id})` : this.sql``}${cursor ? this.sql` AND (created_at,id) < (${cursor.created_at},${cursor.id})` : this.sql``} ORDER BY created_at DESC,id DESC LIMIT ${limit + 1}`;
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return { data: page.map(rule), meta: { pagination: { limit, next_cursor: hasMore && page.length ? encodeCursor(page[page.length - 1]) : null, has_more: hasMore } } };
  }
  async get(workspaceId: string, id: string) { return rule(await this.getRule(this.sql, workspaceId, id)); }
  async update(workspaceId: string, id: string, input: UpdateRecurrenceRuleDto) {
    return this.sql.begin(async (sql: TransactionSql) => {
      const current = await this.getRule(sql, workspaceId, id);
       if (input.assignee_ids || input.primary_assignee_id) await this.validateAssignees(sql, workspaceId, [...(input.assignee_ids ?? []), ...(input.primary_assignee_id ? [input.primary_assignee_id] : [])]);
       if (input.team_id && !(await sql`SELECT id FROM teams WHERE id=${input.team_id} AND workspace_id=${workspaceId}`)[0]) throw new BadRequestException('TEAM_SCOPE_MISMATCH');
       const targetTeamId = input.team_id !== undefined ? input.team_id : (current.template_snapshot as Record<string, unknown>)?.team_id as string | null | undefined;
       const targetWorkflowId = input.workflow_id !== undefined ? input.workflow_id : (current.template_snapshot as Record<string, unknown>)?.workflow_id as string | undefined;
       const targetStatusId = input.status_id !== undefined ? input.status_id : (current.template_snapshot as Record<string, unknown>)?.status_id as string | undefined;
       if (input.workflow_id !== undefined || input.status_id !== undefined || input.team_id !== undefined) {
         await validateTaskTemplateReferences(sql, workspaceId, {
           workflow_id: targetWorkflowId,
           status_id: targetStatusId,
           team_id: targetTeamId,
           title: 'validation'
         });
       }
       const latest = (await sql<{ scheduled_for: Date }[]>`SELECT scheduled_for FROM recurrence_occurrences WHERE recurrence_rule_id=${id} ORDER BY scheduled_for DESC LIMIT 1`)[0]?.scheduled_for ?? current.start_at;
       const changed = input.frequency || input.interval_value || input.timezone || input.start_at || input.end_at !== undefined || input.occurrence_limit !== undefined;
       const schedule = { ...this.schedule(current), frequency: (input.frequency ?? current.frequency) as 'DAILY' | 'WEEKLY' | 'MONTHLY', intervalValue: input.interval_value ?? current.interval_value, timezone: input.timezone ?? current.timezone, startAt: new Date(input.start_at ?? current.start_at), endAt: input.end_at === undefined ? current.end_at : input.end_at ? new Date(input.end_at) : null, occurrenceLimit: input.occurrence_limit === undefined ? current.occurrence_limit : input.occurrence_limit };
       const latestGeneratedScheduledFor = new Date(latest);
       try { validateExecutableRecurrence(schedule); if (schedule.endAt && schedule.endAt < latestGeneratedScheduledFor) throw new Error('VALIDATION_ERROR'); } catch (error) { rethrowRecurrenceValidation(error); }
       const nextRunAt = changed ? resolveNextOccurrenceAfterUpdate({ ...schedule, latestGeneratedScheduledFor, effectiveChangeTime: new Date() }) : current.next_run_at;
       await sql`DELETE FROM outbox_events WHERE aggregate_id=${id} AND aggregate_type='recurrence_rule' AND event_type='RECURRENCE_WAKEUP' AND status='PENDING'`;
       await sql`UPDATE recurrence_rules SET name=COALESCE(${input.name ?? null},name),frequency=COALESCE(${input.frequency ?? null},frequency),interval_value=COALESCE(${input.interval_value ?? null},interval_value),timezone=COALESCE(${input.timezone ?? null},timezone),start_at=COALESCE(${input.start_at ?? null},start_at),end_at=CASE WHEN ${input.end_at === undefined} THEN end_at ELSE ${input.end_at ? input.end_at : null} END,occurrence_limit=CASE WHEN ${input.occurrence_limit === undefined} THEN occurrence_limit ELSE ${input.occurrence_limit ?? null} END,next_run_at=${nextRunAt ? nextRunAt.toISOString() : null},template_snapshot=template_snapshot || ${JSON.stringify(input)}::jsonb,updated_at=NOW() WHERE id=${id} AND workspace_id=${workspaceId}`;
       if (nextRunAt) await sql`INSERT INTO outbox_events(workspace_id,aggregate_type,aggregate_id,event_type,payload,available_at) VALUES(${workspaceId},'recurrence_rule',${id},'RECURRENCE_WAKEUP',${JSON.stringify({ recurrence_rule_id: id })}::jsonb,${nextRunAt.toISOString()})`;
       return rule(await this.getRule(sql, workspaceId, id));
    });
  }
  async stop(workspaceId: string, id: string) { return this.sql.begin(async (sql: TransactionSql) => { const updated = (await sql<{ id: string }[]>`UPDATE recurrence_rules SET is_active=false,next_run_at=NULL,updated_at=NOW() WHERE id=${id} AND workspace_id=${workspaceId} RETURNING id`)[0]; if (!updated) throw new NotFoundException('NOT_FOUND'); await sql`DELETE FROM outbox_events WHERE aggregate_id=${id} AND aggregate_type='recurrence_rule' AND event_type='RECURRENCE_WAKEUP' AND status='PENDING'`; return rule(await this.getRule(sql, workspaceId, id)); }); }
}
