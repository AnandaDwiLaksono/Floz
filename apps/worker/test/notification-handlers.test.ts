import { describe, expect, it, vi } from 'vitest';
import { dispatchOutboxBatch } from '../src/outbox-dispatcher.js';
import { buildDueSoonWakeupJobId } from '../src/queues.js';

describe('notification outbox handlers and wake-up scheduling', () => {
  it('handles task.assigned by delegating to createAssignmentNotifications in transaction', async () => {
    const row = {
      id: 'event-1',
      workspace_id: 'ws-1',
      aggregate_id: 'task-1',
      event_type: 'task.assigned',
      payload: { workspaceId: 'ws-1', taskId: 'task-1', addedAssigneeIds: ['user-1'], eventId: 'evt-1' },
      available_at: new Date('2026-08-30T00:00:00.000Z'),
      attempt_count: 1,
      claimed_by: 'dispatcher-1',
      claimed_until: new Date('2026-08-30T00:01:00.000Z')
    };

    const createAssignmentNotifications = vi.fn(async () => {});
    const txMock = {};
    const dbMock = {
      transaction: vi.fn(async (callback: (tx: any) => Promise<any>) => {
        return callback(txMock);
      })
    };
    const queue = { add: vi.fn() };
    const claim = vi.fn(async () => [row]);
    const markDispatched = vi.fn(async () => true);

    const count = await dispatchOutboxBatch({
      db: dbMock as any,
      queue: queue as any,
      claim,
      markDispatched,
      markRetry: vi.fn(),
      createAssignmentNotifications
    });

    expect(count).toBe(1);
    expect(dbMock.transaction).toHaveBeenCalled();
    expect(createAssignmentNotifications).toHaveBeenCalledWith(txMock, row.payload);
    expect(markDispatched).toHaveBeenCalledWith(dbMock, expect.objectContaining({ id: 'event-1' }));
  });

  it('handles task.due_changed with immediate wake-up if due within 24 hours', async () => {
    const now = new Date('2026-08-30T10:00:00.000Z');
    const dueAt = new Date('2026-08-30T18:00:00.000Z').toISOString(); // 8 hours away (< 24h)
    const row = {
      id: 'event-2',
      workspace_id: 'ws-1',
      aggregate_id: 'task-2',
      event_type: 'task.due_changed',
      payload: { taskId: 'task-2', workspaceId: 'ws-1', dueAt, dueVersion: 1 },
      available_at: now,
      attempt_count: 1,
      claimed_by: 'dispatcher-1',
      claimed_until: new Date('2026-08-30T10:01:00.000Z')
    };

    const notificationQueue = { add: vi.fn(async () => {}) };
    const queue = { add: vi.fn() };
    const claim = vi.fn(async () => [row]);
    const markDispatched = vi.fn(async () => true);

    const count = await dispatchOutboxBatch({
      db: {} as any,
      queue: queue as any,
      notificationQueue: notificationQueue as any,
      now,
      claim,
      markDispatched,
      markRetry: vi.fn()
    });

    expect(count).toBe(1);
    const expectedJobId = buildDueSoonWakeupJobId('task-2', 1);
    expect(notificationQueue.add).toHaveBeenCalledWith('due-soon', row.payload, {
      jobId: expectedJobId
    });
  });

  it('handles task.due_changed with delayed wake-up if due > 24 hours away', async () => {
    const now = new Date('2026-08-30T10:00:00.000Z');
    // due in 48 hours: 2026-09-01T10:00:00.000Z
    // targetTime (24h before due) = 2026-08-31T10:00:00.000Z (24 hours after now)
    const dueAt = new Date('2026-09-01T10:00:00.000Z').toISOString();
    const row = {
      id: 'event-3',
      workspace_id: 'ws-1',
      aggregate_id: 'task-3',
      event_type: 'task.due_changed',
      payload: { taskId: 'task-3', workspaceId: 'ws-1', dueAt, dueVersion: 2 },
      available_at: now,
      attempt_count: 1,
      claimed_by: 'dispatcher-1',
      claimed_until: new Date('2026-08-30T10:01:00.000Z')
    };

    const notificationQueue = { add: vi.fn(async () => {}) };
    const queue = { add: vi.fn() };
    const claim = vi.fn(async () => [row]);
    const markDispatched = vi.fn(async () => true);

    const count = await dispatchOutboxBatch({
      db: {} as any,
      queue: queue as any,
      notificationQueue: notificationQueue as any,
      now,
      claim,
      markDispatched,
      markRetry: vi.fn()
    });

    expect(count).toBe(1);
    const expectedJobId = buildDueSoonWakeupJobId('task-3', 2);
    expect(notificationQueue.add).toHaveBeenCalledWith('due-soon', row.payload, {
      jobId: expectedJobId,
      delay: 24 * 60 * 60 * 1000
    });
  });

  it('ignores task.due_changed if dueAt is null or already past due', async () => {
    const now = new Date('2026-08-30T10:00:00.000Z');
    const rowNull = {
      id: 'event-4',
      workspace_id: 'ws-1',
      aggregate_id: 'task-4',
      event_type: 'task.due_changed',
      payload: { taskId: 'task-4', workspaceId: 'ws-1', dueAt: null, dueVersion: 3 },
      available_at: now,
      attempt_count: 1,
      claimed_by: 'dispatcher-1',
      claimed_until: new Date('2026-08-30T10:01:00.000Z')
    };

    const rowPast = {
      id: 'event-5',
      workspace_id: 'ws-1',
      aggregate_id: 'task-5',
      event_type: 'task.due_changed',
      payload: { taskId: 'task-5', workspaceId: 'ws-1', dueAt: '2026-08-30T09:00:00.000Z', dueVersion: 4 },
      available_at: now,
      attempt_count: 1,
      claimed_by: 'dispatcher-1',
      claimed_until: new Date('2026-08-30T10:01:00.000Z')
    };

    const notificationQueue = { add: vi.fn(async () => {}) };
    const queue = { add: vi.fn() };
    const claim = vi.fn(async () => [rowNull, rowPast]);
    const markDispatched = vi.fn(async () => true);

    const count = await dispatchOutboxBatch({
      db: {} as any,
      queue: queue as any,
      notificationQueue: notificationQueue as any,
      now,
      claim,
      markDispatched,
      markRetry: vi.fn()
    });

    expect(count).toBe(2);
    expect(notificationQueue.add).not.toHaveBeenCalled();
  });
});
