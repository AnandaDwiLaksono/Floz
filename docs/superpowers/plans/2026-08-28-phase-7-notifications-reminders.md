# Phase 7 Notifications & Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Phase 7 P0 notification and reminder loop, including database schema, shared notification primitives, worker queue processors, REST API, and Notification Center UI, using the existing Floz outbox and scheduling architecture.

**Architecture:** We use PostgreSQL for canonical state and deduplication. The schema introduces `notifications` and `notification_dedup_ledger`. Task mutations atomtically write outbox intents which BullMQ workers process to create `TASK_ASSIGNED` and schedule `TASK_DUE_SOON`. A reconciliation loop handles `TASK_OVERDUE` and missed `TASK_DUE_SOON`. The web client uses a polling strategy for the Notification Bell and Notification Center.

**Tech Stack:** Drizzle ORM, PostgreSQL, BullMQ, Redis, Next.js (React), React Query/SWR (via custom hooks), Playwright.

## Global Constraints
- **PostgreSQL is the source of truth.** Redis is for transport/wake-ups only.
- **Transactional safety:** Database writes must occur inside Drizzle transactions.
- **Dedup rules:** Notifications must not be duplicated. We use the atomic CTE deduplication pattern.
- **No untested logic:** Each backend feature must be verified with domain/API integration tests. Real UI E2E required.
- **Canonical Envelope:** The API must use the standard Floz `{ data, meta }` response envelope and opaque cursor format.
- **Do not proceed beyond Phase 7.**

---

### Task 1: Notifications Schema and Due Versioning

**Files:**
- Modify: `packages/database/src/schema.ts`
- Create: `packages/database/drizzle/0005_phase7_notifications.sql` (generated via `pnpm db:generate`)
- Test: `packages/database/test/notifications.schema.test.ts` (or similar schema check, though `db:push` and general test passing works)

**Interfaces:**
- Produces: `notifications`, `notificationDedupLedger`, `notificationPreferences` tables exported in `schema.ts`.
- Produces: `dueVersion` column on `tasks` table.

- [ ] **Step 1: Update schema.ts**
  - Add `dueVersion: integer("due_version").notNull().default(0)` to `tasks`.
  - Add `notifications`, `notificationDedupLedger`, and `notificationPreferences` following the ERD and Section 5 of the design spec.
  - Set `UNIQUE(workspaceId, dedupKey)` on the ledger.
  - Export the new tables and relationships.

- [ ] **Step 2: Generate migrations**
  - Run `pnpm --filter @floz/database db:generate` to create the SQL migration file.
  
- [ ] **Step 3: Update Task Validation**
  - Ensure the task creation and patch rules correctly handle or ignore `dueVersion` (it's managed internally, clients don't set it).

- [ ] **Step 4: Commit**
  - `git add packages/database/src/schema.ts packages/database/drizzle/`
  - `git commit -m "feat(db): add phase 7 notification schema and task due version"`

---

### Task 2: Notification Primitives & CTE Implementation

**Files:**
- Create: `packages/database/src/notification-core.ts`
- Test: `apps/worker/test/notification-core.integration.test.ts` (or in `database/test`)

**Interfaces:**
- Produces: `createAssignmentNotifications(tx, params)`, `createDueSoonNotifications(tx, params)`, `createOverdueNotifications(tx, params)`

- [ ] **Step 1: Write concurrent test**
  - Write a test simulating two concurrent calls to `createAssignmentNotifications` with the same dedup key, verifying only one notification is created.

- [ ] **Step 2: Implement primitives with CTE**
  - Write the `$execute()` raw SQL CTE using Drizzle's `sql` template for atomic insertion into `notification_dedup_ledger` (returning `notification_id`) and `notifications`.
  - Implement `createAssignmentNotifications`: resolves active assignees, intersects with `addedAssigneeIds`, skips if empty, generates dedup key `assignment:...`, runs CTE.
  - Implement `createDueSoonNotifications`: resolves active assignees, verifies `dueVersion` matches expected, verifies not deleted/completed/cancelled, runs CTE with `due-soon:...`.
  - Implement `createOverdueNotifications`: resolves active assignees, verifies `dueVersion`, not deleted, not terminal, runs CTE with `overdue:...`.

- [ ] **Step 3: Run and pass test**
  - Run the concurrency test to verify idempotency and isolation.

