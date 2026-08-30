import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, createTaskRecordTx, createTaskAssigneesTx, patchTaskRecordTx, patchTaskAssigneesTx, validateTaskTemplateReferences } from '../src/index.js';

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)('task core outbox & due versioning integration', () => {
  const { sql } = databaseUrl ? createDatabase(databaseUrl) : ({} as any);

  let workspaceId: string;
  let userId1: string;
  let userId2: string;
  let workflowId: string;
  let statusId: string;
  let roleId: string;

  beforeAll(async () => {
    userId1 = randomUUID();
    userId2 = randomUUID();
    workspaceId = randomUUID();

    const role = (await sql<{ id: string }[]>`SELECT id FROM roles WHERE code='ADMIN' LIMIT 1`)[0];
    roleId = role?.id ?? randomUUID();
    if (!role) {
      await sql`INSERT INTO roles(id, code, name) VALUES (${roleId}, 'ADMIN', 'Admin') ON CONFLICT DO NOTHING`;
    }

    await sql`INSERT INTO users(id, email, name) VALUES (${userId1}, ${`u1-${userId1}@test.com`}, 'User 1'), (${userId2}, ${`u2-${userId2}@test.com`}, 'User 2')`;
    await sql`INSERT INTO workspaces(id, name, slug, created_by) VALUES (${workspaceId}, 'Test WS', ${`ws-${workspaceId}`}, ${userId1})`;
    await sql`INSERT INTO workspace_memberships(workspace_id, user_id, role_id, status) VALUES (${workspaceId}, ${userId1}, ${roleId}, 'ACTIVE'), (${workspaceId}, ${userId2}, ${roleId}, 'ACTIVE')`;

    const defaultWorkflow = (await sql<{ id: string }[]>`SELECT id FROM workflows WHERE workspace_id=${workspaceId} LIMIT 1`)[0];
    workflowId = defaultWorkflow.id;
    const status = (await sql<{ id: string }[]>`SELECT id FROM task_statuses WHERE workflow_id=${workflowId} LIMIT 1`)[0];
    statusId = status.id;
  });

  afterAll(async () => {
    await sql`DELETE FROM outbox_events WHERE workspace_id=${workspaceId}`;
    await sql`DELETE FROM task_assignees WHERE task_id IN (SELECT id FROM tasks WHERE workspace_id=${workspaceId})`;
    await sql`DELETE FROM tasks WHERE workspace_id=${workspaceId}`;
    await sql`DELETE FROM task_statuses WHERE workflow_id=${workflowId}`;
    await sql`DELETE FROM workflows WHERE workspace_id=${workspaceId}`;
    await sql`DELETE FROM workspace_memberships WHERE workspace_id=${workspaceId}`;
    await sql`DELETE FROM workspaces WHERE id=${workspaceId}`;
    await sql`DELETE FROM users WHERE id IN (${userId1}, ${userId2})`;
    await sql.end();
  });

  it('createTask emits task.due_changed when due_at is provided', async () => {
    const dueAt = new Date(Date.now() + 3600000).toISOString();
    let taskId = '';
    await sql.begin(async (tx) => {
      const workflow = await validateTaskTemplateReferences(tx, workspaceId, { title: 'Test Task' });
      const task = await createTaskRecordTx(tx, workspaceId, userId1, { title: 'Test Task', due_at: dueAt }, workflow);
      taskId = task.id;
    });

    const events = await sql<{ event_type: string; payload: any }[]>`SELECT event_type, payload FROM outbox_events WHERE workspace_id=${workspaceId} AND aggregate_id=${taskId}`;
    expect(events.length).toBe(1);
    expect(events[0].event_type).toBe('task.due_changed');
    expect(events[0].payload.dueVersion).toBe(0);
    expect(events[0].payload.dueAt).toBe(new Date(dueAt).toISOString());
  });

  it('createTaskAssigneesTx emits task.assigned outbox event', async () => {
    let taskId = '';
    await sql.begin(async (tx) => {
      const workflow = await validateTaskTemplateReferences(tx, workspaceId, { title: 'Task for Assign' });
      const task = await createTaskRecordTx(tx, workspaceId, userId1, { title: 'Task for Assign' }, workflow);
      taskId = task.id;
      await createTaskAssigneesTx(tx, workspaceId, taskId, userId1, [{ user_id: userId1, is_primary: true }]);
    });

    const events = await sql<{ event_type: string; payload: any }[]>`SELECT event_type, payload FROM outbox_events WHERE workspace_id=${workspaceId} AND aggregate_id=${taskId} AND event_type='task.assigned'`;
    expect(events.length).toBe(1);
    expect(events[0].payload.addedAssigneeIds).toEqual([userId1]);
    expect(events[0].payload.eventId).toBeDefined();
  });

  it('patchTaskRecordTx increments dueVersion and emits task.due_changed when dueAt distinctly changes', async () => {
    let taskId = '';
    const initialDue = new Date('2026-09-01T10:00:00Z').toISOString();
    await sql.begin(async (tx) => {
      const workflow = await validateTaskTemplateReferences(tx, workspaceId, { title: 'Patch Task' });
      const task = await createTaskRecordTx(tx, workspaceId, userId1, { title: 'Patch Task', due_at: initialDue }, workflow);
      taskId = task.id;
    });

    // 1. Same dueAt -> no dueVersion increment, no new outbox event
    await sql.begin(async (tx) => {
      await patchTaskRecordTx(tx, workspaceId, userId1, taskId, { due_at: initialDue, version: 1 });
    });
    let taskRow = (await sql<{ due_version: number; version: number }[]>`SELECT due_version, version FROM tasks WHERE id=${taskId}`)[0];
    expect(taskRow.due_version).toBe(0);
    expect(taskRow.version).toBe(2);

    let dueEvents = await sql<{ event_type: string }[]>`SELECT event_type FROM outbox_events WHERE workspace_id=${workspaceId} AND aggregate_id=${taskId} AND event_type='task.due_changed'`;
    expect(dueEvents.length).toBe(1); // Only the creation event

    // 2. Distinct dueAt -> dueVersion increments to 1, emits task.due_changed
    const newDue = new Date('2026-09-02T10:00:00Z').toISOString();
    await sql.begin(async (tx) => {
      await patchTaskRecordTx(tx, workspaceId, userId1, taskId, { due_at: newDue, version: 2 });
    });
    taskRow = (await sql<{ due_version: number; version: number }[]>`SELECT due_version, version FROM tasks WHERE id=${taskId}`)[0];
    expect(taskRow.due_version).toBe(1);
    expect(taskRow.version).toBe(3);

    dueEvents = await sql<{ event_type: string; payload: any }[]>`SELECT event_type, payload FROM outbox_events WHERE workspace_id=${workspaceId} AND aggregate_id=${taskId} AND event_type='task.due_changed' ORDER BY created_at ASC`;
    expect(dueEvents.length).toBe(2);
    expect(dueEvents[1].payload.dueVersion).toBe(1);
    expect(dueEvents[1].payload.dueAt).toBe(new Date(newDue).toISOString());
  });

  it('patchTaskAssigneesTx calculates addedAssigneeIds and emits task.assigned', async () => {
    let taskId = '';
    await sql.begin(async (tx) => {
      const workflow = await validateTaskTemplateReferences(tx, workspaceId, { title: 'Patch Assignees Task' });
      const task = await createTaskRecordTx(tx, workspaceId, userId1, { title: 'Patch Assignees Task' }, workflow);
      taskId = task.id;
      await createTaskAssigneesTx(tx, workspaceId, taskId, userId1, [{ user_id: userId1 }]);
    });

    // Replace assignees with [userId1, userId2] -> addedAssigneeIds is [userId2]
    await sql.begin(async (tx) => {
      await patchTaskAssigneesTx(tx, workspaceId, userId1, taskId, { version: 1, assignees: [{ user_id: userId1 }, { user_id: userId2 }] });
    });

    const assignEvents = await sql<{ payload: any }[]>`SELECT payload FROM outbox_events WHERE workspace_id=${workspaceId} AND aggregate_id=${taskId} AND event_type='task.assigned' ORDER BY created_at ASC`;
    expect(assignEvents.length).toBe(2);
    expect(assignEvents[1].payload.addedAssigneeIds).toEqual([userId2]);
  });
});
