# Phase 7 Notifications & Reminders Design

## Status

Approved design for Phase 7 implementation planning. Do not proceed to implementation or Phase 8 scope until approved.

---

## 1. Current State Reconstructed

- `master` contains Phase 6 Recurring Tasks and Worker Foundation at `c2a1d46`.
- Phase 6 is complete and verified with clean database, BullMQ integration, API tests, and Playwright E2E.
- PostgreSQL is the canonical business source of truth; Redis and BullMQ provide execution/transport infrastructure.
- `outbox_events` is operational for transactional asynchronous operations.
- `apps/worker` provides long-running worker runtime, job handlers, and advisory-locked reconciliation.
- Notification types `TASK_ASSIGNED`, `TASK_DUE_SOON`, and `TASK_OVERDUE` are in scope for Phase 7.
- Later approval, mention, comment, email/Resend, push, and notification preference UI features are explicitly excluded.

---

## 2. Phase 7 Scope & Boundaries

### Included
1. **Schema & Persistence:**
   - Canonical `notifications` table adhering to Floz ERD.
   - Durable `notification_dedup_ledger` for PostgreSQL-enforced delivery idempotency.
   - `tasks.due_version` column to track canonical due schedule revisions.
   - Dormant `notification_preferences` table for ERD alignment (without preference filtering logic or UI).
2. **Notification Lifecycle:**
   - `TASK_ASSIGNED`: Triggered on task creation or assignee modification. Notifies newly added assignees only. Revalidates current assignees before emission.
   - `TASK_DUE_SOON`: Triggered 24 hours prior to `due_at`. Immediate wake-up if created/rescheduled within <24h window. Re-reads canonical Task; skips if completed/cancelled/deleted/rescheduled.
   - `TASK_OVERDUE`: Periodic worker reconciliation triggers one notification per active assignee when `now > due_at` and task is not in a terminal state.
3. **Transactional Outbox & Worker:**
   - Task mutations emit outbox events (`task.assigned`, `task.due_changed`) in the same PostgreSQL transaction.
   - Existing `apps/worker` extended with BullMQ wake-up jobs and advisory-locked reconciliation recovery.
   - Shared idempotent primitives: `createAssignmentNotifications`, `createDueSoonNotifications`, and `createOverdueNotifications`.
4. **REST API Endpoints:**
   - `GET /api/v1/workspaces/{workspace_id}/notifications` (read filter, bounded limit, deterministic cursor pagination).
   - `GET /api/v1/workspaces/{workspace_id}/notifications/unread-count`.
   - `PATCH /api/v1/workspaces/{workspace_id}/notifications/{notification_id}` (`is_read: true`, idempotent).
   - `POST /api/v1/workspaces/{workspace_id}/notifications/mark-all-read` (atomic update, returns `updated_count`).
5. **Notification Center UI:**
   - Global Shell Notification Bell with badge counter and accessible label.
   - Popover / mobile panel with All/Unread filter tabs, list items with type icons, titles, bodies, and relative semantic `<time>` elements.
   - Accessible "Load more" button baseline + progressive enhancement.
   - Direct deep-linking via canonical `context.route` with optimistic read status update.
6. **Polling & Refresh:**
   - Modest polling (~60s) when window is visible/active.
   - Revalidation on tab focus, Notification Center open, and workspace switch.

### Excluded
- Approval notifications (`APPROVAL_REQUESTED`, `APPROVAL_APPROVED`, `APPROVAL_REJECTED`).
- Comment mentions (`COMMENT_MENTION`).
- User configurable Notification Preferences UI/API.
- Email delivery via Resend or SMTP.
- Push notifications or WebSockets/SSE.
- Unassigned task creator fallback (notifications target active assignees only).
- Inverting read state (`is_read: false`).

---

## 3. Approved Reminder & Overdue Policy

1. **Default `TASK_DUE_SOON` Timing:**
   - Lead time: `due_at - 24 hours`.
   - Condition: `now < due_at` AND `due_at - 24 hours <= now`.
   - Single due-soon notification per due-date schedule version.
2. **Short Lead-Time Behavior (Option A):**
   - If a task is created or rescheduled while `now < due_at` and `due_at - now < 24 hours`, `TASK_DUE_SOON` is immediately eligible.
   - If `due_at < now`, skip `TASK_DUE_SOON` (handled by `TASK_OVERDUE`).
3. **Rescheduling Semantics & `due_version`:**
   - `due_version` increments if and only if `old_due_at IS DISTINCT FROM new_due_at` (including null <-> non-null transitions). Re-applying the exact same due timestamp leaves `due_version` unchanged.
   - Stale delayed jobs for prior due dates re-read the Task and become safe no-ops.
   - Moving deadline closer (<24h) triggers immediate wake-up; moving it farther schedules delayed wake-up for new `due_at - 24h`.
   - Scheduling wake-up does NOT acquire notification dedup ledger; dedup identity is acquired only when `createDueSoonNotifications()` runs.
