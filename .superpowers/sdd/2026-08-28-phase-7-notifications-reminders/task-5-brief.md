### Task 5: Wake-up Execution & Periodic Reconciliation

**Files:**
- Modify: `apps/worker/src/recurrence-worker.ts` (or create `apps/worker/src/notification-worker.ts` registering worker runtime if separate)
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/worker/src/reconciliation.ts`
- Test: `apps/worker/test/notification-reconciliation.integration.test.ts` (or similar integration tests in worker)

**Interfaces:**
- Consumes: `createDueSoonNotifications` and `createOverdueNotifications` from `@floz/database`.
- Consumes: BullMQ queue name `notification-due-soon`.

**Requirements & Specifications:**
1. In `apps/worker/src/recurrence-worker.ts` or new worker setup:
   - Instantiate and run a BullMQ `Worker` listening on queue `notification-due-soon`.
   - The worker processor extracts `taskId` and `dueVersion` from job data.
   - For each job:
     - Wrap in a database transaction.
     - Call `createDueSoonNotifications(tx, { workspaceId, taskId, expectedDueVersion: dueVersion })`.
   - Register the worker for graceful shutdown in `apps/worker/src/main.ts`.
2. In `apps/worker/src/reconciliation.ts`:
   - Extend the periodic reconciliation loop (which already runs under pg advisory lock) to scan tasks:
     - **Due Soon missed reminders recovery:**
       - Query active tasks where `deleted_at IS NULL`, `due_at > NOW()`, `due_at - interval '24 hours' <= NOW()`.
       - For each task, call `createDueSoonNotifications(tx, { workspaceId, taskId: task.id, expectedDueVersion: task.dueVersion })` in a database transaction.
     - **Overdue tasks reminders:**
       - Query active tasks where `deleted_at IS NULL`, `due_at < NOW()`.
       - Filter out tasks that are canonically terminal (use `isTerminal` flag or check if workflow status state is COMPLETED/CANCELLED).
       - For each task, call `createOverdueNotifications(tx, { workspaceId, taskId: task.id, expectedDueVersion: task.dueVersion })` in a database transaction.
3. Write an integration test `apps/worker/test/notification-reconciliation.integration.test.ts` that populates a due-soon / overdue task, executes reconciliation, and verifies the resulting `notifications` and `notification_dedup_ledger` rows.
4. Ensure worker builds cleanly and all tests compile.
