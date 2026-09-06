# Phase 10: Approval & Collaboration Core Design

**Status**: FINAL DESIGN / APPROVED FOR IMPLEMENTATION PLANNING

## 1. Current State Reconstructed
Phase 9 is complete, accepted, and frozen (master HEAD: `f4f2076`). The core platform provides workspace isolation, tasks, Kanban, Calendar, Recurrence, Notifications, Dashboards, and comprehensive Administration. Approval and collaboration functions are entirely absent. The database contains zero tables for approvals, comments, or mentions. The `outbox_events` and worker BullMQ infrastructure successfully process async transactional events for recurrence and notifications. The Phase 8 Dashboard API exists, but `pending_approvals` metrics were deferred pending this domain design.

## 2. Problem / Goal
Floz requires the core Approval & Collaboration capability for Gate B (Collaborative Pilot). Teams must be able to request formal approvals (optionally linked to tasks), make binding approval/rejection/cancellation decisions safely under high-concurrency races, converse via chronological task comments with soft deletion, and alert colleagues using structured mentions. The design must integrate with the existing in-app notification outbox engine and manager dashboard projections without leaking scope into workflow builders or rich-text editors.

## 3. Proposed Phase 10 Scope
- **Approval Core:**
  - Independent entity with optional Task reference (`task_id`).
  - Single-step approver MVP using future-compatible `approval_requests` + `approval_steps` schema.
  - Canonical API resource `/api/v1/workspaces/:workspaceId/approval-requests`.
  - Canonical state machine (`PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`).
  - Step status domain (`PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`). Cancellation sets step status to `CANCELLED` while keeping decision fields null.
  - Exact `:stepId` resource binding in Approve (`POST .../steps/:stepId/approve`) and Reject (`POST .../steps/:stepId/reject`), locked with `approval_requests`.
  - Exact cancellation transaction locking `approval_requests` then `approval_steps` (`step_order = 1`) under `FOR UPDATE`.
  - Decision reason normalization:
    - Approve: optional, trim, empty -> null, max 500 chars.
    - Reject: required, trim, 3–500 chars.
    - Cancel: optional, trim, empty -> null, max 500 chars.
  - Explicit decision/cancellation actor persistence (`decided_by_user_id`, `cancelled_by_user_id`, `cancel_reason`).
  - Complete self-approval prohibition applying to all decision actors (including ADMIN override).
  - Eligible approver: any ACTIVE same-workspace member (including `FIELD_WORKER`). Target must be active upon creation (`422 INACTIVE_APPROVER`). For task-linked requests, approver must possess Task-view authorization (`422 INVALID_APPROVER_TARGET`).
  - Strict read authorization: visibility limited to requester, assigned approver, workspace ADMIN, or authorized MANAGER within managed-team scope.
  - Floz canonical selected-item pattern for detail navigation: `/workspaces/:workspaceId/approvals?selected_approval_request_id=:id`.
  - Stable list pagination across all views (`inbox`, `sent`, `managed`, `all`): ordered strictly by `submitted_at DESC, id DESC` via opaque cursor.
- **Collaboration Core:**
  - Task comments (plain text, trimmed 1–2000 chars, empty-after-trim rejected, chronological keyset pagination `created_at ASC, id ASC`, soft-delete).
  - Explicit structured mentions (`mentioned_user_ids: string[]`) deduplicated to a unique set and validated against active workspace members authorized to view the task context. Invalid/unauthorized mention targets produce `422 INVALID_MENTION_TARGET`.
  - Response projection includes structured mention chips `mentions: [{ user_id, full_name }]`.
- **Integration:**
  - Transactional `outbox_events` for approval and mention notifications (`APPROVAL_REQUESTED`, `APPROVAL_APPROVED`, `APPROVAL_REJECTED`, `APPROVAL_CANCELLED`, `COMMENT_MENTIONED`).
  - Task history integration using canonical repository event vocabulary: `APPROVAL_REQUESTED` and `APPROVAL_COMPLETED` (recording terminal status, decision, approver, and actual actor in metadata).
  - Exact notification deep-links: `/workspaces/${wid}/approvals?selected_approval_request_id=${reqId}` and `/workspaces/${wid}/tasks?selected_task_id=${taskId}`.
  - Enable live `pending_approvals` count on Manager Dashboard using set semantics (`COUNT(DISTINCT approval_steps.id)`) scoped to authorized teams and pending steps assigned to managed members/manager. Role-aligned drilldown: `view=managed` for MANAGER, `view=all` for ADMIN. Member Dashboard contract unchanged.
- **Web UI:**
  - Approval views at `/workspaces/:workspaceId/approvals` (`view=inbox|sent|managed|all`).
  - Approval Detail panel/dialog driven by `selected_approval_request_id` with complete audit reconstruction.
  - Task Detail Comments section with structured mention chips and idempotent soft delete action.

## 4. Explicit Non-Goals
To prevent scope creep, the following are strictly excluded from Phase 10:
- Phase 11 Workflow Configuration UI, custom approval workflows, multi-stage approval rules, or dynamic status transition triggers.
- Automatic task status changes based on approval decisions.
- Multi-step approval execution (schema supports steps, but Phase 10 application logic enforces exactly 1 step).
- Parallel approvers, quorum, external/guest approvers, reassignment endpoint.
- Attachments, rich-text editing, inline token-position rendering, comment editing, comment reactions.
- Email/push notification delivery and notification preferences UI.
- Historical KPI snapshots, custom KPI formulas, reporting exports, offline mode.

