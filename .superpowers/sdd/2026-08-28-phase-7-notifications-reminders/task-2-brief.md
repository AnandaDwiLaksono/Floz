### Task 2: Notification Primitives & CTE Implementation

**Files:**
- Create: `database/src/notification-core.ts`
- Modify: `database/src/index.ts`
- Create: `database/test/notification-core.integration.test.ts` (or `apps/worker/test/notification-core.integration.test.ts`)

**Interfaces:**
- Produces: `createAssignmentNotifications(tx, params)`, `createDueSoonNotifications(tx, params)`, `createOverdueNotifications(tx, params)`

**Requirements & Specifications:**
1. In `database/src/notification-core.ts`:
   - Implement an atomic CTE execution using Drizzle's `sql` template for inserting into `notification_dedup_ledger` and `notifications`:
     ```sql
     WITH inserted_dedup AS (
       INSERT INTO notification_dedup_ledger (id, workspace_id, dedup_key, notification_id, created_at)
       VALUES (${ledgerId}, ${workspaceId}, ${dedupKey}, ${notificationId}, NOW())
       ON CONFLICT (workspace_id, dedup_key) DO NOTHING
       RETURNING notification_id
     )
     INSERT INTO notifications (id, workspace_id, user_id, type, title, body, entity_type, entity_id, is_read, created_at)
     SELECT notification_id, ${workspaceId}, ${userId}, ${type}, ${title}, ${body}, ${entityType}, ${entityId}, false, NOW()
     FROM inserted_dedup;
     ```
   - Implement `createAssignmentNotifications(tx, { workspaceId, taskId, addedAssigneeIds, eventId })`:
     - Re-reads canonical Task from DB to verify it exists and `deletedAt` is null.
     - Fetches active task assignees and intersects with `addedAssigneeIds`.
     - For each matching user, pre-generates a `notificationId = randomUUID()`, constructs `dedupKey = assignment:${workspaceId}:${taskId}:${userId}:${eventId}`, and executes atomic CTE.
   - Implement `createDueSoonNotifications(tx, { workspaceId, taskId, expectedDueVersion })`:
     - Re-reads Task, task statuses (to check canonical terminal state), and active assignees.
     - Verifies `deletedAt` is null, status is not terminal (`isTerminal` is false or status state != 'COMPLETED'/'CANCELLED'), `dueAt` is not null, `dueVersion` matches `expectedDueVersion`, and `now < dueAt`.
     - For each assignee, pre-generates `notificationId`, constructs `dedupKey = due-soon:${workspaceId}:${taskId}:${userId}:${dueVersion}`, executes CTE.
   - Implement `createOverdueNotifications(tx, { workspaceId, taskId, expectedDueVersion })`:
     - Re-reads Task, status, and active assignees.
     - Verifies `deletedAt` is null, status is not terminal, `dueAt` is not null, `dueVersion` matches `expectedDueVersion`, and `dueAt < now` (strictly `now > dueAt`).
     - For each assignee, constructs `dedupKey = overdue:${workspaceId}:${taskId}:${userId}:${dueVersion}`, executes CTE.
2. Export helpers in `database/src/index.ts`.
3. Add a real integration test verifying concurrent execution with identical dedup key produces exactly 1 notification.
