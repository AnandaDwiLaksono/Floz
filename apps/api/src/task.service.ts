import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Inject, UnprocessableEntityException } from '@nestjs/common';
import type { Sql, TransactionSql } from 'postgres';
import { AuthService } from './auth';
import { createTaskAssigneesTx, createTaskRecordTx, patchTaskAssigneesTx, patchTaskRecordTx, validateTaskTemplateReferences, writeTaskHistoryTx } from './task-core';
import { TaskPolicy, type TaskRole } from './task.policy';

type RootSql = Sql;
type SqlClient = Sql | TransactionSql;
type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
type AssigneeInput = { user_id: string; is_primary?: boolean };
export interface CreateTaskDto { title?: string; description?: string | null; priority?: Priority; workflow_id?: string; status_id?: string; team_id?: string | null; start_at?: string | null; due_at?: string | null; assignees?: AssigneeInput[]; }
export interface UpdateTaskDto { version?: number; title?: string; description?: string | null; priority?: Priority; start_at?: string | null; due_at?: string | null; }
export interface AssignTaskDto { version?: number; assignees?: AssigneeInput[]; }
export interface TransitionTaskDto { version?: number; to_status_id?: string; }
export interface TaskQueryDto { limit?: string; sort?: string; q?: string; status_id?: string; priority?: string; cursor?: string; }
export interface KanbanQueryDto { workflow_id?: string; team_id?: string; assignee_id?: string; priority?: string; due_from?: string; due_to?: string; }
export interface CalendarQueryDto { from?: string; to?: string; team_id?: string; assignee_id?: string; }
export interface CalendarTaskSummary { id: string; task_key: string; title: string; priority: Priority; start_at: string | null; due_at: string | null; is_deadline_only: boolean; status: { id: string; name: string; code: string; category: string }; primary_assignee: { id: string; full_name: string } | null; }
type TaskRow = { id: string; workspace_id: string; task_key: string; title: string; description: string | null; workflow_id: string; status_id: string; priority: Priority; team_id: string | null; creator_id: string; start_at: Date | null; due_at: Date | null; completed_at: Date | null; version: number; created_at: Date; updated_at: Date; status_code: string; status_name: string; status_category: string };
type StatusRow = { id: string; category: string; status_id?: string; workflow_id?: string };
type AssigneeRow = { user_id: string; is_primary: boolean; full_name: string };
type CalendarRow = { id: string; task_key: string; title: string; priority: Priority; start_at: Date | string | null; due_at: Date | string | null; status_id: string; status_code: string; status_name: string; status_category: string; primary_assignee_id: string | null; primary_assignee_name: string | null; is_deadline_only: boolean };
const priorities: readonly Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const taskSorts: Record<string, string> = { created_at: 't.created_at', updated_at: 't.updated_at', due_at: 't.due_at', priority: 't.priority', task_key: 't.task_key' };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Cursor = { v: 1; sort: string; direction: 'ASC' | 'DESC'; value: string | null; id: string };

function encodeCursor(cursor: Cursor): string { return Buffer.from(JSON.stringify(cursor)).toString('base64url'); }
function decodeCursor(value: string, sort: string, direction: 'ASC' | 'DESC'): Cursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const json = Buffer.from(value, 'base64url').toString('utf8');
    if (Buffer.from(json).toString('base64url') !== value) throw new Error();
    const decoded = JSON.parse(json) as Partial<Cursor>;
    if (Object.keys(decoded).sort().join(',') !== 'direction,id,sort,v,value' || decoded.v !== 1 || decoded.sort !== sort || decoded.direction !== direction || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(decoded.id ?? '') || (decoded.value !== null && typeof decoded.value !== 'string') || (sort !== 'due_at' && decoded.value === null)) throw new Error();
    return decoded as Cursor;
  } catch { throw new UnprocessableEntityException('VALIDATION_ERROR'); }
}