## 5. Domain Model
- **Approval Requests (`approval_requests`)**: Independent entity scoped to a workspace, with optional context link to `task_id`. Tracks requester, title, description, aggregate status (`PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`), submission timestamp, completion timestamp, cancellation actor (`cancelled_by_user_id`), and cancel reason (`cancel_reason`).
- **Approval Steps (`approval_steps`)**: Child entity tracking the assigned approver (`approver_user_id`), the actual decision actor (`decided_by_user_id`), step order (`step_order = 1`), step status (`PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`), decision type (`APPROVED` or `REJECTED`, null on cancel), decision reason (null on cancel), and decision timestamp (null on cancel).
- **Comments (`comments`)**: Textual collaboration entity tied to a specific `task_id` and workspace. Tracks author, plain-text content, creation timestamp, update timestamp, and soft-delete tombstone (`deleted_at`).
- **Mentions (`mentions`)**: Junction entity resolving a comment to a unique `mentioned_user_id`.

## 6. State Machines
**Approval State Machine (`approval_requests.status` and `approval_steps.status`):**
- **Initial State:** `PENDING`
- **Transitions:**
  - `PENDING` -> `APPROVED`:
    - Endpoint: `POST /approval-requests/:approvalRequestId/steps/:stepId/approve`
    - Locks & validates exact `:stepId` matching `:approvalRequestId` and `workspace_id`.
    - Actor: Assigned `approver_user_id` OR workspace `ADMIN`.
    - Constraint: `actor.id !== approval_requests.requester_id` (No self-approval).
    - Reason Normalization: **OPTIONAL** (trim whitespace; if empty -> `null`; max 500 chars).
    - Step update: `status = 'APPROVED'`, `decision = 'APPROVED'`, `decided_by_user_id = actor.id`, `decided_at = NOW()`, `reason = normalizedReason`.
    - Request update: `status = 'APPROVED'`, `completed_at = NOW()`.
  - `PENDING` -> `REJECTED`:
    - Endpoint: `POST /approval-requests/:approvalRequestId/steps/:stepId/reject`
    - Locks & validates exact `:stepId` matching `:approvalRequestId` and `workspace_id`.
    - Actor: Assigned `approver_user_id` OR workspace `ADMIN`.
    - Constraint: `actor.id !== approval_requests.requester_id` (No self-approval).
    - Reason Normalization: **REQUIRED** (trim whitespace; 3–500 chars after trim).
    - Step update: `status = 'REJECTED'`, `decision = 'REJECTED'`, `decided_by_user_id = actor.id`, `decided_at = NOW()`, `reason = normalizedReason`.
    - Request update: `status = 'REJECTED'`, `completed_at = NOW()`.
  - `PENDING` -> `CANCELLED`:
    - Endpoint: `POST /approval-requests/:approvalRequestId/cancel`
    - Locks `approval_requests` then `approval_steps` (`step_order = 1`) under `FOR UPDATE`.
    - Actor: `approval_requests.requester_id` OR workspace `ADMIN`.
    - Cancel Reason Normalization: **OPTIONAL** (trim whitespace; if empty -> `null`; max 500 chars).
    - Request update: `status = 'CANCELLED'`, `completed_at = NOW()`, `cancelled_by_user_id = actor.id`, `cancel_reason = normalizedReason`.
    - Step update: `status = 'CANCELLED'`, `decision = null`, `decided_by_user_id = null`, `decided_at = null`, `reason = null`.
- **Terminal Behavior:** `APPROVED`, `REJECTED`, and `CANCELLED` are immutable terminal states. Any mutation attempt on non-pending approvals throws `409 APPROVAL_NOT_PENDING`.

## 7. Authorization & Read Policy
- **Workspace Isolation & Same-Workspace Invariants:**
  - Database FK constraints guarantee referenced-row existence.
  - Same-workspace invariants are enforced transactionally by service validation before insert/mutation:
    - Route `workspaceId` must match user's active membership.
    - If `task_id != null`, `task.workspace_id` must equal route `workspaceId`.
    - Requester, approver, and all mention targets must possess `ACTIVE` workspace membership in `workspaceId`.
- **Task-Linked Access Enforcement:**
  - For task-linked requests (`task_id != null`), `requester` and `assigned approver` MUST pass canonical Task-view authorization (membership + team scope check).
  - If the selected approver lacks Task-view access, request creation is rejected with `422 INVALID_APPROVER_TARGET`.
  - Approval API will not return or leak linked Task details to an actor who cannot view the underlying Task.
  - Workspace `ADMIN` override operates under ADMIN workspace authorization.
- **Approval Read Authorization (List & Detail):**
  - Direct list and detail access is strictly authorized for:
    1. `requester` (`requester_id === user.id`)
    2. `assigned approver` (`approver_user_id === user.id`)
    3. Workspace `ADMIN`
    4. `MANAGER` when the approval falls inside their canonical managed-team reporting scope.
  - Unrelated active members cannot list or read approval details (`403 FORBIDDEN`).
