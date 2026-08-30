import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, createAssignmentNotifications, createDueSoonNotifications, createOverdueNotifications } from '../src/index.js';

describe('notification core integration', () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const { db, sql } = createDatabase(databaseUrl);

  let workspaceId: string;
  let userId1: string;
  let userId2: string;
  let workflowId: string;
  let activeStatusId: string;
  let terminalStatusId: string;
  let roleId: string;

  beforeAll(async () => {
    // Setup clean workspace, users
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
    
    // Automatically seeded by trigger
    const defaultWorkflow = (await sql<{ id: string }[]>`SELECT id FROM workflows WHERE workspace_id=${workspaceId} LIMIT 1`)[0];
    workflowId = defaultWorkflow.id;
    const statuses = await sql<{ id: string; code: string; is_terminal: boolean }[]>`SELECT id, code, is_terminal FROM task_statuses WHERE workflow_id=${workflowId}`;
    activeStatusId = statuses.find((s) => !s.is_terminal)!.id;
    terminalStatusId = statuses.find((s) => s.is_terminal)!.id;
  });

  afterAll(async () => {
    // Clean up
    await sql`DELETE FROM notifications WHERE workspace_id=${workspaceId}`;
    await sql`DELETE FROM notification_dedup_ledger WHERE workspace_id=${workspaceId}`;
    await sql`DELETE FROM task_assignees WHERE task_id IN (SELECT id FROM tasks WHERE workspace_id=${workspaceId})`;
    await sql`DELETE FROM tasks WHERE workspace_id=${workspaceId}`;
    await sql`DELETE FROM workflow_transitions WHERE workflow_id=${workflowId}`;
    await sql`DELETE FROM task_statuses WHERE workflow_id=${workflowId}`;
    await sql`DELETE FROM workflows WHERE workspace_id=${workspaceId}`;
    await sql`DELETE FROM workspace_memberships WHERE workspace_id=${workspaceId}`;
    await sql`DELETE FROM workspaces WHERE id=${workspaceId}`;
    await sql`DELETE FROM users WHERE id IN (${userId1}, ${userId2})`;
    await sql.end();
  });

  it('createAssignmentNotifications: concurrent executions produce exactly 1 notification per assignee', async () => {
    const taskId = randomUUID();
    await sql`INSERT INTO tasks(id, workspace_id, task_key, title, workflow_id, status_id, creator_id)
      VALUES (${taskId}, ${workspaceId}, 'TASK-1', 'Assignment Test Task', ${workflowId}, ${activeStatusId}, ${userId1})`;
    await sql`INSERT INTO task_assignees(task_id, user_id, assigned_by) VALUES (${taskId}, ${userId1}, ${userId1}), (${taskId}, ${userId2}, ${userId1})`;

    const eventId = randomUUID();

    // Run concurrently twice
    await Promise.all([
      db.transaction(async (tx) => {
        await createAssignmentNotifications(tx, {
          workspaceId,
          taskId,
          addedAssigneeIds: [userId1, userId2],
          eventId
        });
      }),
      db.transaction(async (tx) => {
        await createAssignmentNotifications(tx, {
          workspaceId,
          taskId,
          addedAssigneeIds: [userId1, userId2],
          eventId
        });
      })
    ]);

    const notifs = await sql`SELECT * FROM notifications WHERE workspace_id=${workspaceId} AND entity_id=${taskId}`;
    expect(notifs.length).toBe(2); // 1 for userId1, 1 for userId2
    const user1Notifs = notifs.filter((n) => n.user_id === userId1);
    const user2Notifs = notifs.filter((n) => n.user_id === userId2);
    expect(user1Notifs.length).toBe(1);
    expect(user2Notifs.length).toBe(1);
  });

  it('createDueSoonNotifications: respects terminal status, dueVersion, and time condition with dedup', async () => {
    const taskId = randomUUID();
    const futureDue = new Date(Date.now() + 1000 * 3600).toISOString(); // 1 hour in future
    await sql`INSERT INTO tasks(id, workspace_id, task_key, title, workflow_id, status_id, creator_id, due_at, due_version)
      VALUES (${taskId}, ${workspaceId}, 'TASK-2', 'Due Soon Test Task', ${workflowId}, ${activeStatusId}, ${userId1}, ${futureDue}, 1)`;
    await sql`INSERT INTO task_assignees(task_id, user_id, assigned_by) VALUES (${taskId}, ${userId1}, ${userId1})`;

    // 1. Wrong expectedDueVersion -> 0 notifications
    await db.transaction(async (tx) => {
      await createDueSoonNotifications(tx, { workspaceId, taskId, expectedDueVersion: 2 });
    });
    let notifs = await sql`SELECT * FROM notifications WHERE workspace_id=${workspaceId} AND entity_id=${taskId}`;
    expect(notifs.length).toBe(0);

    // 2. Correct expectedDueVersion -> 1 notification
    await db.transaction(async (tx) => {
      await createDueSoonNotifications(tx, { workspaceId, taskId, expectedDueVersion: 1 });
    });
    notifs = await sql`SELECT * FROM notifications WHERE workspace_id=${workspaceId} AND entity_id=${taskId}`;
    expect(notifs.length).toBe(1);

    // 3. Repeated call (concurrent or duplicate) -> still 1 notification
    await db.transaction(async (tx) => {
      await createDueSoonNotifications(tx, { workspaceId, taskId, expectedDueVersion: 1 });
    });
    notifs = await sql`SELECT * FROM notifications WHERE workspace_id=${workspaceId} AND entity_id=${taskId}`;
    expect(notifs.length).toBe(1);

    // 4. Terminal status -> skipped
    const terminalTaskId = randomUUID();
    await sql`INSERT INTO tasks(id, workspace_id, task_key, title, workflow_id, status_id, creator_id, due_at, due_version)
      VALUES (${terminalTaskId}, ${workspaceId}, 'TASK-3', 'Terminal Task', ${workflowId}, ${terminalStatusId}, ${userId1}, ${futureDue}, 1)`;
    await sql`INSERT INTO task_assignees(task_id, user_id, assigned_by) VALUES (${terminalTaskId}, ${userId1}, ${userId1})`;

    await db.transaction(async (tx) => {
      await createDueSoonNotifications(tx, { workspaceId, taskId: terminalTaskId, expectedDueVersion: 1 });
    });
    const terminalNotifs = await sql`SELECT * FROM notifications WHERE workspace_id=${workspaceId} AND entity_id=${terminalTaskId}`;
    expect(terminalNotifs.length).toBe(0);
  });

  it('createOverdueNotifications: fires only when now > dueAt and dedups', async () => {
    const taskId = randomUUID();
    const pastDue = new Date(Date.now() - 1000 * 3600).toISOString(); // 1 hour ago
    await sql`INSERT INTO tasks(id, workspace_id, task_key, title, workflow_id, status_id, creator_id, due_at, due_version)
      VALUES (${taskId}, ${workspaceId}, 'TASK-4', 'Overdue Test Task', ${workflowId}, ${activeStatusId}, ${userId1}, ${pastDue}, 1)`;
    await sql`INSERT INTO task_assignees(task_id, user_id, assigned_by) VALUES (${taskId}, ${userId1}, ${userId1})`;

    // Run concurrently twice
    await Promise.all([
      db.transaction(async (tx) => {
        await createOverdueNotifications(tx, { workspaceId, taskId, expectedDueVersion: 1 });
      }),
      db.transaction(async (tx) => {
        await createOverdueNotifications(tx, { workspaceId, taskId, expectedDueVersion: 1 });
      })
    ]);

    const notifs = await sql`SELECT * FROM notifications WHERE workspace_id=${workspaceId} AND entity_id=${taskId} AND type='TASK_OVERDUE'`;
    expect(notifs.length).toBe(1);
  });
});