- [ ] **Step 4: Commit**
  - `git add packages/database/src/notification-core.ts ...`
  - `git commit -m "feat(core): implement idempotent notification creation primitives"`

---

### Task 3: Task Mutation Outbox Emitting & Due Versioning

**Files:**
- Modify: `packages/database/src/task-core.ts`
- Modify: `apps/api/src/task.service.ts`
- Test: `packages/database/test/task-core.test.ts`

**Interfaces:**
- Consumes: Outbox insert helpers from Phase 6.

- [ ] **Step 1: Write test for dueVersion increment and outbox**
  - Test that patching `due_at` to a new date increments `dueVersion` and writes a `task.due_changed` outbox event.
  - Test that patching `due_at` to the exact same date leaves `dueVersion` unchanged.
  - Test that modifying assignees writes a `task.assigned` event containing `addedAssigneeIds`.

- [ ] **Step 2: Update task patch/create logic**
  - In `patchTask` transaction: check if `due_at` changed (including null). If so, increment `due_version` and write `task.due_changed` outbox event `{ taskId, workspaceId, dueAt, version: newDueVersion }`.
  - If `assigneeIds` added: write `task.assigned` outbox event `{ taskId, workspaceId, addedAssigneeIds, eventId: uuid() }`.
  - In `createTask`: write `task.assigned` (if assignees > 0) and `task.due_changed` (if `due_at` provided).

- [ ] **Step 3: Verify tests pass**
  - Run core integration tests.

- [ ] **Step 4: Commit**
  - `git add packages/database/src/task-core.ts`
  - `git commit -m "feat(core): emit notification outbox events on task mutation"`

---

### Task 4: Worker Outbox Handlers & Wake-up Scheduling

**Files:**
- Modify: `apps/worker/src/outbox-dispatcher.ts`
- Create: `apps/worker/src/handlers/task-assigned.ts`
- Create: `apps/worker/src/handlers/task-due-changed.ts`
- Test: `apps/worker/test/notification-handlers.test.ts`

**Interfaces:**
- Consumes: Notification primitives from Task 2.
- Produces: BullMQ jobs for `task.due_soon`.

- [ ] **Step 1: Write handler tests**
  - Test `task.assigned` outbox handler invokes `createAssignmentNotifications`.
  - Test `task.due_changed` handler schedules a delayed `task.due_soon` job (or immediate if `<24h`).

- [ ] **Step 2: Implement handlers**
  - `task.assigned`: Call `createAssignmentNotifications` in a transaction.
  - `task.due_changed`: 
    - Compute `targetTime = dueAt - 24h`.
    - If `targetTime <= now`, enqueue `task.due_soon` immediately.
    - If `targetTime > now`, enqueue `task.due_soon` with delay (Job ID: hash `taskId + ":" + dueAt`).

- [ ] **Step 3: Run handler tests**
  - Ensure correct delayed scheduling math.

- [ ] **Step 4: Commit**
  - `git commit -m "feat(worker): handle notification outbox events"`

---

### Task 5: Wake-up Execution & Periodic Reconciliation

**Files:**
- Create: `apps/worker/src/handlers/task-due-soon.ts`
- Modify: `apps/worker/src/reconciliation.ts`
- Test: `apps/worker/test/notification-reconciliation.test.ts`

**Interfaces:**
- Consumes: `createDueSoonNotifications`, `createOverdueNotifications`.

- [ ] **Step 1: Write wake-up and reconciliation tests**
  - Test `task.due_soon` processor calling primitive.
  - Test reconciliation scan finds missed `<24h` due dates and active `>due_at` overdue tasks, calling primitives without duplicating.

- [ ] **Step 2: Implement due-soon processor**
  - `task.due_soon` processor calls `createDueSoonNotifications`.

- [ ] **Step 3: Implement periodic reconciliation**
  - Add query for active tasks where `due_at - 24h <= now AND due_at > now`. For each, invoke `createDueSoonNotifications`.
  - Add query for active tasks where `due_at < now`. For each, invoke `createOverdueNotifications`.
  - Both protected by existing advisory lock loop.

- [ ] **Step 4: Run tests & Commit**
  - `git commit -m "feat(worker): implement due soon wake-up and overdue reconciliation"`

---

### Task 6: REST API Notification Endpoints

**Files:**
- Create: `apps/api/src/notification.controller.ts`
- Create: `apps/api/src/notification.service.ts`
- Create: `apps/api/src/notification.dto.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/notification.test.ts`