- **Create Approval Request:** Any ACTIVE workspace member (ADMIN, MANAGER, MEMBER, FIELD_WORKER).
- **Eligible Approver:** Any ACTIVE workspace member (including `FIELD_WORKER`). Role does not grant approval authority; explicit assignment in the step does. Target approver must be active when the request is created (`422 INACTIVE_APPROVER`). Self-approval is forbidden (`requester_id !== approver_user_id`, throws `422 SELF_APPROVAL_NOT_ALLOWED`).
- **Decide Approval (Approve/Reject):** Assigned `approver_user_id` OR active workspace `ADMIN`.
  - If assigned approver's membership is suspended or deactivated at decision time, they cannot decide and receive `403 FORBIDDEN` under standard workspace authorization.
  - Workspace `ADMIN` override may decide or cancel while `PENDING` without requiring the original assigned approver to still be active.
  - In all cases, `decision_actor_user_id !== requester_id` (ADMIN cannot approve/reject their own requests; throws `422 SELF_APPROVAL_NOT_ALLOWED`).
- **Cancel Approval:** Requester or active workspace `ADMIN`.
- **Comment Creation & Reading:** Actor must be ACTIVE and authorized to view the Task.
- **Mention Target:** Must be an ACTIVE same-workspace member authorized to view the Task. Mentioning an ineligible or unauthorized user returns `422 INVALID_MENTION_TARGET`. Mentioning a user from another workspace returns `422 CROSS_WORKSPACE_REFERENCE`.
- **Comment Deletion:** Comment author OR workspace `ADMIN`.

## 8. Concurrency, Transaction Semantics & Idempotency
- **Canonical Pessimistic Lock Order for Decision Endpoints (`/steps/:stepId/approve`, `/steps/:stepId/reject`):**
  1. `BEGIN` transaction.
  2. `SELECT * FROM approval_requests WHERE id = :approvalRequestId AND workspace_id = :workspaceId FOR UPDATE`
  3. `SELECT * FROM approval_steps WHERE id = :stepId AND approval_request_id = :approvalRequestId AND workspace_id = :workspaceId AND step_order = 1 FOR UPDATE`
  4. Verify both records exist and `:stepId` matches `:approvalRequestId`. Throw `404 NOT_FOUND` if step does not exist or does not belong to the request.
  5. Validate `approval_requests.status === 'PENDING'` AND `approval_steps.status === 'PENDING'`. If not, throw `409 APPROVAL_NOT_PENDING` with `{ current_status: request.status }`.
  6. Validate actor active membership, read access, and decision permissions.
  7. For Approve/Reject: validate `actor.id !== request.requester_id` (throw `422 SELF_APPROVAL_NOT_ALLOWED` if violated).
  8. Update `approval_steps` row.
  9. Update `approval_requests` row.
  10. Insert `outbox_events` row (transactional notification handoff).
  11. If `task_id` is present, insert `task_history` entry (`APPROVAL_COMPLETED` with outcome metadata).
  12. `COMMIT` transaction.

- **Canonical Pessimistic Lock Order for Cancellation Endpoint (`/cancel`):**
  1. `BEGIN` transaction.
  2. `SELECT * FROM approval_requests WHERE id = :approvalRequestId AND workspace_id = :workspaceId FOR UPDATE`
  3. `SELECT * FROM approval_steps WHERE approval_request_id = :approvalRequestId AND workspace_id = :workspaceId AND step_order = 1 FOR UPDATE`
  4. Verify both records exist. Throw `404 NOT_FOUND` if missing.
  5. Validate `approval_requests.status === 'PENDING'` AND `approval_steps.status === 'PENDING'`. If not, throw `409 APPROVAL_NOT_PENDING` with `{ current_status: request.status }`.
  6. Validate cancellation permission (actor must be requester or workspace ADMIN; throw `403 FORBIDDEN` if not).
  7. Update `approval_steps` row (`status = 'CANCELLED'`, `decision = null`, `decided_by_user_id = null`, `decided_at = null`, `reason = null`).
  8. Update `approval_requests` row (`status = 'CANCELLED'`, `completed_at = NOW()`, `cancelled_by_user_id = actor.id`, `cancel_reason = normalizedReason`).
  9. Insert `APPROVAL_CANCELLED` outbox event.
  10. If `task_id` is present, insert `task_history` entry (`APPROVAL_COMPLETED` with `status: 'CANCELLED'`, `actual_actor_user_id: actor.id`, `reason: normalizedReason`).
  11. `COMMIT` transaction.