4. **Overdue Handling:**
   - Derived business state: `due_at < now` (strictly `now > due_at`) and task is not in a terminal state (validated against canonical workflow terminal semantics) and task is not soft-deleted.
   - Deduplicated via `overdue:{workspaceId}:{taskId}:{recipientUserId}:{dueVersion}`.

---

## 4. Architecture & Data Flow

```text
[Task Mutation]
       │
       ▼ (Same DB Transaction)
[outbox_events] ───────► [BullMQ Outbox Dispatcher] ──► [apps/worker Handlers]
                                                               │
       ┌───────────────────────────────────────────────────────┼──────────────────────────────────────────────────────┐
       ▼                                                       ▼                                                      ▼
[task.assigned Processor]                             [task.due_changed Processor]                         [Periodic Overdue / Due Reconciliation]
- Re-reads Task & assignees                           - Calculates target = due_at - 24h                   - Scans due_at - 24h <= now < due_at (missed due-soon)
- Intersects with addedAssigneeIds                    - If target <= now: immediate job                    - Scans due_at < now (active overdue)
- Atomic dedup ledger acquisition                     - If target > now: delayed job                       - Acquires PG advisory lock
- Inserts notifications row                            - Atomic dedup ledger acquisition                    - Atomic dedup ledger acquisition
```

### Shared Idempotent Notification Primitives
All entry points (queue processors and reconciliation) converge on unified database primitives:
- `createAssignmentNotifications(tx, { workspaceId, taskId, addedAssigneeIds, eventId })`
- `createDueSoonNotifications(tx, { workspaceId, taskId, expectedDueVersion })`
- `createOverdueNotifications(tx, { workspaceId, taskId, expectedDueVersion })`

Each primitive:
1. Re-reads current canonical Task state in PostgreSQL.
2. Verifies active state, valid workspace, not deleted, and non-terminal status.
3. Resolves current active assignees.
4. Executes the atomic dedup ledger acquisition and inserts `notifications` rows.

---

## 5. Database Schema & Deduplication Ledger

### 1. `notifications` Table
```typescript
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 50 }).notNull(), // 'TASK_ASSIGNED' | 'TASK_DUE_SOON' | 'TASK_OVERDUE'
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body").notNull(),
  entityType: varchar("entity_type", { length: 50 }), // 'TASK'
  entityId: uuid("entity_id"),
  isRead: boolean("is_read").notNull().default(false),
  readAt: timestamp("read_at", { mode: "date", withTimezone: true }),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userReadCreatedIdx: index("idx_notifications_user_read_created").on(t.userId, t.isRead, t.createdAt),
  workspaceUserReadCreatedIdx: index("idx_notifications_ws_user_read_created_id").on(t.workspaceId, t.userId, t.isRead, t.createdAt, t.id),
}));
```

### 2. `notification_dedup_ledger` Table
```typescript
export const notificationDedupLedger = pgTable("notification_dedup_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  dedupKey: varchar("dedup_key", { length: 255 }).notNull(),
  notificationId: uuid("notification_id"), // Loose nullable reference, survives retention cleanup
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  wsDedupKeyUnique: uniqueIndex("idx_notification_dedup_ws_key").on(t.workspaceId, t.dedupKey),
}));
```

### 3. Task Due Versioning
Extend `tasks` table with:
- `due_version: integer("due_version").notNull().default(0)`
- Increment rule: `due_version = due_version + 1` whenever `due_at` is modified.

### 4. Deduplication Keys Logical Format
- `TASK_ASSIGNED`: `assignment:${workspaceId}:${taskId}:${recipientUserId}:${assignmentEventId}`
- `TASK_DUE_SOON`: `due-soon:${workspaceId}:${taskId}:${recipientUserId}:${dueVersion}`
- `TASK_OVERDUE`: `overdue:${workspaceId}:${taskId}:${recipientUserId}:${dueVersion}`

### 5. Atomic Dedup Acquisition CTE
```sql
-- $1: dedup_ledger_id (uuid)
-- $2: workspace_id (uuid)
-- $3: dedup_key (varchar)
-- $4: pregenerated_notification_id (uuid)
-- $5: user_id (uuid)
-- $6: type (varchar)
-- $7: title (varchar)
-- $8: body (text)
-- $9: entity_type (varchar)
-- $10: entity_id (uuid)
WITH inserted_dedup AS (
  INSERT INTO notification_dedup_ledger (id, workspace_id, dedup_key, notification_id, created_at)
  VALUES ($1, $2, $3, $4, NOW())
  ON CONFLICT (workspace_id, dedup_key) DO NOTHING
  RETURNING notification_id
)
INSERT INTO notifications (id, workspace_id, user_id, type, title, body, entity_type, entity_id, is_read, created_at)
SELECT notification_id, $2, $5, $6, $7, $8, $9, $10, false, NOW()
FROM inserted_dedup;
```
Ensures that if dedup conflict occurs, exactly zero notification rows are created.

---

## 6. API Contracts & Query Semantics

### Endpoints

#### `GET /api/v1/workspaces/{workspace_id}/notifications`
- **Query params:**
  - `read` (optional boolean string `"true"` or `"false"`, strictly validated).
  - `limit` (optional integer, default `50`, max `100`).
  - `cursor` (opaque base64 string encoding `{ createdAt, id }`).
