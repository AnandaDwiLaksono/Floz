import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '@floz/database';
import { generateDueOccurrence } from '../src/generate-due-occurrence.js';

describe('recurrence generation integration', () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const { sql } = createDatabase(databaseUrl);
  const ids = { user: randomUUID(), workspace: randomUUID(), role: randomUUID(), workflow: randomUUID(), status: randomUUID(), rule: randomUUID() };

  beforeAll(async () => {
    await sql`INSERT INTO roles(id,code,name) VALUES(${ids.role},'REC','Recurrence')`;
    await sql`INSERT INTO users(id,email,name) VALUES(${ids.user},${`${ids.user}@example.test`},'Recurrence User')`;
    await sql`INSERT INTO workspaces(id,name,slug,created_by) VALUES(${ids.workspace},'Recurrence',${`recurrence-${ids.workspace}`},${ids.user})`;
    await sql`INSERT INTO workspace_memberships(workspace_id,user_id,role_id) VALUES(${ids.workspace},${ids.user},${ids.role})`;
    await sql`INSERT INTO workflows(id,workspace_id,code,name,is_default,created_by) VALUES(${ids.workflow},${ids.workspace},'REC','Recurrence',true,${ids.user})`;
    await sql`INSERT INTO task_statuses(id,workflow_id,code,name,category,position,is_initial) VALUES(${ids.status},${ids.workflow},'TODO','To do','OPEN',1,true)`;
    await sql`INSERT INTO recurrence_rules(id,workspace_id,name,frequency,interval_value,start_at,timezone,next_run_at,is_active,generated_count,template_snapshot,created_by) VALUES(${ids.rule},${ids.workspace},'Daily','DAILY',1,'2026-08-29T09:00:00.000Z','UTC','2026-08-30T09:00:00.000Z',true,1,${JSON.stringify({ title: 'Generated', description: 'Canonical', workflow_id: ids.workflow, priority: 'HIGH', assignee_ids: [ids.user], primary_assignee_id: ids.user })}::jsonb,${ids.user})`;
  });

  afterAll(async () => { await sql.end(); });

  it('generates exactly one canonical occurrence for a due rule', async () => {
    await expect(generateDueOccurrence({ sql, recurrenceRuleId: ids.rule, now: new Date('2026-08-30T09:00:00.000Z') })).resolves.toBe('generated');
    await expect(generateDueOccurrence({ sql, recurrenceRuleId: ids.rule, now: new Date('2026-08-30T09:00:00.000Z') })).resolves.toBe('noop');

    const tasks = await sql<{ recurrence_rule_id: string; title: string; priority: string; start_at: Date }[]>`SELECT recurrence_rule_id,title,priority,start_at FROM tasks WHERE recurrence_rule_id=${ids.rule}`;
    expect(tasks).toEqual([{ recurrence_rule_id: ids.rule, title: 'Generated', priority: 'HIGH', start_at: '2026-08-30 09:00:00+00' }]);
    expect(await sql`SELECT * FROM recurrence_occurrences WHERE recurrence_rule_id=${ids.rule}`).toHaveLength(1);
    expect(await sql`SELECT * FROM task_assignees WHERE task_id=(SELECT id FROM tasks WHERE recurrence_rule_id=${ids.rule})`).toHaveLength(1);
    expect((await sql<{ event_type: string; metadata: { recurrence_rule_id: string } }[]>`SELECT event_type,metadata FROM task_history WHERE task_id=(SELECT id FROM tasks WHERE recurrence_rule_id=${ids.rule})`)[0]).toMatchObject({ event_type: 'RECURRING_GENERATED', metadata: { recurrence_rule_id: ids.rule } });
    expect((await sql<{ next_run_at: Date; generated_count: number }[]>`SELECT next_run_at,generated_count FROM recurrence_rules WHERE id=${ids.rule}`)[0]).toMatchObject({ next_run_at: '2026-08-31 09:00:00+00', generated_count: 2 });
    expect(await sql`SELECT * FROM outbox_events WHERE aggregate_id=${ids.rule} AND status='PENDING'`).toHaveLength(1);
  });

  it('does not generate future or stopped rules', async () => {
    await sql`UPDATE recurrence_rules SET next_run_at='2026-08-31T09:00:00.000Z' WHERE id=${ids.rule}`;
    await expect(generateDueOccurrence({ sql, recurrenceRuleId: ids.rule, now: new Date('2026-08-30T09:00:00.000Z') })).resolves.toBe('noop');
    await sql`UPDATE recurrence_rules SET is_active=false,next_run_at='2026-08-30T09:00:00.000Z' WHERE id=${ids.rule}`;
    await expect(generateDueOccurrence({ sql, recurrenceRuleId: ids.rule, now: new Date('2026-08-30T09:00:00.000Z') })).resolves.toBe('noop');
  });
});