- **Atomic Creation Transactions:**
  - **Approval Request Creation (`POST /approval-requests`):**
    ```text
    BEGIN
    validate requester has ACTIVE membership in workspace
    validate approver belongs to same workspace (throw 422 CROSS_WORKSPACE_REFERENCE)
    validate approver has ACTIVE membership in workspace (throw 422 INACTIVE_APPROVER if inactive)
    validate self-approval prohibition: approver_user_id != requester.id (throw 422 SELF_APPROVAL_NOT_ALLOWED)
    if task_id != null:
      validate task exists and task.workspace_id == workspaceId (throw 422 CROSS_WORKSPACE_REFERENCE)
      validate requester has Task-view access (throw 403 FORBIDDEN)
      validate approver has Task-view access (throw 422 INVALID_APPROVER_TARGET)
    INSERT INTO approval_requests (...) RETURNING id
    INSERT INTO approval_steps (approval_request_id, step_order = 1, approver_user_id, status = 'PENDING') RETURNING id
    INSERT INTO outbox_events (aggregate_type = 'approval_request', event_type = 'approval.requested', payload = {...})
    if task_id != null:
      INSERT INTO task_history (task_id, actor_user_id, event_type = 'APPROVAL_REQUESTED', metadata = { approval_request_id, step_id, assigned_approver_id })
    COMMIT
    ```
  - **Comment Creation (`POST /tasks/:taskId/comments`):**
    ```text
    BEGIN
    validate Task access for author
    normalize content: trim leading/trailing whitespace, reject if empty, max 2000 chars
    normalize mentioned_user_ids: Array.from(new Set(body.mentioned_user_ids || [])) (Deduplicate IDs)
    for each unique mentioned_user_id:
      validate user belongs to same workspace (throw 422 CROSS_WORKSPACE_REFERENCE)
      validate user has ACTIVE membership (throw 422 INVALID_MENTION_TARGET)
      validate user has Task-view access (throw 422 INVALID_MENTION_TARGET)
    INSERT INTO comments (workspace_id, task_id, author_id, content) RETURNING id
    for each unique mentioned_user_id:
      INSERT INTO mentions (workspace_id, comment_id, mentioned_user_id)
      if mentioned_user_id != author.id:
        INSERT INTO outbox_events (aggregate_type = 'comment', event_type = 'comment.mentioned', payload = { comment_id, task_id, mentioned_user_id })
    COMMIT
    ```

- **Idempotency & Retry Policy:**
  - Generic `Idempotency-Key` table persistence = **DEFERRED**.
  - **Create Approval & Create Comment:** Atomic single-submit transactions. Web UI disables submission buttons during flight. Callers must not blindly retry ambiguous network failures.
  - **Approve / Reject / Cancel:** Fully race-safe via `FOR UPDATE` lock and terminal state recheck. First valid terminal mutation commits. Racing or duplicate retry submissions safely return `409 APPROVAL_NOT_PENDING` without creating duplicate outbox events or history entries. Concurrency races (Approve vs Reject, Approve vs Cancel, Reject vs Cancel, Cancel vs Cancel) guarantee exactly one terminal mutation wins.

## 9. Database Design
**Migration required:** Yes (one versioned migration).
**Proposed Schema Additions (`database/src/schema.ts`):**

```typescript
export const approvalRequests = pgTable('approval_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  taskId: uuid('task_id').references(() => tasks.id),
  requesterId: uuid('requester_id').notNull().references(() => users.id),
  cancelledByUserId: uuid('cancelled_by_user_id').references(() => users.id),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  cancelReason: text('cancel_reason'),
  status: varchar('status', { length: 32 }).notNull().default('PENDING'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: now(),
  updatedAt: updated()
}, (table) => ({
  wsStatusSubmittedId: index('approval_requests_ws_status_submitted_id_idx').on(table.workspaceId, table.status, table.submittedAt, table.id),
  wsRequesterStatusSubmittedId: index('approval_requests_ws_requester_status_submitted_id_idx').on(table.workspaceId, table.requesterId, table.status, table.submittedAt, table.id),
  wsTask: index('approval_requests_ws_task_idx').on(table.workspaceId, table.taskId)
}));

export const approvalSteps = pgTable('approval_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  approvalRequestId: uuid('approval_request_id').notNull().references(() => approvalRequests.id),
  stepOrder: integer('step_order').notNull().default(1),
  approverUserId: uuid('approver_user_id').notNull().references(() => users.id),
  decidedByUserId: uuid('decided_by_user_id').references(() => users.id),
  status: varchar('status', { length: 32 }).notNull().default('PENDING'),
  decision: varchar('decision', { length: 32 }),
  reason: text('reason'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: now(),
  updatedAt: updated()
}, (table) => ({
  reqStepOrder: unique().on(table.approvalRequestId, table.stepOrder),
  wsApproverStatusCreated: index('approval_steps_ws_approver_status_created_idx').on(table.workspaceId, table.approverUserId, table.status, table.createdAt)
}));

export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  taskId: uuid('task_id').notNull().references(() => tasks.id),
  authorId: uuid('author_id').notNull().references(() => users.id),
  content: text('content').notNull(),
  createdAt: now(),
  updatedAt: updated(),
  deletedAt: timestamp('deleted_at', { withTimezone: true })
}, (table) => ({
  wsTaskCreatedId: index('comments_ws_task_created_id_idx').on(table.workspaceId, table.taskId, table.createdAt, table.id)
}));

export const mentions = pgTable('mentions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  commentId: uuid('comment_id').notNull().references(() => comments.id),
  mentionedUserId: uuid('mentioned_user_id').notNull().references(() => users.id),
  createdAt: now()
}, (table) => ({
  commentUser: unique().on(table.commentId, table.mentionedUserId),
  wsMentionedUserCreated: index('mentions_ws_user_created_idx').on(table.workspaceId, table.mentionedUserId, table.createdAt)
}));
```

## 10. API Design
Canonical REST API surface matching specification:

- **`POST /api/v1/workspaces/:workspaceId/approval-requests`**
  - Body: `{ "title": string, "description"?: string, "task_id"?: string, "approver_user_id": string }`
  - Validates `approver_user_id !== actor.id` (`422 SELF_APPROVAL_NOT_ALLOWED`) and target active workspace membership (`422 INACTIVE_APPROVER`).
  - If `task_id` is present, validates Task exists (`422 CROSS_WORKSPACE_REFERENCE`), requester Task-view authorization (`403 FORBIDDEN`), and approver Task-view authorization (`422 INVALID_APPROVER_TARGET`).
  - Creates request and single step (`step_order = 1`).
  - Response: `201 Created` with full Approval Request & step projection.