- **Response envelope:**
  ```json
  {
    "data": [
      {
        "id": "uuid",
        "type": "TASK_DUE_SOON",
        "title": "Task due soon",
        "body": "TASK-102 is due tomorrow.",
        "entity_type": "TASK",
        "entity_id": "task_uuid",
        "is_read": false,
        "read_at": null,
        "created_at": "2026-08-28T09:00:00.000Z",
        "context": {
          "route": "/workspaces/ws_uuid/tasks?selected_task_id=task_uuid"
        }
      }
    ],
    "meta": {
      "pagination": {
        "limit": 50,
        "next_cursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTA4LTI4VDA5OjAwOjAwLjAwMFoiLCJpZCI6Im5vdGlmXzEifQ==",
        "has_more": true
      }
    }
  }
  ```

#### `GET /api/v1/workspaces/{workspace_id}/notifications/unread-count`
- **Response envelope:**
  ```json
  {
    "data": {
      "count": 5
    }
  }
  ```

#### `PATCH /api/v1/workspaces/{workspace_id}/notifications/{notification_id}`
- **Payload:** `{ "is_read": true }` (rejects `is_read: false` with validation error).
- **Semantics:** Idempotently sets `is_read = true` and `read_at = NOW()`. Preserves existing `read_at` if already read. Scoped to authenticated user and active workspace (returns 404 if not found).
- **Response:**
  ```json
  {
    "data": {
      "id": "uuid",
      "is_read": true,
      "read_at": "2026-08-28T09:05:00.000Z"
    }
  }
  ```

#### `POST /api/v1/workspaces/{workspace_id}/notifications/mark-all-read`
- **Semantics:** Updates all unread notifications for current user in active workspace with a single consistent timestamp.
- **Response:**
  ```json
  {
    "data": {
      "updated_count": 5
    }
  }
  ```

---

## 7. Notification Center UI & Experience

1. **Global Shell Bell & Badge:**
   - Bell icon button added to top-bar/header of `apps/web/components/shell.tsx`.
   - Displays numeric unread badge counter (`count` or `99+`) with accessible screen-reader announcement `aria-label="Notifications, 5 unread"`.
2. **Notification Popover / Panel:**
   - Accessible keyboard navigation (Escape to close, focus returned to Bell on close).
   - Filter tabs: `All` and `Unread` (managed as local state).
   - "Mark all as read" button at the top (disabled when unread count is 0).
3. **List Items:**
   - Type icon, title, body, and semantic `<time datetime="...">` with relative text.
   - Non-color unread indicators (strong font-weight, distinct accessible indicator).
   - Click triggers optimistic read update, dispatches `PATCH /notifications/{id}`, and navigates to `notification.context.route`.
4. **Pagination & Fallback States:**
   - Visible, keyboard-accessible "Load more" button as baseline with progressive IntersectionObserver auto-fetch.
   - Comprehensive state handling: initial loading skeletons, empty inbox, no unread items, loading more, and error retry state.

---

## 8. Real-time Refresh & Worker Reconciliation

1. **Client Refresh Strategy:**
   - Unread count polled every ~60s while browser tab is active/visible.
   - Polling paused when tab is hidden; immediate refresh triggered on tab refocus.
   - Revalidation triggered on Notification Center open, workspace switch, and post-mutation actions.
2. **Periodic Worker Reconciliation:**
   - Session-pinned PostgreSQL advisory lock prevents concurrent worker overlap.
   - Scans missed due-soon reminders (`due_at > now AND due_at - 24h <= now`).
    - Scans overdue tasks (`due_at < now` on active non-terminal tasks).
   - Invokes shared idempotent primitives in bounded chronological batches.

---

## 9. Testing Strategy & Validation Gates

### Test Coverage
- **PostgreSQL Concurrency Tests:** Concurrent transaction attempts to insert the same dedup key produce exactly one notification.
- **Worker Integration Tests:**
  - `TASK_ASSIGNED` generates notifications for added assignees; ignores unchanged/unassigned users.
  - `TASK_DUE_SOON` generates reminder 24h prior; handles short-lead immediate wake-up; ignores completed/cancelled/deleted tasks.
  - `TASK_OVERDUE` generates overdue notification; repeated scans do not duplicate; rescheduling prevents stale overdue notifications.
  - Reconciliation recovers missed events after simulated Redis outage.
- **API Tests:**
  - Workspace and user isolation verification (returns 404 for cross-workspace/cross-user access).
  - Deterministic cursor pagination, filter validation, unread count accuracy, idempotent mark-read, and mark-all-read.
- **Playwright E2E:**
  - End-to-end flow: Task assignment -> notification badge counter updates -> Notification Center opened -> item clicked -> navigates to Task detail context -> item marked as read -> mark all read verified.

### Final Verification Gates
1. `./scripts/test-clean-db.ps1`
2. `./scripts/test-e2e.ps1`
3. `pnpm --filter @floz/worker test:integration`
4. `pnpm lint`
5. `pnpm typecheck`
6. `pnpm test`
7. `pnpm build`
