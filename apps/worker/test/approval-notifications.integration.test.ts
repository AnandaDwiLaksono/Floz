import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase, claimOutboxBatch, markOutboxDispatched, markOutboxRetry } from '@floz/database';
import { dispatchOutboxBatch } from '../src/outbox-dispatcher.js';

describe('Task 5 — Approval & Mention Outbox Worker Notification Handlers', () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL required');
  const { sql } = createDatabase(databaseUrl);

  let workspaceId: string;
  let userA: string;
  let userB: string;
  let adminUser: string;
  let taskId: string;

  beforeAll(async () => {
    await sql`TRUNCATE workspaces, users, tasks, outbox_events, notifications, notification_dedup_ledger RESTART IDENTITY CASCADE`;

    workspaceId = randomUUID();
    userA = randomUUID(); // Requester or Author
    userB = randomUUID(); // Approver or Mentioned User
    adminUser = randomUUID(); // Admin overriding
    taskId = randomUUID();

    await sql`INSERT INTO users (id, email, name) VALUES
      (${userA}, 'usera@example.com', 'User A'),
      (${userB}, 'userb@example.com', 'User B'),
      (${adminUser}, 'admin@example.com', 'Admin User')`;

    await sql`INSERT INTO workspaces (id, name, slug, created_by) VALUES (${workspaceId}, 'Test WS', 'test-ws', ${userA})`;

    // Minimal task setup for foreign key references if needed
    const wf = (await sql<{ id: string }[]>`INSERT INTO workflows (workspace_id, code, name, is_default, is_active, created_by) VALUES (${workspaceId}, 'DEF', 'Default', true, true, ${userA}) RETURNING id`)[0].id;
    const st = (await sql<{ id: string }[]>`INSERT INTO task_statuses (workflow_id, code, name, category, position, is_initial) VALUES (${wf}, 'TODO', 'To Do', 'TODO', 1, true) RETURNING id`)[0].id;
    await sql`INSERT INTO tasks (id, workspace_id, task_key, title, workflow_id, status_id, creator_id) VALUES (${taskId}, ${workspaceId}, 'TSK-1', 'Notification Task', ${wf}, ${st}, ${userA})`;
  });

  afterAll(async () => {
    await sql.end();
  });

  it('handles approval.requested and maps to assigned approver', async () => {
    const approvalRequestId = randomUUID();
    const payload = { approval_request_id: approvalRequestId, step_id: randomUUID(), approver_user_id: userB, requester_id: userA, title: 'Please approve this' };
    const inserted = await sql<{ id: string }[]>`INSERT INTO outbox_events(workspace_id, aggregate_type, aggregate_id, event_type, payload, status, available_at) VALUES (${workspaceId}, 'approval_request', ${approvalRequestId}, 'approval.requested', ${JSON.stringify(payload)}::jsonb, 'PENDING', NOW()) RETURNING id`;

    const dispatched = await dispatchOutboxBatch({ db: sql, queue: { add: vi.fn() } as unknown as import('bullmq').Queue, now: new Date(), claim: claimOutboxBatch, markDispatched: markOutboxDispatched, markRetry: markOutboxRetry });
    expect(dispatched).toBe(1);

    const notifications = await sql`SELECT * FROM notifications WHERE entity_id = ${approvalRequestId}`;
    expect(notifications.length).toBe(1);
    expect(notifications[0].user_id).toBe(userB); // target is approver
    expect(notifications[0].type).toBe('APPROVAL_REQUESTED');
    expect(notifications[0].entity_type).toBe('APPROVAL_REQUEST');

    // Idempotency / replay deduplication check
    await sql`UPDATE outbox_events SET status='PENDING', dispatched_at=NULL, claimed_by=NULL, claimed_until=NULL WHERE id=${inserted[0].id}`;
    const redispatched = await dispatchOutboxBatch({ db: sql, queue: { add: vi.fn() } as unknown as import('bullmq').Queue, now: new Date(), claim: claimOutboxBatch, markDispatched: markOutboxDispatched, markRetry: markOutboxRetry });
    expect(redispatched).toBe(1);

    const reNotifications = await sql`SELECT * FROM notifications WHERE entity_id = ${approvalRequestId}`;
    expect(reNotifications.length).toBe(1); // STILL 1

    // Verify dedup ledger
    const dedups = await sql`SELECT * FROM notification_dedup_ledger WHERE dedup_key = ${`approval-requested-${approvalRequestId}`}`;
    expect(dedups.length).toBe(1);
  });

  it('handles approval.decided (APPROVED) and maps to requester, including actor metadata', async () => {
    const approvalRequestId = randomUUID();
    // userA requested, adminUser decided (ADMIN override)
    const payload = { approval_request_id: approvalRequestId, step_id: randomUUID(), decision: 'APPROVED', requester_id: userA, decided_by_user_id: adminUser, reason: 'Looks good' };
    await sql<{ id: string }[]>`INSERT INTO outbox_events(workspace_id, aggregate_type, aggregate_id, event_type, payload, status, available_at) VALUES (${workspaceId}, 'approval_request', ${approvalRequestId}, 'approval.decided', ${JSON.stringify(payload)}::jsonb, 'PENDING', NOW()) RETURNING id`;

    const dispatched = await dispatchOutboxBatch({ db: sql, queue: { add: vi.fn() } as unknown as import('bullmq').Queue, now: new Date(), claim: claimOutboxBatch, markDispatched: markOutboxDispatched, markRetry: markOutboxRetry });
    expect(dispatched).toBe(1);

    const notifications = await sql<{ user_id: string; type: string; title: string; body: string; entity_type: string; entity_id: string }[]>`SELECT * FROM notifications WHERE entity_id = ${approvalRequestId} AND type = 'APPROVAL_APPROVED'`;
    expect(notifications.length).toBe(1);
    expect(notifications[0].user_id).toBe(userA); // target is requester
    expect(notifications[0].type).toBe('APPROVAL_APPROVED');
    expect(notifications[0].entity_type).toBe('APPROVAL_REQUEST');
    expect(notifications[0].entity_id).toBe(approvalRequestId);

    // Check outbox event payload retains decided_by_user_id
    const outbox = (await sql<{ payload: { decided_by_user_id: string; approval_request_id: string } }[]>`SELECT payload FROM outbox_events WHERE aggregate_id = ${approvalRequestId}`)[0];
    expect(outbox.payload.decided_by_user_id).toBe(adminUser);
    expect(outbox.payload.approval_request_id).toBe(approvalRequestId);

    // Check dedup ledger
    const dedups = await sql`SELECT * FROM notification_dedup_ledger WHERE dedup_key = ${`approval-approved-${approvalRequestId}`}`;
    expect(dedups.length).toBe(1);
  });

  it('handles approval.decided (REJECTED) and maps to requester', async () => {
    const approvalRequestId = randomUUID();
    const payload = { approval_request_id: approvalRequestId, step_id: randomUUID(), decision: 'REJECTED', requester_id: userA, decided_by_user_id: adminUser, reason: 'Not compliant' };
    await sql<{ id: string }[]>`INSERT INTO outbox_events(workspace_id, aggregate_type, aggregate_id, event_type, payload, status, available_at) VALUES (${workspaceId}, 'approval_request', ${approvalRequestId}, 'approval.decided', ${JSON.stringify(payload)}::jsonb, 'PENDING', NOW()) RETURNING id`;

    const dispatched = await dispatchOutboxBatch({ db: sql, queue: { add: vi.fn() } as unknown as import('bullmq').Queue, now: new Date(), claim: claimOutboxBatch, markDispatched: markOutboxDispatched, markRetry: markOutboxRetry });
    expect(dispatched).toBe(1);

    const notifications = await sql<{ user_id: string; type: string; title: string; body: string; entity_type: string; entity_id: string }[]>`SELECT * FROM notifications WHERE entity_id = ${approvalRequestId} AND type = 'APPROVAL_REJECTED'`;
    expect(notifications.length).toBe(1);
    expect(notifications[0].user_id).toBe(userA);
    expect(notifications[0].type).toBe('APPROVAL_REJECTED');
    expect(notifications[0].entity_type).toBe('APPROVAL_REQUEST');
    expect(notifications[0].entity_id).toBe(approvalRequestId);

    const outbox = (await sql<{ payload: { decided_by_user_id: string; approval_request_id: string } }[]>`SELECT payload FROM outbox_events WHERE aggregate_id = ${approvalRequestId}`)[0];
    expect(outbox.payload.decided_by_user_id).toBe(adminUser);
  });

  it('handles approval.cancelled and maps to assigned approver, including actor metadata', async () => {
    const approvalRequestId = randomUUID();
    const payload = { approval_request_id: approvalRequestId, approver_user_id: userB, cancelled_by_user_id: adminUser, cancel_reason: 'No longer needed' };
    await sql<{ id: string }[]>`INSERT INTO outbox_events(workspace_id, aggregate_type, aggregate_id, event_type, payload, status, available_at) VALUES (${workspaceId}, 'approval_request', ${approvalRequestId}, 'approval.cancelled', ${JSON.stringify(payload)}::jsonb, 'PENDING', NOW()) RETURNING id`;

    const dispatched = await dispatchOutboxBatch({ db: sql, queue: { add: vi.fn() } as unknown as import('bullmq').Queue, now: new Date(), claim: claimOutboxBatch, markDispatched: markOutboxDispatched, markRetry: markOutboxRetry });
    expect(dispatched).toBe(1);

    const notifications = await sql<{ user_id: string; type: string; title: string; body: string; entity_type: string; entity_id: string }[]>`SELECT * FROM notifications WHERE entity_id = ${approvalRequestId} AND type = 'APPROVAL_CANCELLED'`;
    expect(notifications.length).toBe(1);
    expect(notifications[0].user_id).toBe(userB);
    expect(notifications[0].type).toBe('APPROVAL_CANCELLED');
    expect(notifications[0].entity_type).toBe('APPROVAL_REQUEST');
    expect(notifications[0].entity_id).toBe(approvalRequestId);

    const outbox = (await sql<{ payload: { cancelled_by_user_id: string; approval_request_id: string } }[]>`SELECT payload FROM outbox_events WHERE aggregate_id = ${approvalRequestId}`)[0];
    expect(outbox.payload.cancelled_by_user_id).toBe(adminUser);
  });

  it('handles comment.mentioned and maps to mentioned user exactly', async () => {
    const commentId = randomUUID();
    const payload = { comment_id: commentId, task_id: taskId, mentioned_user_id: userB, author_id: userA };
    const inserted = await sql<{ id: string }[]>`INSERT INTO outbox_events(workspace_id, aggregate_type, aggregate_id, event_type, payload, status, available_at) VALUES (${workspaceId}, 'comment', ${commentId}, 'comment.mentioned', ${JSON.stringify(payload)}::jsonb, 'PENDING', NOW()) RETURNING id`;

    const dispatched = await dispatchOutboxBatch({ db: sql, queue: { add: vi.fn() } as unknown as import('bullmq').Queue, now: new Date(), claim: claimOutboxBatch, markDispatched: markOutboxDispatched, markRetry: markOutboxRetry });
    expect(dispatched).toBe(1);

    const notifications = await sql`SELECT * FROM notifications WHERE entity_id = ${taskId} AND type = 'COMMENT_MENTIONED'`;
    expect(notifications.length).toBe(1);
    expect(notifications[0].user_id).toBe(userB); // target is mentioned user
    expect(notifications[0].entity_type).toBe('TASK');

    // Replay deduplication check
    await sql`UPDATE outbox_events SET status='PENDING', dispatched_at=NULL, claimed_by=NULL, claimed_until=NULL WHERE id=${inserted[0].id}`;
    const redispatched = await dispatchOutboxBatch({ db: sql, queue: { add: vi.fn() } as unknown as import('bullmq').Queue, now: new Date(), claim: claimOutboxBatch, markDispatched: markOutboxDispatched, markRetry: markOutboxRetry });
    expect(redispatched).toBe(1);

    const reNotifications = await sql`SELECT * FROM notifications WHERE entity_id = ${taskId} AND type = 'COMMENT_MENTIONED'`;
    expect(reNotifications.length).toBe(1); // STILL 1

    const dedups = await sql`SELECT * FROM notification_dedup_ledger WHERE dedup_key = ${`comment-mention-${commentId}-${userB}`}`;
    expect(dedups.length).toBe(1);
  });
});