- **`GET /api/v1/workspaces/:workspaceId/approval-requests`**
  - Query:
    - `view`: `inbox` (assigned to user), `sent` (created by user), `managed` (MANAGER only; approvals assigned to managed team members/manager), `all` (ADMIN only; workspace-wide). Default `inbox`.
    - `status`: `PENDING` | `APPROVED` | `REJECTED` | `CANCELLED`.
    - `team_id`: optional team scope for `managed` or `all` views (validates Phase 8 manager scope; throws `403 FORBIDDEN` if unauthorized).
    - `limit` (default 50, max 100), `cursor` (opaque base64 encoding of `{ submittedAt, id }`).
  - Stable Sort Order: strictly `submitted_at DESC, id DESC` across all views.
  - Set Semantics for `managed` view: uses `EXISTS` to ensure members belonging to multiple teams managed by the same manager appear exactly once without duplicate rows.
  - Response: `{ data: ApprovalRequestSummary[], meta: { pagination: { limit, next_cursor, has_more } } }`.

- **`GET /api/v1/workspaces/:workspaceId/approval-requests/:approvalRequestId`**
  - Enforces read authorization (requester, approver, workspace ADMIN, or authorized MANAGER).
  - Returns complete Approval Detail with reconstructed audit fields (created by/when, assigned to, decided by/when/reason, cancelled by/when/reason, linked task summary if authorized).

- **`POST /api/v1/workspaces/:workspaceId/approval-requests/:approvalRequestId/steps/:stepId/approve`**
  - Body: `{ "reason"?: string }`
  - Normalization: trim whitespace; if empty -> `null`; max 500 chars.
  - Locks and validates exact `:stepId` for `:approvalRequestId`.
  - Validates actor is assigned approver or ADMIN, and `actor.id !== requester_id`.
  - Response: `200 OK` with updated request and step.

- **`POST /api/v1/workspaces/:workspaceId/approval-requests/:approvalRequestId/steps/:stepId/reject`**
  - Body: `{ "reason": string }`
  - Normalization: trim whitespace; mandatory 3–500 chars after trim.
  - Locks and validates exact `:stepId` for `:approvalRequestId`.
  - Validates actor is assigned approver or ADMIN, and `actor.id !== requester_id`.
  - Response: `200 OK` with updated request and step.

- **`POST /api/v1/workspaces/:workspaceId/approval-requests/:approvalRequestId/cancel`**
  - Body: `{ "reason"?: string }`
  - Normalization: trim whitespace; if empty -> `null`; max 500 chars.
  - Locks `approval_requests` and `approval_steps` (`step_order = 1`) under `FOR UPDATE`.
  - Validates actor is requester or ADMIN, and request is `PENDING`. Sets request and step status to `CANCELLED`.
  - Response: `200 OK` with updated request and step.

- **`GET /api/v1/workspaces/:workspaceId/tasks/:taskId/comments`**
  - Query: `limit`, `cursor`.
  - Validates task view authorization. Returns non-deleted comments sorted chronologically (`created_at ASC, id ASC`) with `mentions: [{ user_id, full_name }]`.

- **`POST /api/v1/workspaces/:workspaceId/tasks/:taskId/comments`**
  - Body: `{ "content": string, "mentioned_user_ids"?: string[] }`
  - Normalization: trims leading/trailing whitespace; rejects empty-after-trim (`400 VALIDATION_ERROR`); max 2000 chars after trim. Preserves internal spaces/newlines.
  - Deduplicates `mentioned_user_ids` and validates every mention target has active membership and Task-view access (throws `422 INVALID_MENTION_TARGET` if invalid/unauthorized).
  - Response: `201 Created` with comment and resolved mentions.

- **`DELETE /api/v1/workspaces/:workspaceId/tasks/:taskId/comments/:commentId`**
  - Validates actor is comment author or ADMIN. Soft-deletes row (`deleted_at = NOW()`).
  - Repeated authorized DELETE calls on an already soft-deleted comment return `204 No Content` (idempotent).
  - Response: `204 No Content`.

## 11. Notification / Outbox Design
Reuses Phase 7 transactional `outbox_events` and worker BullMQ dispatcher:

| Event Type | Trigger Endpoint | Recipient | Dedup Key | Deep-Link Destination |
|---|---|---|---|---|
| `APPROVAL_REQUESTED` | `POST /approval-requests` | Assigned `approver_user_id` | `approval-req-${reqId}-${stepId}` | `/workspaces/${wid}/approvals?view=inbox&selected_approval_request_id=${reqId}` |
| `APPROVAL_APPROVED` | `POST .../steps/:sid/approve` | `requester_id` | `approval-decided-${reqId}-${stepId}` | `/workspaces/${wid}/approvals?view=sent&selected_approval_request_id=${reqId}` |
| `APPROVAL_REJECTED` | `POST .../steps/:sid/reject` | `requester_id` | `approval-decided-${reqId}-${stepId}` | `/workspaces/${wid}/approvals?view=sent&selected_approval_request_id=${reqId}` |
| `APPROVAL_CANCELLED` | `POST .../cancel` | Assigned `approver_user_id` | `approval-cancelled-${reqId}` | `/workspaces/${wid}/approvals?view=inbox&selected_approval_request_id=${reqId}` |
| `COMMENT_MENTIONED` | `POST /tasks/:tid/comments` | Each unique `mentioned_user_id` (except author) | `comment-mention-${commentId}-${userId}` | `/workspaces/${wid}/tasks?selected_task_id=${taskId}` |

