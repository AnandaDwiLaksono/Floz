import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, approvalRequests, approvalSteps, comments, mentions } from '../src/index.js';

describe('Phase 10 Approval & Collaboration Schema Exports', () => {
  it('exports approval and collaboration table schemas', () => {
    expect(approvalRequests).toBeDefined();
    expect(approvalSteps).toBeDefined();
    expect(comments).toBeDefined();
    expect(mentions).toBeDefined();
  });
});

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)('Phase 10 Approval & Collaboration DB Constraints Integration', () => {
  const { sql } = databaseUrl ? createDatabase(databaseUrl) : ({} as any);

  let workspaceId: string;
  let userId1: string;
  let userId2: string;
  let roleId: string;

  beforeAll(async () => {
    userId1 = randomUUID();
    userId2 = randomUUID();
    workspaceId = randomUUID();

    await sql`INSERT INTO roles(id, code, name) VALUES (${randomUUID()}, 'ADMIN', 'Admin'), (${randomUUID()}, 'MEMBER', 'Member') ON CONFLICT DO NOTHING`;
    const role = (await sql<{ id: string }[]>`SELECT id FROM roles WHERE code='ADMIN' LIMIT 1`)[0];
    roleId = role.id;

    await sql`INSERT INTO users(id, email, name) VALUES (${userId1}, ${`u1-${userId1}@test.com`}, 'User 1'), (${userId2}, ${`u2-${userId2}@test.com`}, 'User 2')`;
    await sql`INSERT INTO workspaces(id, name, slug, created_by) VALUES (${workspaceId}, 'Test WS', ${`ws-${workspaceId}`}, ${userId1})`;
    await sql`INSERT INTO workspace_memberships(workspace_id, user_id, role_id, status) VALUES (${workspaceId}, ${userId1}, ${roleId}, 'ACTIVE'), (${workspaceId}, ${userId2}, ${roleId}, 'ACTIVE')`;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM mentions WHERE workspace_id=${workspaceId}`;
      await sql`DELETE FROM comments WHERE workspace_id=${workspaceId}`;
      await sql`DELETE FROM approval_steps WHERE workspace_id=${workspaceId}`;
      await sql`DELETE FROM approval_requests WHERE workspace_id=${workspaceId}`;
      await sql`DELETE FROM workflow_transitions WHERE workflow_id IN (SELECT id FROM workflows WHERE workspace_id=${workspaceId})`;
      await sql`DELETE FROM tasks WHERE workspace_id=${workspaceId}`;
      await sql`DELETE FROM task_statuses WHERE workflow_id IN (SELECT id FROM workflows WHERE workspace_id=${workspaceId})`;
      await sql`DELETE FROM workflows WHERE workspace_id=${workspaceId}`;
      await sql`DELETE FROM workspace_memberships WHERE workspace_id=${workspaceId}`;
      await sql`DELETE FROM workspaces WHERE id=${workspaceId}`;
      await sql`DELETE FROM users WHERE id IN (${userId1}, ${userId2})`;
      await sql.end();
    }
  });

  it('rejects duplicate step_order on the same approval_request_id', async () => {
    const reqId = randomUUID();
    await sql`INSERT INTO approval_requests(id, workspace_id, requester_id, title, status) VALUES (${reqId}, ${workspaceId}, ${userId1}, 'Test Approval', 'PENDING')`;
    await sql`INSERT INTO approval_steps(id, workspace_id, approval_request_id, step_order, approver_user_id, status) VALUES (${randomUUID()}, ${workspaceId}, ${reqId}, 1, ${userId2}, 'PENDING')`;

    await expect(
      sql`INSERT INTO approval_steps(id, workspace_id, approval_request_id, step_order, approver_user_id, status) VALUES (${randomUUID()}, ${workspaceId}, ${reqId}, 1, ${userId2}, 'PENDING')`
    ).rejects.toThrow();
  });

  it('rejects duplicate mention of same user on the same comment', async () => {
    const taskId = randomUUID();
    const defaultWorkflow = (await sql<{ id: string }[]>`SELECT id FROM workflows WHERE workspace_id=${workspaceId} LIMIT 1`)[0]
      || (await sql<{ id: string }[]>`INSERT INTO workflows(id, workspace_id, code, name, is_default, created_by) VALUES (${randomUUID()}, ${workspaceId}, 'DEF', 'Default', true, ${userId1}) RETURNING id`)[0];
    const defaultStatus = (await sql<{ id: string }[]>`SELECT id FROM task_statuses WHERE workflow_id=${defaultWorkflow.id} LIMIT 1`)[0]
      || (await sql<{ id: string }[]>`INSERT INTO task_statuses(id, workflow_id, code, name, category, position) VALUES (${randomUUID()}, ${defaultWorkflow.id}, 'TODO', 'Todo', 'TODO', 1) RETURNING id`)[0];

    await sql`INSERT INTO tasks(id, workspace_id, task_key, title, workflow_id, status_id, creator_id) VALUES (${taskId}, ${workspaceId}, 'TSK-100', 'Task 100', ${defaultWorkflow.id}, ${defaultStatus.id}, ${userId1})`;

    const commentId = randomUUID();
    await sql`INSERT INTO comments(id, workspace_id, task_id, author_id, content) VALUES (${commentId}, ${workspaceId}, ${taskId}, ${userId1}, 'Hello @user2')`;
    await sql`INSERT INTO mentions(id, workspace_id, comment_id, mentioned_user_id) VALUES (${randomUUID()}, ${workspaceId}, ${commentId}, ${userId2})`;

    await expect(
      sql`INSERT INTO mentions(id, workspace_id, comment_id, mentioned_user_id) VALUES (${randomUUID()}, ${workspaceId}, ${commentId}, ${userId2})`
    ).rejects.toThrow();
  });
});