@Injectable()
export class TaskService {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}
  private get sql(): RootSql { return this.authService.database.sql; }
  private validVersion(value: number | undefined): value is number { return value !== undefined && Number.isInteger(value) && value > 0; }
  private task(row: TaskRow, assignees: AssigneeRow[]) { const { status_code, status_name, status_category, ...task } = row; return { ...task, status: { id: row.status_id, code: status_code, name: status_name, category: status_category }, assignees }; }
  private mutation(role: TaskRole, action: 'mutate' | 'assign' | 'delete') { const allowed = action === 'delete' ? TaskPolicy.canDelete(role) : action === 'assign' ? TaskPolicy.canAssign(role) : TaskPolicy.canMutate(role); if (!allowed) throw new ForbiddenException('FORBIDDEN'); }
  private validateCreate(input: CreateTaskDto) { const primaryCount = input.assignees?.filter((a) => a.is_primary).length ?? 0; if (!input.title?.trim() || input.title.trim().length > 255 || (input.priority && !priorities.includes(input.priority)) || primaryCount > 1) throw new BadRequestException('VALIDATION_ERROR'); }
  private iso(value: Date | string | null) { return value === null ? null : new Date(value).toISOString(); }
  private async detailSql(sql: SqlClient, workspaceId: string, id: string) { const row = (await sql<TaskRow[]>`SELECT t.*, s.code AS status_code, s.name AS status_name, s.category AS status_category FROM tasks t JOIN task_statuses s ON s.id=t.status_id WHERE t.id=${id} AND t.workspace_id=${workspaceId} AND t.deleted_at IS NULL`)[0]; if (!row) throw new NotFoundException('NOT_FOUND'); const assignees = await sql<AssigneeRow[]>`SELECT ta.user_id, ta.is_primary, u.name AS full_name FROM task_assignees ta JOIN users u ON u.id=ta.user_id WHERE ta.task_id=${id} ORDER BY ta.is_primary DESC, u.name`; return this.task(row, assignees); }
  async workflows(workspaceId: string) { return this.sql`SELECT w.id, w.name, w.team_id, w.is_default, w.is_active, COALESCE(json_agg(json_build_object('id',s.id,'code',s.code,'name',s.name,'category',s.category,'position',s.position,'is_initial',s.is_initial,'is_terminal',s.is_terminal) ORDER BY s.position) FILTER (WHERE s.id IS NOT NULL),'[]') AS statuses FROM workflows w LEFT JOIN task_statuses s ON s.workflow_id=w.id WHERE w.workspace_id=${workspaceId} AND w.is_active GROUP BY w.id ORDER BY w.is_default DESC,w.name`; }
  async create(workspaceId: string, actorId: string, role: TaskRole, input: CreateTaskDto) { this.mutation(role, 'mutate'); this.validateCreate(input); return this.authService.database.sql.begin(async (sql: TransactionSql) => { const workflow = await validateTaskTemplateReferences(sql, workspaceId, input); const task = await createTaskRecordTx(sql, workspaceId, actorId, input, workflow); await createTaskAssigneesTx(sql, workspaceId, task.id, actorId, input.assignees ?? []); await writeTaskHistoryTx(sql, task.id, actorId); return this.detailSql(sql, workspaceId, task.id); }); }
  private async replaceAssignees(sql: SqlClient, workspaceId: string, taskId: string, actorId: string, assignees: AssigneeInput[]) { if (assignees.filter((a) => a.is_primary).length > 1) throw new BadRequestException('VALIDATION_ERROR'); for (const assignee of assignees) { const member = (await sql<{ user_id: string }[]>`SELECT user_id FROM workspace_memberships WHERE workspace_id=${workspaceId} AND user_id=${assignee.user_id} AND status='ACTIVE'`)[0]; if (!member) throw new BadRequestException('CROSS_WORKSPACE_REFERENCE'); } await sql`DELETE FROM task_assignees WHERE task_id=${taskId}`; for (const assignee of assignees) await sql`INSERT INTO task_assignees(task_id,user_id,is_primary,assigned_by) VALUES(${taskId},${assignee.user_id},${assignee.is_primary ?? false},${actorId})`; }
  async detail(workspaceId: string, id: string) { return this.detailSql(this.sql, workspaceId, id); }
  async calendar(workspaceId: string, query: CalendarQueryDto): Promise<{ data: CalendarTaskSummary[]; meta: { from: string; to: string } }> {
    if (!query.from || !query.to) throw new BadRequestException('VALIDATION_ERROR');
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) throw new BadRequestException('VALIDATION_ERROR');
    const fromIso = from.toISOString();
    const toIso = to.toISOString();
    if (query.team_id && !uuidPattern.test(query.team_id)) throw new BadRequestException('VALIDATION_ERROR');
    if (query.assignee_id && !uuidPattern.test(query.assignee_id)) throw new BadRequestException('VALIDATION_ERROR');
    if (query.team_id && !(await this.sql`SELECT id FROM teams WHERE id=${query.team_id} AND workspace_id=${workspaceId}`)[0]) throw new BadRequestException('TEAM_SCOPE_MISMATCH');
    if (query.assignee_id && !(await this.sql`SELECT user_id FROM workspace_memberships WHERE workspace_id=${workspaceId} AND user_id=${query.assignee_id} AND status='ACTIVE'`)[0]) throw new BadRequestException('CROSS_WORKSPACE_REFERENCE');
    const rows = await this.sql<CalendarRow[]>`SELECT t.id,t.task_key,t.title,t.priority,t.start_at,t.due_at,t.status_id,s.code AS status_code,s.name AS status_name,s.category AS status_category,pa.user_id AS primary_assignee_id,pa.full_name AS primary_assignee_name,t.start_at IS NULL AND t.due_at IS NOT NULL AS is_deadline_only FROM tasks t JOIN task_statuses s ON s.id=t.status_id LEFT JOIN LATERAL (SELECT ta.user_id,u.name AS full_name FROM task_assignees ta JOIN users u ON u.id=ta.user_id WHERE ta.task_id=t.id AND ta.is_primary ORDER BY u.name ASC LIMIT 1) pa ON TRUE WHERE t.workspace_id=${workspaceId} AND t.deleted_at IS NULL AND (${query.team_id ?? null}::uuid IS NULL OR t.team_id=${query.team_id ?? null}) AND (${query.assignee_id ?? null}::uuid IS NULL OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id=t.id AND ta.user_id=${query.assignee_id ?? null})) AND ((t.start_at IS NOT NULL AND t.due_at IS NOT NULL AND t.start_at < ${toIso} AND t.due_at > ${fromIso}) OR (t.start_at IS NULL AND t.due_at IS NOT NULL AND t.due_at >= ${fromIso} AND t.due_at < ${toIso})) ORDER BY COALESCE(t.start_at,t.due_at) ASC,t.task_key ASC`;
    return { data: rows.map((row) => ({ id: row.id, task_key: row.task_key, title: row.title, priority: row.priority, start_at: this.iso(row.start_at), due_at: this.iso(row.due_at), is_deadline_only: row.is_deadline_only, status: { id: row.status_id, code: row.status_code, name: row.status_name, category: row.status_category }, primary_assignee: row.primary_assignee_id && row.primary_assignee_name ? { id: row.primary_assignee_id, full_name: row.primary_assignee_name } : null })), meta: { from: fromIso, to: toIso } };
  }

  async kanban(workspaceId: string, query: KanbanQueryDto) {
    const prioritiesFilter = query.priority ? query.priority.split(',').filter((value): value is Priority => priorities.includes(value as Priority)) : [];
    if (query.priority && prioritiesFilter.length !== query.priority.split(',').length) throw new BadRequestException('VALIDATION_ERROR');
    const workflow = (await this.sql<{ id: string; name: string; team_id: string | null }[]>`SELECT id,name,team_id FROM workflows WHERE workspace_id=${workspaceId} AND is_active AND id=COALESCE(${query.workflow_id ?? null},(SELECT id FROM workflows WHERE workspace_id=${workspaceId} AND is_active AND is_default LIMIT 1))`)[0];
    if (!workflow) throw new NotFoundException('NOT_FOUND');
    const statuses = await this.sql<{ id: string; code: string; name: string; category: string; position: number }[]>`SELECT id,code,name,category,position FROM task_statuses WHERE workflow_id=${workflow.id} AND category <> 'CANCELLED' ORDER BY position ASC,id ASC`;
    const rows = await this.sql<(TaskRow & { assignees: AssigneeRow[] })[]>`SELECT t.*,s.code AS status_code,s.name AS status_name,s.category AS status_category,COALESCE((SELECT json_agg(json_build_object('user_id',ta.user_id,'is_primary',ta.is_primary,'full_name',u.name) ORDER BY ta.is_primary DESC,u.name) FROM task_assignees ta JOIN users u ON u.id=ta.user_id WHERE ta.task_id=t.id),'[]') AS assignees FROM tasks t JOIN task_statuses s ON s.id=t.status_id WHERE t.workspace_id=${workspaceId} AND t.workflow_id=${workflow.id} AND t.deleted_at IS NULL AND (${query.team_id ?? null}::uuid IS NULL OR t.team_id=${query.team_id ?? null}) AND (${query.assignee_id ?? null}::uuid IS NULL OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id=t.id AND ta.user_id=${query.assignee_id ?? null})) AND (${prioritiesFilter.length ? this.sql` t.priority IN ${this.sql(prioritiesFilter)}` : this.sql` TRUE`}) AND (${query.due_from ?? null}::timestamptz IS NULL OR t.due_at >= ${query.due_from ?? null}) AND (${query.due_to ?? null}::timestamptz IS NULL OR t.due_at <= ${query.due_to ?? null}) ORDER BY t.due_at ASC NULLS LAST,t.task_key ASC`;
    return { workflow, columns: statuses.map((status) => { const cards = rows.filter((row) => row.status_id === status.id).map((row) => this.task(row, row.assignees)); return { status, task_count: cards.length, cards }; }) };
  }
  async list(workspaceId: string, query: TaskQueryDto) {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
    const sort = query.sort ?? '-created_at';
    const sortName = sort.replace(/^-/, '');
    const column = taskSorts[sortName];
    if (!column) throw new BadRequestException('VALIDATION_ERROR');
    const direction = sort.startsWith('-') ? 'DESC' : 'ASC';
    const cursor = query.cursor ? decodeCursor(query.cursor, sortName, direction) : undefined;
    const after = !cursor ? this.sql`` : sortName !== 'due_at' ? direction === 'ASC' ? this.sql` AND (${this.sql.unsafe(column)},t.id) > (${cursor.value},${cursor.id})` : this.sql` AND (${this.sql.unsafe(column)},t.id) < (${cursor.value},${cursor.id})` : direction === 'ASC' ? cursor.value === null ? this.sql` AND t.due_at IS NULL AND t.id > ${cursor.id}` : this.sql` AND (t.due_at > ${cursor.value} OR (t.due_at = ${cursor.value} AND t.id > ${cursor.id}) OR t.due_at IS NULL)` : cursor.value === null ? this.sql` AND (t.due_at IS NOT NULL OR (t.due_at IS NULL AND t.id < ${cursor.id}))` : this.sql` AND (t.due_at < ${cursor.value} OR (t.due_at = ${cursor.value} AND t.id < ${cursor.id}))`;
    const nulls = sortName === 'due_at' ? this.sql.unsafe(direction === 'ASC' ? ' NULLS LAST' : ' NULLS FIRST') : this.sql``;
    const rows = await this.sql<TaskRow[]>`SELECT t.*,s.code AS status_code,s.name AS status_name,s.category AS status_category FROM tasks t JOIN task_statuses s ON s.id=t.status_id WHERE t.workspace_id=${workspaceId} AND t.deleted_at IS NULL ${query.q ? this.sql` AND (t.title ILIKE ${`%${query.q}%`} OR t.task_key ILIKE ${`%${query.q}%`})` : this.sql``}${query.status_id ? this.sql` AND t.status_id=${query.status_id}` : this.sql``}${query.priority ? this.sql` AND t.priority=${query.priority}` : this.sql``}${after} ORDER BY ${this.sql.unsafe(column)} ${this.sql.unsafe(direction)}${nulls},t.id ${this.sql.unsafe(direction)} LIMIT ${limit + 1}`;
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return { rows: page.map((row) => this.task(row, [])), hasMore, limit, nextCursor: hasMore && last ? encodeCursor({ v: 1, sort: sortName, direction, value: last[sortName as keyof TaskRow] instanceof Date ? (last[sortName as keyof TaskRow] as Date).toISOString() : String(last[sortName as keyof TaskRow]), id: last.id }) : null };
  }
  async update(workspaceId: string, actorId: string, role: TaskRole, id: string, input: UpdateTaskDto) { this.mutation(role, 'mutate'); if (!this.validVersion(input.version) || (input.priority && !priorities.includes(input.priority)) || (input.title !== undefined && !input.title.trim())) throw new BadRequestException('VALIDATION_ERROR'); return this.authService.database.sql.begin(async (sql: TransactionSql) => { await patchTaskRecordTx(sql, workspaceId, actorId, id, { ...input, version: input.version! }); return this.detailSql(sql, workspaceId, id); }); }
  async assign(workspaceId: string, actorId: string, role: TaskRole, id: string, input: AssignTaskDto) { this.mutation(role, 'assign'); if (!this.validVersion(input.version) || !input.assignees) throw new BadRequestException('VALIDATION_ERROR'); return this.authService.database.sql.begin(async (sql: TransactionSql) => { await patchTaskAssigneesTx(sql, workspaceId, actorId, id, { version: input.version!, assignees: input.assignees! }); return this.detailSql(sql, workspaceId, id); }); }
  async transition(workspaceId: string, actorId: string, role: TaskRole, id: string, input: TransitionTaskDto) { this.mutation(role, 'mutate'); if (!this.validVersion(input.version) || !input.to_status_id) throw new BadRequestException('VALIDATION_ERROR'); return this.authService.database.sql.begin(async (sql: TransactionSql) => { const task = (await sql<(TaskRow & { category: string })[]>`SELECT t.*,s.category FROM tasks t JOIN task_statuses s ON s.id=t.status_id WHERE t.id=${id} AND t.workspace_id=${workspaceId} AND t.deleted_at IS NULL FOR UPDATE`)[0]; if (!task) throw new NotFoundException('NOT_FOUND'); if (task.version !== input.version) throw new ConflictException('VERSION_CONFLICT'); const target = (await sql<StatusRow[]>`SELECT s.id,s.category FROM workflow_transitions wt JOIN task_statuses s ON s.id=wt.to_status_id WHERE wt.workflow_id=${task.workflow_id} AND wt.from_status_id=${task.status_id} AND wt.to_status_id=${input.to_status_id!}`)[0]; if (!target) throw new BadRequestException('INVALID_TRANSITION'); await sql`UPDATE tasks SET status_id=${target.id},completed_at=CASE WHEN ${target.category}='DONE' THEN NOW() ELSE NULL END,version=version+1,updated_at=NOW() WHERE id=${id}`; await sql`INSERT INTO task_history(task_id,actor_user_id,event_type,from_status_id,to_status_id,metadata) VALUES(${id},${actorId},${target.category === 'DONE' ? 'COMPLETED' : task.category === 'DONE' ? 'REOPENED' : 'STATUS_CHANGED'},${task.status_id},${target.id},${JSON.stringify({})}::jsonb)`; return this.detailSql(sql, workspaceId, id); }); }
  async remove(workspaceId: string, role: TaskRole, id: string, version: number) { this.mutation(role, 'delete'); if (!this.validVersion(version)) throw new BadRequestException('VALIDATION_ERROR'); const removed = (await this.sql<{ id: string }[]>`UPDATE tasks SET deleted_at=NOW(),version=version+1 WHERE id=${id} AND workspace_id=${workspaceId} AND version=${version} AND deleted_at IS NULL RETURNING id`)[0]; if (!removed) throw new ConflictException('VERSION_CONFLICT'); }
  async transitions(workspaceId: string, id: string) { return this.sql`SELECT wt.to_status_id,s.code,s.name FROM tasks t JOIN workflow_transitions wt ON wt.workflow_id=t.workflow_id AND wt.from_status_id=t.status_id JOIN task_statuses s ON s.id=wt.to_status_id WHERE t.workspace_id=${workspaceId} AND t.id=${id} AND t.deleted_at IS NULL`; }
  async history(workspaceId: string, id: string) { await this.detail(workspaceId, id); return this.sql`SELECT h.* FROM task_history h JOIN tasks t ON t.id=h.task_id WHERE t.workspace_id=${workspaceId} AND h.task_id=${id} ORDER BY h.created_at,h.id`; }
}