- **Transactional Guarantee:** Outbox events are inserted inside the same database transaction as the business state mutation.
- **Admin Override:** In-app notification payload includes `decided_by_user_id` / `cancelled_by_user_id` so recipient sees if an ADMIN executed the action.

## 12. Comments / Mentions Design
- **Comment Content Normalization:** Trimmed leading/trailing whitespace. 1 to 2000 characters. Internal spaces and newlines preserved. Standard React HTML escaping on web UI.
- **Mentions:** Explicit array `mentioned_user_ids: string[]`. Server deduplicates array to a set, then validates each target against active workspace membership and Task-view authorization (`422 INVALID_MENTION_TARGET`). Stored in `mentions` table. API returns `mentions: [{ user_id, full_name }]`.
- **Deletion:** Soft delete sets `deleted_at = NOW()`. Soft-deleted rows excluded from comment list. DB row and mention rows retained as tombstone/audit state. Existing notifications not retracted; deletion emits no new notification.

## 13. Dashboard Integration
Phase 8 reporting queries are updated to compute live `pending_approvals`:
- **Manager Dashboard (`getManagerDashboard`):**
  - Uses set semantics: `COUNT(DISTINCT approval_steps.id)` where step is `PENDING`, matching the manager's authorized team scope or assigned directly to the manager.
  - For workspace `ADMIN`, counts all workspace `PENDING` steps.
  - Role-aligned Drilldown URLs:
    - **MANAGER:** `/workspaces/:workspaceId/approvals?view=managed&status=PENDING` (appends `&team_id=:teamId` if team filtered).
    - **ADMIN:** `/workspaces/:workspaceId/approvals?view=all&status=PENDING` (appends `&team_id=:teamId` if team filtered).
- **Member Dashboard (`getMemberDashboard`):**
  - Contract preserved from Phase 8. No pending approval metric added to Member Dashboard.

## 14. Web UX & Selected-Item Detail Model
- **Route `/workspaces/:workspaceId/approvals`:**
  - View tabs: **Inbox** (`view=inbox`), **Sent** (`view=sent`), **Managed** (`view=managed`, MANAGER only), and **All** (`view=all`, ADMIN only).
  - Status filter (`status=PENDING|APPROVED|REJECTED|CANCELLED`).
  - Approval List displays cards with title, requester, approver, status pill, and submitted date.
- **Canonical Selected-Item Detail Navigation:**
  - URL format: `/workspaces/:workspaceId/approvals?view=inbox&status=PENDING&selected_approval_request_id=:id`
  - Driven by `selected_approval_request_id` query parameter using Floz's standard selected-item pattern.
  - Deep-linkable and accessible. Closing the detail panel clears `selected_approval_request_id` while preserving list view and filter context.
- **Task Detail Comments Section:**
  - Chronological list (`created_at ASC, id ASC`) with author, timestamp, body, mention chips, and soft-delete button for author/ADMIN.

## 15. Error Contracts
- `400 VALIDATION_ERROR`: Missing title, blank rejection reason, rejection reason shorter than 3 chars, empty content after trim, malformed UUID, invalid cursor.
- `401 UNAUTHENTICATED`: Missing or invalid session.
- `403 FORBIDDEN`: Non-approver attempting decision, non-admin attempting admin override, suspended/inactive approver attempting decision, unauthorized approval detail read, unauthorized team scope, non-author attempting comment deletion, `ACCOUNT_INACTIVE`.
- `404 NOT_FOUND`: Resource missing, or `:stepId` does not belong to `:approvalRequestId`.
- `409 APPROVAL_NOT_PENDING`: Decision or cancellation attempted on non-pending approval.
- `422 CROSS_WORKSPACE_REFERENCE`: Referenced task, approver, or mentioned user belongs to another workspace.
- `422 INACTIVE_APPROVER`: Target approver selected during approval request creation is deactivated or suspended.
- `422 INVALID_APPROVER_TARGET`: Selected approver is active in workspace but lacks canonical Task-view authorization for the linked Task.
- `422 INVALID_MENTION_TARGET`: Mentioned user lacks active membership or is not authorized to view the Task context.
- `422 SELF_APPROVAL_NOT_ALLOWED`: Requester attempting to approve or reject their own request (including ADMIN requester).

## 16. Security Review
- **Cross-workspace isolation & Same-Workspace Invariants:** Enforced via transactional service checks (`task.workspace_id == route workspace`, active membership for requester, approver, and mention targets).
- **Exact Resource Binding:** `:stepId` is locked and verified against `:approvalRequestId` to prevent foreign step mutations.
- **Approval Read Authorization:** Enforced on both list views and direct detail GET endpoints.
- **Self-Approval Loophole Closed:** Enforced for all decision actors (`decision_actor_user_id !== requester_id`).
- **Double Decisions:** Prevented via `SELECT ... FOR UPDATE` row locks.
- **XSS & Mention Spoofing:** Plain text escaping; server-side active task-authorized user validation for mentions (`422 INVALID_MENTION_TARGET`) and task-linked approvers (`422 INVALID_APPROVER_TARGET`).

