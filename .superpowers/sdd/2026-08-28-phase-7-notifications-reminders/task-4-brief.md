### Task 4: Worker Outbox Handlers & Wake-up Scheduling

**Files:**
- Modify: `apps/worker/src/outbox-dispatcher.ts`
- Modify: `apps/worker/src/queues.ts`
- Create: `apps/worker/src/notification-worker.ts` (or handlers in `apps/worker/src/handlers/`)
- Test: `apps/worker/test/notification-handlers.test.ts`

**Interfaces:**
- Consumes: `createAssignmentNotifications` from `@floz/database`.
- Consumes: Outbox event types `task.assigned`, `task.due_changed`.
- Produces: BullMQ jobs on queue `notification-due-soon` (or `recurrence-wakeup` / dedicated queue) with deterministic SHA-256 safe job IDs.

**Requirements & Specifications:**
1. In `apps/worker/src/queues.ts`:
   - Define queue `notification-due-soon` (or unified `notification-wakeup`).
   - Add deterministic job ID builder: `buildDueSoonWakeupJobId(taskId: string, dueVersion: number)` using `createHash('sha256').update(\`due_soon:${taskId}:${dueVersion}\`).digest('hex')`.
2. In outbox dispatcher or handler:
   - Handle event `task.assigned`:
     - Run inside a database transaction (`db.transaction(async (tx) => ...)`).
     - Call `createAssignmentNotifications(tx, payload)`.
   - Handle event `task.due_changed`:
     - Payload contains `{ taskId, workspaceId, dueAt, dueVersion }`.
     - If `dueAt` is null: do nothing.
     - If `dueAt` is present:
       - Parse `dueTime = new Date(dueAt).getTime()`.
       - `targetTime = dueTime - 24 * 60 * 60 * 1000` (24 hours prior).
       - If `dueTime <= now`: do nothing (overdue will be processed by overdue reconciliation).
       - If `targetTime <= now` and `now < dueTime`: Enqueue immediate job to BullMQ `notification-due-soon` queue with jobId `buildDueSoonWakeupJobId(taskId, dueVersion)`.
       - If `targetTime > now`: Enqueue delayed job to BullMQ `notification-due-soon` queue with delay `targetTime - now` and jobId `buildDueSoonWakeupJobId(taskId, dueVersion)`.
3. Unit test the timing logic and outbox routing in `apps/worker/test/notification-handlers.test.ts`.
4. Ensure worker builds cleanly with `pnpm --filter @floz/worker build`.