**Interfaces:**
- Produces: `GET /notifications`, `GET /notifications/unread-count`, `PATCH /notifications/:id`, `POST /notifications/mark-all-read`.

- [ ] **Step 1: Write API tests**
  - Verify workspace/user isolation (404 for wrong user).
  - Verify `is_read=true` is idempotent and leaves `read_at` unchanged if already read.
  - Verify `mark-all-read` updates correctly.
  - Verify deterministic cursor pagination and envelope formatting.

- [ ] **Step 2: Implement Notification API Service & Controller**
  - Use Drizzle queries with `workspaceId` and `userId` scoping.
  - Apply cursor logic (`createdAt DESC, id DESC`).
  - Strict validation of `read=true/false` query string.
  - Set `context.route = /workspaces/{wsId}/tasks?selected_task_id={taskId}`.

- [ ] **Step 3: Run API tests & Commit**
  - Ensure all 20+ api tests pass.
  - `git commit -m "feat(api): add notification list, read, and count endpoints"`

---

### Task 7: Notification Center UI Core Components

**Files:**
- Create: `apps/web/components/notification-center.tsx`
- Create: `apps/web/components/notification-item.tsx`
- Modify: `apps/web/components/shell.tsx`

**Interfaces:**
- Consumes: Floz API Client for SWR/React hooks.

- [ ] **Step 1: Build the UI structures**
  - Add a Bell Icon to `shell.tsx` top bar.
  - Create the `NotificationCenter` popover/panel.
  - Add "All / Unread" tabs (local state).
  - Add "Mark all as read" button.

- [ ] **Step 2: Build the list items**
  - Format relative timestamp (`<time>`).
  - Distinguish unread visually with bold text/dot.
  - Implement accessible "Load more" button baseline.

- [ ] **Step 3: Commit**
  - `git add apps/web/components/`
  - `git commit -m "feat(web): build notification center UI components"`

---

### Task 8: UI Polling & Data Integration

**Files:**
- Modify: `apps/web/components/shell.tsx`
- Modify: `apps/web/components/notification-center.tsx`
- Create: `apps/web/lib/hooks/use-notifications.ts`

**Interfaces:**
- Consumes: Notification API endpoints.

- [ ] **Step 1: Implement data hooks**
  - Create custom hook for `unread-count` with 60s polling interval (`refreshInterval: 60000` via SWR/equivalent already used in app).
  - Create custom hook for infinite cursor pagination of notifications list.

- [ ] **Step 2: Connect hooks to UI**
  - Shell reads unread count to show badge.
  - `NotificationCenter` reads list data.
  - Implement optimistic `PATCH` for marking an item read and `router.push()` navigation.
  - Implement `mark-all-read` mutation.

- [ ] **Step 3: Commit**
  - `git commit -m "feat(web): integrate notification polling and optimistic updates"`

---

### Task 9: Real-stack E2E Verification

**Files:**
- Create: `apps/web/e2e/notifications.spec.ts`

**Interfaces:**
- Consumes: Full stack (DB, Worker, API, Web).

- [ ] **Step 1: Write E2E spec**
  - Login as User A.
  - Create a task and assign it to User B (using API or UI).
  - Login as User B.
  - Verify Notification Bell shows unread badge.
  - Open Notification Center.
  - Click notification, verify navigation to Task context and read state update.

- [ ] **Step 2: Run Playwright**
  - `pnpm exec playwright test e2e/notifications.spec.ts`

- [ ] **Step 3: Commit**
  - `git commit -m "test(e2e): cover phase 7 notifications flow"`

---

### Task 10: Final Gates and Phase 7 Report

**Files:**
- Create: `docs/implementation/PHASE_7_REPORT.md`
- Modify: `docs/implementation/IMPLEMENTATION_STATUS.md`
- Modify: `docs/implementation/CURRENT_HANDOFF.md`

- [ ] **Step 1: Run full verification gates**
  - Run `./scripts/test-clean-db.ps1`
  - Run `./scripts/test-e2e.ps1`
  - Run all typechecks and linters.

- [ ] **Step 2: Document completion**
  - Write metrics and validation outcomes into `PHASE_7_REPORT.md`.
  - Update `IMPLEMENTATION_STATUS.md` to show Phase 7 complete.

- [ ] **Step 3: Commit**
  - `git add docs/`
  - `git commit -m "docs: finalize phase 7 notification implementation"`