## 17. Accessibility
- Approval decision confirmation dialogs feature focus trapping and Escape-to-close.
- Deep-linkable selected-item pattern maintains proper keyboard focus management when opening/closing detail.
- High-contrast status badges for `PENDING`, `APPROVED`, `REJECTED`, and `CANCELLED`.

## 18. Testing Strategy
- **Unit & Integration Tests:**
  - State machine transitions (including cancel setting step status to `CANCELLED` with null decision fields).
  - Concurrency lock tests: simultaneous `Approve` vs `Reject`, `Approve` vs `Cancel`, `Reject` vs `Cancel`, and `Cancel` vs `Cancel` asserting exactly one terminal mutation wins and racing losers receive `409 APPROVAL_NOT_PENDING`.
  - Resource binding test: mismatched `:stepId` and `:approvalRequestId` returns `404 NOT_FOUND`.
  - Self-approval prohibition tests for standard members and ADMIN override (`422 SELF_APPROVAL_NOT_ALLOWED`).
  - Target approver inactive at creation returns `422 INACTIVE_APPROVER`.
  - Target approver active but lacking Task-view authorization on linked Task returns `422 INVALID_APPROVER_TARGET`.
  - Suspended approver attempting decision returns `403 FORBIDDEN`; workspace ADMIN override succeeds.
  - Read authorization tests: unauthorized approval detail read attempt returns `403 FORBIDDEN`.
  - Task-linked approval authorization tests for requester and approver.
  - Comment normalization, mention deduplication (asserting zero duplicate mention rows and notifications), and invalid mention target test (`422 INVALID_MENTION_TARGET`).
  - Reason normalization tests for approve (optional, trim), reject (mandatory, 3-500 trim), and cancel (optional, trim).
  - Keyset pagination stability test for equal timestamps (`submitted_at DESC, id DESC`).
  - Manager `view=managed` and dashboard deduplication test: member in two managed teams counted exactly once.
  - Role-aligned drilldown URL test: `view=managed` for MANAGER, `view=all` for ADMIN.
  - Repeated comment DELETE test (idempotent `204`).
- **Worker & Outbox Integration:**
  - Assert outbox event generation and worker delivery to in-app `notifications` with exact deep links.
- **E2E Playwright Tests:**
  - Real-stack flow: Create approval -> Deep link navigation -> Approver decision -> Outbox notification -> Manager dashboard drilldown.

## 19. Migration & Compatibility Strategy
- 1 Drizzle migration creating `approval_requests`, `approval_steps`, `comments`, `mentions`, and required indexes.
- No modifications to existing `tasks` table columns.
- Fully backward compatible with Phase 0–9 API and UI surfaces.

## 20. Alternatives Considered
- **Approvals Embedded into Workflow Transitions:** Rejected because PRD mandates independent operational approval requests unlinked to workflow transitions.
- **Dynamic Regex Mention Parser:** Rejected in favor of structured `mentioned_user_ids` array.
- **Generic Activity Log Table:** Rejected to prevent unnecessary abstraction; domain tables (`approval_steps`, `approval_requests`, `task_history`) provide complete audit reconstruction.

## 21. Decision Table

