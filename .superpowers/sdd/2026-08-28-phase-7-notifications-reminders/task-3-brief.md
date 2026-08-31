### Task 3: Task Mutation Outbox Emitting & Due Versioning

**Files:**
- Modify: `database/src/task-core.ts`
- Modify: `apps/api/src/task.service.ts`
- Test: `database/test/task-core.test.ts` (or integration tests in `apps/api/test/`)

**Interfaces:**
- Consumes: `insertOutboxEvent(tx, ...)` from `database/src/outbox.ts`.
- Produces: Outbox event payloads for `task.assigned` and `task.due_changed`.

**Requirements & Specifications:**
1. In `database/src/task-core.ts` (and where `createTask` / `patchTask` transaction helpers exist):
   - **`dueVersion` Increment Logic on `patchTask`:**
     - Check if `dueAt` is being changed: `oldDueAt !== newDueAt` (taking care of Date object vs ISO string or Date comparison: `(oldDueAt?.getTime() ?? null) !== (newDueAt?.getTime() ?? null)`).
     - If `dueAt` has distinctly changed:
       - Increment `dueVersion: currentTask.dueVersion + 1`.
       - Write outbox event inside the same transaction:
         ```typescript
         await insertOutboxEvent(tx, {
           workspaceId,
           aggregateType: 'TASK',
           aggregateId: taskId,
           eventType: 'task.due_changed',
           payload: {
             taskId,
             workspaceId,
             dueAt: newDueAt ? newDueAt.toISOString() : null,
             dueVersion: currentTask.dueVersion + 1
           }
         });
         ```
     - If `dueAt` was not modified or remains identical timestamp, `dueVersion` remains unchanged and NO `task.due_changed` event is emitted.
   - **`task.assigned` Outbox on Assignment:**
     - In `createTask`: If `assigneeIds` has 1 or more entries, emit outbox event:
       ```typescript
       await insertOutboxEvent(tx, {
         workspaceId,
         aggregateType: 'TASK',
         aggregateId: taskId,
         eventType: 'task.assigned',
         payload: {
           taskId,
           workspaceId,
           addedAssigneeIds: assigneeIds,
           eventId: randomUUID()
         }
       });
       ```
     - In `createTask`: If `dueAt` is provided, emit `task.due_changed`:
       ```typescript
       await insertOutboxEvent(tx, {
         workspaceId,
         aggregateType: 'TASK',
         aggregateId: taskId,
         eventType: 'task.due_changed',
         payload: {
           taskId,
           workspaceId,
           dueAt: dueAt.toISOString(),
           dueVersion: 0 // or initial task.dueVersion
         }
       });
       ```
     - In `patchTask` or assignment modification: Determine `addedAssigneeIds` (assignee user IDs in new list that were not in old list).
     - If `addedAssigneeIds.length > 0`, emit outbox event:
       ```typescript
       await insertOutboxEvent(tx, {
         workspaceId,
         aggregateType: 'TASK',
         aggregateId: taskId,
         eventType: 'task.assigned',
         payload: {
           taskId,
           workspaceId,
           addedAssigneeIds,
           eventId: randomUUID()
         }
       });
       ```
2. In `apps/api/src/task.service.ts`:
   - Ensure the transaction path forwards or triggers the `task-core.ts` helpers properly.
3. Verify that `pnpm --filter @floz/database build` and `pnpm --filter @floz/api build` and tests pass cleanly.
