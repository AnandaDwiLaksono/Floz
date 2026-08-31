# Phase 7: Notifications & Reminders - Task 3 Report

## Core Implementation
- Added `insertOutboxEvent` in `database/src/outbox.ts` to support transactional outbox record creation.
- Updated `database/src/task-core.ts`:
  - `createTaskRecordTx`: Emits `task.due_changed` with `dueVersion: 0` if `due_at` is provided on creation.
  - `createTaskAssigneesTx`: Emits `task.assigned` with `addedAssigneeIds` and random `eventId` if initial assignees are provided.
  - Added `patchTaskRecordTx`: Checks distinct changes in `due_at` (`oldDueTime !== newDueTime`). Increments `due_version` by 1 and writes `task.due_changed` outbox event inside the same transaction when changed.
  - Added `patchTaskAssigneesTx`: Computes `addedAssigneeIds` (assignee IDs not present previously) and writes `task.assigned` outbox event with `eventId` when new assignees are added.
- Updated `apps/api/src/task-core.ts` & `apps/api/src/task.service.ts`:
  - Integrated `patchTaskRecordTx` and `patchTaskAssigneesTx` into `TaskService.update` and `TaskService.assign`.
  - Exported relevant types and functions.

## Integration Tests
- Created `database/test/task-core.integration.test.ts` covering:
  - `createTask` emitting `task.due_changed` when `due_at` is present.
  - `createTaskAssigneesTx` emitting `task.assigned` outbox event.
  - `patchTaskRecordTx` incrementing `dueVersion` only when `dueAt` timestamp distinctly changes and writing outbox event.
  - `patchTaskAssigneesTx` correctly computing newly added assignees and emitting `task.assigned`.

## Verification
- Clean compilation across all packages (`@floz/database`, `@floz/api`, `@floz/web`, etc.).