| Item | Decision | Rationale | Alternatives Rejected | Future Compatibility |
|---|---|---|---|---|
| **API Path** | `/workspaces/:wid/approval-requests` | Matches canonical API specification (§48-50) | `/approvals` | Fully consistent |
| **Approval Scope** | Independent workspace entity with optional Task link | Supports operational approvals and task sign-offs | Task-only approvals | Workflow attachments |
| **Approver Steps** | Single-step MVP via `approval_requests` + `approval_steps` | Minimal complexity; prevents future schema breaking changes | Multi-step sequential rules | Phase 11 multi-step ready |
| **Step Locking** | Bind `:stepId` directly in decision query under `FOR UPDATE` | Prevents foreign step mutations; validates path contract | Ignore stepId in query | Multi-step locking |
| **Cancel Locking** | Lock `approval_requests` then `approval_steps(step_order=1)` FOR UPDATE | Consistent lock ordering; prevents cancel/decision race | Lock request only | Multi-step cancellation |
| **Cancellation Step State** | `approval_steps.status = CANCELLED`, decision fields `null` | Cancellation is distinct from rejection; preserves clean step state | `REJECTED` or preserved pending | Multi-step cancel semantics |
| **Approval Read Policy** | Restricted to Requester, Approver, ADMIN, or authorized MANAGER | Prevents unauthorized member enumeration/snooping | Public workspace read | Role-based ACLs |
| **Detail Navigation** | Selected-item pattern (`?selected_approval_request_id=`) | Matches canonical Floz URL/state architecture | Dedicated routes / Modals | Deep-linkable UI |
| **Eligible Approver** | Any ACTIVE workspace member (including `FIELD_WORKER`) | Assignment grants authority; allows field verification sign-offs | Role-restricted approvers | Configurable per workflow |
| **Approver Validation Errors** | Inactive: `422 INACTIVE_APPROVER`; No Task Access: `422 INVALID_APPROVER_TARGET` | Precise domain errors; avoids reusing comment mention error | Reusing `INVALID_MENTION_TARGET` | Granular policy errors |
| **Self-Approval** | FORBIDDEN for all actors (`decision_actor !== requester`) | Closes ADMIN loophole; separation of duties | Allow ADMIN self-approval | Admin override setting |
| **Inactive Approver Decision** | Suspended/inactive approver attempting decision: `403 FORBIDDEN` | Clear separation between validation error and auth failure | 422 on decision | Granular member states |
| **Decision Actor Audit** | Persist `decided_by_user_id` and `cancelled_by_user_id` | Audit clarity for normal decisions vs ADMIN overrides | Overwrite `approver_user_id` | Full audit log entity |
| **Reason Normalization** | Approve: opt, trim, max 500; Reject: req, trim, 3–500; Cancel: opt, trim, max 500 | Deterministic string sanitization | Unvalidated free text | Configurable lengths |
| **Cancellation** | Requester or ADMIN while `PENDING` | Prevents stale/orphaned approval requests | Approver cancellation | Reason tracking |
| **Task Status Sync** | No automatic task status change | Decouples approval state machine from workflow rules | Auto-advance task | Workflow triggers in Phase 11 |
| **Task History Events** | `APPROVAL_REQUESTED` and `APPROVAL_COMPLETED` with metadata | Matches external ERD and repository conventions | `APPROVAL_DECIDED` / `CANCELLED` | Full lifecycle audit |
| **Comment Deletion** | Soft-delete (`deleted_at`); Author or ADMIN; Idempotent `204` | Preserves tombstone; simple and safe; idempotent API | Hard delete / In-place edit | Comment edit history |
| **Mentions** | Deduplicated array; `422 INVALID_MENTION_TARGET` for ineligible | Deterministic, secure, zero duplicate notifications | Regex parser on server | Interactive token editor |
| **Pagination Order** | Strict `submitted_at DESC, id DESC` via opaque cursor | Guarantees stable ordering across all views | Arbitrary sort / offset | Standard Floz keyset |
| **Dashboard Metric & Drilldown** | Live `pending_approvals` via set semantics; MANAGER `view=managed`, ADMIN `view=all` | Role-aligned drilldown; deduplicates multi-team members | Mismatched drilldowns | Custom KPI drilldowns |
| **Deep-Links** | `selected_approval_request_id=` and `selected_task_id=` | Matches canonical Floz URL parameters | Stale `?id=` or `selectedTask=` | Unified URL router |
| **Same-Workspace Enforcement** | Service-level transactional validation before mutation | Simple FKs only guarantee row existence, not same workspace | Simple DB FKs alone | Tenant-scoped DB schemas |
| **Idempotency Policy** | Generic `Idempotency-Key` DEFERRED; decision endpoints race-safe via `FOR UPDATE` | High concurrency safety without unnecessary storage overhead | Generic idempotency table | API-wide idempotency |
| **DB Migration** | 1 versioned Drizzle migration | Required for new tables and indexes | Untyped JSON columns | Clean rollback path |

## 22. Risks / Open Questions
- **Risk:** Stale Approver (assigned approver suspended/removed while request is pending).
  - *Resolution:* Workspace `ADMIN` override can decide or cancel while request remains `PENDING`. This is the canonical Phase 10 recovery path.
- **Risk:** High comment volume on complex tasks.
  - *Resolution:* Keyset cursor pagination on API (`limit` + `cursor`) ensures scalable fetching.

## 23. Proposed Phase Boundaries
1. Database migration & Drizzle schema.
2. Approval Request & Steps backend API with pessimistic locking, exact stepId binding, exact cancel locking, and read policies.
3. Comments & Mentions backend API with validation, normalization, and mention deduplication.
4. Outbox events & worker notification handlers with canonical deep-links.
5. Manager Dashboard pending approvals query integration with set semantics and role-aligned drilldowns.
6. Web UI (Approvals Inbox/Sent/Managed/All views, selected-item detail panel, Task Comments & Mentions) and Playwright E2E verification.

## 24. Acceptance Criteria
- Active workspace members can create approval requests (standalone or task-linked).
- Creation validates target approver is active (`422 INACTIVE_APPROVER`), possesses Task access if task-linked (`422 INVALID_APPROVER_TARGET`), and forbids self-approval (`422 SELF_APPROVAL_NOT_ALLOWED`).
- Decision endpoints validate exact `:stepId` bound to `:approvalRequestId` under `FOR UPDATE`.
- Cancellation locks request then step (`step_order = 1`) under `FOR UPDATE`, sets status to `CANCELLED` with null decision fields, and records `cancelled_by_user_id` and normalized reason.
- Reason normalization enforced: approve (optional, max 500), reject (mandatory, 3–500), cancel (optional, max 500).
- Read authorization restricts approval list/detail visibility to requester, approver, workspace ADMIN, or authorized MANAGER.
- Concurrency conflicts return `409 APPROVAL_NOT_PENDING` without inconsistent side effects.
- Self-approval is rejected with `422 SELF_APPROVAL_NOT_ALLOWED` for all actors.
- Task comments and mentions persist, paginate chronologically, normalize input, deduplicate mention IDs, validate mention target access (`422 INVALID_MENTION_TARGET`), and support idempotent soft deletion.
- Task history logs `APPROVAL_REQUESTED` and `APPROVAL_COMPLETED` with full audit metadata.
- In-app notifications are reliably delivered via outbox worker using exact canonical deep links (`selected_approval_request_id` and `selected_task_id`).
- Manager Dashboard correctly displays deduplicated pending approval count and supports role-aligned drilldown navigation (`view=managed` for MANAGER, `view=all` for ADMIN).
- All existing Phase 0–9 regression tests and new real-stack E2E tests pass.
