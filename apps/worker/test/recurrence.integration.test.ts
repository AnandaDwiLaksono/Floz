import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '@floz/database';
import { generateDueOccurrence } from '../src/generate-due-occurrence.js';
import { runReconciliationIteration } from '../src/reconciliation.js';
import { createRecurrenceWorker } from '../src/recurrence-worker.js';

describe('recurrence generation integration', () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const { sql } = createDatabase(databaseUrl);
  const { sql: claimSql } = createDatabase(databaseUrl);
  const ids = {
    user: randomUUID(),
    assignee: randomUUID(),
    outsider: randomUUID(),
    workspace: randomUUID(),
    otherWorkspace: randomUUID(),
    role: randomUUID(),
    workflow: randomUUID(),
    status: randomUUID(),
    nonInitialStatus: randomUUID(),
    team: randomUUID(),
    badTeam: randomUUID(),
    rule: randomUUID(),
    duplicateRule: randomUUID(),
    raceRuleA: randomUUID(),
    raceRuleB: randomUUID(),
    staleStopRule: randomUUID(),
    staleFutureRule: randomUUID(),
    catchupRule: randomUUID()
  };

  beforeAll(async () => {
    await sql`INSERT INTO roles(id,code,name) VALUES(${ids.role},'REC','Recurrence')`;
    await sql`INSERT INTO users(id,email,name) VALUES(${ids.user},${`${ids.user}@example.test`},'Recurrence User'),(${ids.assignee},${`${ids.assignee}@example.test`},'Recurrence Assignee'),(${ids.outsider},${`${ids.outsider}@example.test`},'Outsider')`;
    await sql`INSERT INTO workspaces(id,name,slug,created_by) VALUES(${ids.workspace},'Recurrence',${`recurrence-${ids.workspace}`},${ids.user}),(${ids.otherWorkspace},'Other',${`other-${ids.otherWorkspace}`},${ids.user})`;
    await sql`INSERT INTO workspace_memberships(workspace_id,user_id,role_id) VALUES(${ids.workspace},${ids.user},${ids.role}),(${ids.workspace},${ids.assignee},${ids.role}),(${ids.otherWorkspace},${ids.outsider},${ids.role})`;
    await sql`INSERT INTO teams(id,workspace_id,name) VALUES(${ids.team},${ids.workspace},'Ops'),(${ids.badTeam},${ids.otherWorkspace},'Bad Ops')`;
    await sql`INSERT INTO workflows(id,workspace_id,code,name,is_default,created_by) VALUES(${ids.workflow},${ids.workspace},'REC','Recurrence',true,${ids.user})`;
    await sql`INSERT INTO task_statuses(id,workflow_id,code,name,category,position,is_initial) VALUES(${ids.status},${ids.workflow},'TODO','To do','OPEN',1,true),(${ids.nonInitialStatus},${ids.workflow},'READY','Ready','OPEN',2,false)`;
    await sql`INSERT INTO recurrence_rules(id,workspace_id,name,frequency,interval_value,start_at,timezone,next_run_at,is_active,generated_count,template_snapshot,created_by) VALUES
      (${ids.rule},${ids.workspace},'Daily','DAILY',1,'2026-08-29T09:00:00.000Z','UTC','2026-08-30T09:00:00.000Z',true,1,${JSON.stringify({ title: 'Generated', description: 'Canonical', workflow_id: ids.workflow, priority: 'HIGH', team_id: ids.team, assignee_ids: [ids.assignee], primary_assignee_id: ids.assignee, due_time: '17:30:00' })}::jsonb,${ids.user}),
      (${ids.duplicateRule},${ids.workspace},'Duplicate','DAILY',1,'2026-08-29T09:00:00.000Z','UTC','2026-08-30T10:00:00.000Z',true,1,${JSON.stringify({ title: 'Duplicate guarded', workflow_id: ids.workflow, assignee_ids: [ids.assignee], primary_assignee_id: ids.assignee })}::jsonb,${ids.user}),
      (${ids.raceRuleA},${ids.workspace},'Race A','DAILY',1,'2026-08-29T09:00:00.000Z','UTC','2026-08-30T11:00:00.000Z',true,1,${JSON.stringify({ title: 'Race A', workflow_id: ids.workflow, assignee_ids: [ids.assignee], primary_assignee_id: ids.assignee })}::jsonb,${ids.user}),
      (${ids.raceRuleB},${ids.workspace},'Race B','DAILY',1,'2026-08-29T09:00:00.000Z','UTC','2026-08-30T11:00:00.000Z',true,1,${JSON.stringify({ title: 'Race B', workflow_id: ids.workflow, assignee_ids: [ids.assignee], primary_assignee_id: ids.assignee })}::jsonb,${ids.user}),
      (${ids.staleStopRule},${ids.workspace},'Stopped','DAILY',1,'2026-08-29T09:00:00.000Z','UTC','2026-08-30T12:00:00.000Z',false,1,${JSON.stringify({ title: 'Stopped', workflow_id: ids.workflow })}::jsonb,${ids.user}),
      (${ids.staleFutureRule},${ids.workspace},'Future','DAILY',1,'2026-08-29T09:00:00.000Z','UTC','2026-09-10T12:00:00.000Z',true,1,${JSON.stringify({ title: 'Future', workflow_id: ids.workflow })}::jsonb,${ids.user}),
      (${ids.catchupRule},${ids.workspace},'Catchup','DAILY',1,'2026-08-27T09:00:00.000Z','UTC','2026-08-28T09:00:00.000Z',true,1,${JSON.stringify({ title: 'Catchup', workflow_id: ids.workflow })}::jsonb,${ids.user})`;
    const historicalTask = (await sql<{ id: string }[]>`INSERT INTO tasks(workspace_id,task_key,title,workflow_id,status_id,creator_id,recurrence_rule_id,start_at) VALUES(${ids.workspace},'TASK-1','Historical',${ids.workflow},${ids.status},${ids.user},${ids.duplicateRule},'2026-08-30T10:00:00.000Z') RETURNING id`)[0];
    await sql`INSERT INTO recurrence_occurrences(workspace_id,recurrence_rule_id,scheduled_for,task_id) VALUES(${ids.workspace},${ids.duplicateRule},'2026-08-30T10:00:00.000Z',${historicalTask.id})`;
  });

  afterAll(async () => { await claimSql.end(); await sql.end(); });

  it('generates canonical occurrence with team and due_time semantics', async () => {
    await expect(generateDueOccurrence({ sql, recurrenceRuleId: ids.rule, now: new Date('2026-08-30T09:00:00.000Z') })).resolves.toBe('generated');
    const task = (await sql<{ recurrence_rule_id: string; title: string; priority: string; team_id: string; start_at: string; due_at: string }[]>`SELECT recurrence_rule_id,title,priority,team_id,start_at,due_at FROM tasks WHERE recurrence_rule_id=${ids.rule}`)[0];
    expect(task).toMatchObject({ recurrence_rule_id: ids.rule, title: 'Generated', priority: 'HIGH', team_id: ids.team, start_at: '2026-08-30 09:00:00+00', due_at: '2026-08-30 17:30:00+00' });
  });

  it('uses the template status after canonical workflow validation', async () => {
    const statusRule = randomUUID();
    await sql`INSERT INTO recurrence_rules(id,workspace_id,name,frequency,interval_value,start_at,timezone,next_run_at,is_active,generated_count,template_snapshot,created_by) VALUES(${statusRule},${ids.workspace},'Status','DAILY',1,'2026-08-29T09:00:00.000Z','UTC','2026-08-30T09:30:00.000Z',true,1,${JSON.stringify({ title: 'Status task', workflow_id: ids.workflow, status_id: ids.nonInitialStatus, assignee_ids: [ids.assignee], primary_assignee_id: ids.assignee })}::jsonb,${ids.user})`;
    await expect(generateDueOccurrence({ sql, recurrenceRuleId: statusRule, now: new Date('2026-08-30T09:30:00.000Z') })).resolves.toBe('generated');
    expect((await sql<{ status_id: string }[]>`SELECT status_id FROM tasks WHERE recurrence_rule_id=${statusRule}`)[0].status_id).toBe(ids.nonInitialStatus);
  });

  it('rethrows unrelated unique violations', async () => {
    const duplicateKeyRule = randomUUID();
    await sql`INSERT INTO recurrence_rules(id,workspace_id,name,frequency,interval_value,start_at,timezone,next_run_at,is_active,generated_count,template_snapshot,created_by) VALUES(${duplicateKeyRule},${ids.workspace},'Duplicate key','DAILY',1,'2026-08-29T09:00:00.000Z','UTC','2026-08-30T09:45:00.000Z',true,1,${JSON.stringify({ title: 'Duplicate key', workflow_id: ids.workflow, assignee_ids: [ids.assignee], primary_assignee_id: ids.assignee })}::jsonb,${ids.user})`;
    await sql`INSERT INTO tasks(workspace_id,task_key,title,workflow_id,status_id,creator_id) VALUES(${ids.workspace},'TASK-5','Reserved key',${ids.workflow},${ids.status},${ids.user})`;
    await expect(generateDueOccurrence({ sql, recurrenceRuleId: duplicateKeyRule, now: new Date('2026-08-30T09:45:00.000Z') })).rejects.toMatchObject({ code: '23505' });
    await sql`DELETE FROM tasks WHERE title='Reserved key'`;
  });

  it('returns noop on existing occurrence ledger without duplicate task', async () => {
    const before = (await sql<{ count: string }[]>`SELECT COUNT(*)::text AS count FROM tasks WHERE recurrence_rule_id=${ids.duplicateRule}`)[0].count;
    await expect(generateDueOccurrence({ sql, recurrenceRuleId: ids.duplicateRule, now: new Date('2026-08-30T10:00:00.000Z') })).resolves.toBe('noop');
    const after = (await sql<{ count: string }[]>`SELECT COUNT(*)::text AS count FROM tasks WHERE recurrence_rule_id=${ids.duplicateRule}`)[0].count;
    expect(after).toBe(before);
  });

  it('serializes task-key allocation across due rules', async () => {
    await expect(Promise.all([
      generateDueOccurrence({ sql, recurrenceRuleId: ids.raceRuleA, now: new Date('2026-08-30T11:00:00.000Z') }),
      generateDueOccurrence({ sql, recurrenceRuleId: ids.raceRuleB, now: new Date('2026-08-30T11:00:00.000Z') })
    ])).resolves.toEqual(['generated', 'generated']);
    const keys = await sql<{ task_key: string }[]>`SELECT task_key FROM tasks WHERE recurrence_rule_id IN (${ids.raceRuleA},${ids.raceRuleB}) ORDER BY task_key`;
    expect(new Set(keys.map((row) => row.task_key)).size).toBe(2);
  });

  it('concurrent worker attempts create one occurrence', async () => {
    const ruleId = randomUUID();
    await sql`INSERT INTO recurrence_rules(id,workspace_id,name,frequency,interval_value,start_at,timezone,next_run_at,is_active,generated_count,template_snapshot,created_by) VALUES(${ruleId},${ids.workspace},'Same rule race','DAILY',1,'2026-08-29T09:00:00.000Z','UTC','2026-08-30T11:30:00.000Z',true,1,${JSON.stringify({ title: 'Same rule race', workflow_id: ids.workflow })}::jsonb,${ids.user})`;
    await Promise.all([generateDueOccurrence({ sql, recurrenceRuleId: ruleId, now: new Date('2026-08-30T11:30:00.000Z') }), generateDueOccurrence({ sql, recurrenceRuleId: ruleId, now: new Date('2026-08-30T11:30:00.000Z') })]);
    expect((await sql<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM recurrence_occurrences WHERE recurrence_rule_id=${ruleId}`)[0].count).toBe(1);
  });

  it('two wake-up processors across restart semantics still create one occurrence', async () => {
    const ruleId = randomUUID();
    await sql`INSERT INTO recurrence_rules(id,workspace_id,name,frequency,interval_value,start_at,timezone,next_run_at,is_active,generated_count,template_snapshot,created_by) VALUES(${ruleId},${ids.workspace},'Restart wake-up','DAILY',1,'2026-08-29T09:00:00.000Z','UTC','2026-08-30T11:45:00.000Z',true,1,${JSON.stringify({ title: 'Restart wake-up', workflow_id: ids.workflow })}::jsonb,${ids.user})`;
    const workerA = createRecurrenceWorker({ sql, now: () => new Date('2026-08-30T11:45:00.000Z') });
    const workerB = createRecurrenceWorker({ sql, now: () => new Date('2026-08-30T11:45:00.000Z') });
    await Promise.all([workerA({ data: { recurrence_rule_id: ruleId } } as never), workerB({ data: { recurrence_rule_id: ruleId } } as never)]);
    expect((await sql<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM recurrence_occurrences WHERE recurrence_rule_id=${ruleId}`)[0].count).toBe(1);
  });

  it('concurrent reconciliation callers share one bounded batch', async () => {
    await sql`UPDATE recurrence_rules SET is_active=false`;
    const ruleId = randomUUID();
    await sql`INSERT INTO recurrence_rules(id,workspace_id,name,frequency,interval_value,start_at,timezone,next_run_at,is_active,generated_count,template_snapshot,created_by) VALUES(${ruleId},${ids.workspace},'Concurrent reconciliation','DAILY',1,'2026-08-29T09:00:00.000Z','UTC','2026-08-30T12:00:00.000Z',true,1,${JSON.stringify({ title: 'Concurrent reconciliation', workflow_id: ids.workflow })}::jsonb,${ids.user})`;
    const results = await Promise.all([runReconciliationIteration({ sql, claimSql, now: new Date('2026-08-30T12:00:00.000Z'), batchSize: 1 }), runReconciliationIteration({ sql, claimSql, now: new Date('2026-08-30T12:00:00.000Z'), batchSize: 1 })]);
    expect(results.reduce((total, result) => total + result, 0)).toBe(1);
    expect((await sql<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM recurrence_occurrences WHERE recurrence_rule_id=${ruleId}`)[0].count).toBe(1);
  });

  it('worker ignores stopped and future-rescheduled stale wake-ups', async () => {
    const process = createRecurrenceWorker({ sql, now: () => new Date('2026-08-30T12:00:00.000Z') });
    await expect(process({ data: { recurrence_rule_id: ids.staleStopRule } } as never)).resolves.toBe('noop');
    await expect(process({ data: { recurrence_rule_id: ids.staleFutureRule }, name: 'wake', id: 'stale' } as never)).resolves.toBe('noop');
    expect((await sql<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM tasks WHERE recurrence_rule_id IN (${ids.staleStopRule},${ids.staleFutureRule})`)[0].count).toBe(0);
  });

  it('reconciliation catches up chronologically in bounded passes without duplicates', async () => {
    await sql`UPDATE recurrence_rules SET is_active=false WHERE id<>${ids.catchupRule}`;
    await sql`UPDATE recurrence_rules SET is_active=true,next_run_at='2026-08-28T09:00:00.000Z',generated_count=1 WHERE id=${ids.catchupRule}`;
    const now = new Date('2026-08-31T09:00:00.000Z');
    await expect(runReconciliationIteration({ sql, now, batchSize: 2 })).resolves.toBe(2);
    expect((await sql<{ scheduled_for: string }[]>`SELECT scheduled_for FROM recurrence_occurrences WHERE recurrence_rule_id=${ids.catchupRule} ORDER BY scheduled_for`).map((row) => row.scheduled_for)).toEqual(['2026-08-28 09:00:00+00', '2026-08-29 09:00:00+00']);
    await expect(runReconciliationIteration({ sql, now, batchSize: 2 })).resolves.toBe(2);
    expect((await sql<{ scheduled_for: string }[]>`SELECT scheduled_for FROM recurrence_occurrences WHERE recurrence_rule_id=${ids.catchupRule} ORDER BY scheduled_for`).map((row) => row.scheduled_for)).toEqual(['2026-08-28 09:00:00+00', '2026-08-29 09:00:00+00', '2026-08-30 09:00:00+00', '2026-08-31 09:00:00+00']);
    await expect(runReconciliationIteration({ sql, now, batchSize: 2 })).resolves.toBe(0);
  });

  it('rejects cross-workspace team references', async () => {
    const badRule = randomUUID();
    await sql`INSERT INTO recurrence_rules(id,workspace_id,name,frequency,interval_value,start_at,timezone,next_run_at,is_active,generated_count,template_snapshot,created_by) VALUES(${badRule},${ids.workspace},'Bad Team','DAILY',1,'2026-08-29T09:00:00.000Z','UTC','2026-08-30T12:00:00.000Z',true,1,${JSON.stringify({ title: 'Bad Team', workflow_id: ids.workflow, team_id: ids.badTeam, assignee_ids: [ids.assignee], primary_assignee_id: ids.assignee })}::jsonb,${ids.user})`;
    await expect(generateDueOccurrence({ sql, recurrenceRuleId: badRule, now: new Date('2026-08-30T12:00:00.000Z') })).rejects.toThrow(/TEAM_SCOPE_MISMATCH/);
  });

  it('does not generate future or stopped rules', async () => {
    await sql`UPDATE recurrence_rules SET next_run_at='2026-08-31T09:00:00.000Z' WHERE id=${ids.rule}`;
    await expect(generateDueOccurrence({ sql, recurrenceRuleId: ids.rule, now: new Date('2026-08-30T09:00:00.000Z') })).resolves.toBe('noop');
    await sql`UPDATE recurrence_rules SET is_active=false,next_run_at='2026-08-30T09:00:00.000Z' WHERE id=${ids.rule}`;
    await expect(generateDueOccurrence({ sql, recurrenceRuleId: ids.rule, now: new Date('2026-08-30T09:00:00.000Z') })).resolves.toBe('noop');
  });
});
