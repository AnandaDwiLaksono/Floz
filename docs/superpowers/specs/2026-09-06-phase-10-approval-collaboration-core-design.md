# Phase 10: Approval & Collaboration Core Design

**Status**: DRAFT DESIGN / AWAITING APPROVAL

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
  - Decisions: Approve (optional reason), Reject (mandatory reason), Cancel (requester or ADMIN while pending, optional reason).
  - Explicit decision/cancellation actor persistence (`decided_by_user_id`, `cancelled_by_user_id`, `cancel_reason`).
  - Complete self-approval prohibition applying to all decision actors (including ADMIN override).
  - Eligible approver: any ACTIVE same-workspace member (including `FIELD_WORKER`).
  - Strict read authorization: visibility limited to requester, assigned approver, workspace ADMIN, or authorized MANAGER within managed-team scope.
  - Floz canonical selected-item pattern for detail navigation: `/workspaces/:workspaceId/approvals?selected_approval_request_id=:id`.
- **Collaboration Core:** 
  - Task comments (plain text, trimmed 1–2000 chars, chronological keyset pagination `created_at ASC, id ASC`, soft-delete).
  - Explicit structured mentions (`mentioned_user_ids: string[]`) validated against active workspace members authorized to view the task context.
  - Response projection includes structured mention chips `mentions: [{ user_id, full_name }]`.
- **Integration:** 
  - Transactional `outbox_events` for approval and mention notifications (`APPROVAL_REQUESTED`, `APPROVAL_APPROVED`, `APPROVAL_REJECTED`, `APPROVAL_CANCELLED`, `COMMENT_MENTIONED`).
  - Exact notification deep-links: `/workspaces/${wid}/approvals?selected_approval_request_id=${reqId}` and `/workspaces/${wid}/tasks?selected_task_id=${taskId}`.
  - Enable live `pending_approvals` count on Manager Dashboard scoped to authorized teams and pending steps assigned to managed members/manager (`view=managed&status=PENDING`); Member Dashboard contract unchanged.
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
- **Mentions (`mentions`)**: Junction entity resolving a comment to a specific `mentioned_user_id`.

## 6. State Machines
**Approval State Machine (`approval_requests.status` and `approval_steps.status`):**
- **Initial State:** `PENDING`
- **Transitions:**
  - `PENDING` -> `APPROVED`:
    - Actor: Assigned `approver_user_id` OR workspace `ADMIN`.
    - Constraint: `actor.id !== approval_requests.requester_id` (No self-approval).
    - Step update: `status = 'APPROVED'`, `decision = 'APPROVED'`, `decided_by_user_id = actor.id`, `decided_at = NOW()`, `reason = input.reason ?? null`.
    - Request update: `status = 'APPROVED'`, `completed_at = NOW()`.
  - `PENDING` -> `REJECTED`:
    - Actor: Assigned `approver_user_id` OR workspace `ADMIN`.
    - Constraint: `actor.id !== approval_requests.requester_id` (No self-approval).
    - Reason: **REQUIRED** (non-empty string, 3–500 chars after trim).
    - Step update: `status = 'REJECTED'`, `decision = 'REJECTED'`, `decided_by_user_id = actor.id`, `decided_at = NOW()`, `reason = input.reason`.
    - Request update: `status = 'REJECTED'`, `completed_at = NOW()`.
  - `PENDING` -> `CANCELLED`:
    - Actor: `approval_requests.requester_id` OR workspace `ADMIN`.
    - Cancel Reason: **OPTIONAL** (string up to 500 chars after trim).
    - Request update: `status = 'CANCELLED'`, `completed_at = NOW()`, `cancelled_by_user_id = actor.id`, `cancel_reason = input.reason ?? null`.
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
- **Eligible Approver:** Any ACTIVE workspace member (including `FIELD_WORKER`). Role does not grant approval authority; explicit assignment in the step does. Self-approval is forbidden (`requester_id !== approver_user_id`).
- **Decide Approval (Approve/Reject):** Assigned `approver_user_id` OR active workspace `ADMIN`. In all cases, `decision_actor_user_id !== requester_id` (ADMIN cannot approve/reject their own requests).
- **Stale Approver Recovery:** If assigned approver is suspended or removed, they cannot decide (`403 INACTIVE_APPROVER`). Workspace `ADMIN` override can decide or cancel while `PENDING`. ADMIN override does NOT require original assigned approver to still be active (so long as ADMIN is active and not the requester). This is the canonical recovery path for stalled approvals.
- **Cancel Approval:** Requester or active workspace `ADMIN`.
- **Comment Creation & Reading:** Actor must be ACTIVE and authorized to view the Task.
- **Mention Target:** Must be an ACTIVE same-workspace member authorized to view the Task.
- **Comment Deletion:** Comment author OR workspace `ADMIN`.

## 8. Concurrency / Transaction Semantics & Idempotency
- **Canonical Pessimistic Lock Order:**
  1. `BEGIN` transaction.
  2. `SELECT * FROM approval_requests WHERE id = $1 AND workspace_id = $2 FOR UPDATE`
  3. `SELECT * FROM approval_steps WHERE approval_request_id = $1 AND step_order = 1 FOR UPDATE`
  4. Verify both records exist (throw `404 NOT_FOUND` if missing).
  5. Validate `approval_requests.status === 'PENDING'`. If not, throw `409 APPROVAL_NOT_PENDING` with `{ current_status: request.status }`.
  6. Validate actor active membership, read access, and decision permissions.
  7. For Approve/Reject: validate `actor.id !== request.requester_id` (throw `422 SELF_APPROVAL_NOT_ALLOWED` if violated).
  8. Update `approval_steps` row.
  9. Update `approval_requests` row.
  10. Insert `outbox_events` row (transactional notification handoff).
  11. If `task_id` is present, insert `task_history` entry (`APPROVAL_DECIDED` or `APPROVAL_CANCELLED`).
  12. `COMMIT` transaction.
- **Idempotency & Retry Policy:**
  - Generic `Idempotency-Key` table persistence = **DEFERRED**.
  - **Create Approval & Create Comment:** Atomic single-submit transactions. Web UI disables submission buttons during flight. Callers must not blindly retry ambiguous network failures.
  - **Approve / Reject / Cancel:** Fully race-safe via `FOR UPDATE` lock and terminal state recheck. First valid terminal mutation commits. Racing or duplicate retry submissions safely return `409 APPROVAL_NOT_PENDING` without creating duplicate outbox events or history entries.

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
  wsStatusSubmitted: index('approval_requests_ws_status_submitted_idx').on(table.workspaceId, table.status, table.submittedAt),
  wsRequesterStatus: index('approval_requests_ws_requester_status_idx').on(table.workspaceId, table.requesterId, table.status, table.submittedAt),
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
  wsApproverStatus: index('approval_steps_ws_approver_status_idx').on(table.workspaceId, table.approverUserId, table.status, table.createdAt)
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
  wsTaskCreated: index('comments_ws_task_created_id_idx').on(table.workspaceId, table.taskId, table.createdAt, table.id)
}));

export const mentions = pgTable('mentions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  commentId: uuid('comment_id').notNull().references(() => comments.id),
  mentionedUserId: uuid('mentioned_user_id').notNull().references(() => users.id),
  createdAt: now()
}, (table) => ({
  commentUser: unique().on(table.commentId, table.mentionedUserId),
  wsMentionedUser: index('mentions_ws_user_idx').on(table.workspaceId, table.mentionedUserId, table.createdAt)
}));
```

## 10. API Design
Canonical REST API surface matching specification:

- **`POST /api/v1/workspaces/:workspaceId/approval-requests`**
  - Body: `{ "title": string, "description"?: string, "task_id"?: string, "approver_user_id": string }`
  - Validates `approver_user_id !== actor.id` and active workspace memberships. If `task_id` is present, validates Task-view authorization. Creates request and single step (`step_order = 1`).
  - Response: `201 Created` with full Approval Request & step projection.

- **`GET /api/v1/workspaces/:workspaceId/approval-requests`**
  - Query: 
    - `view`: `inbox` (assigned to user), `sent` (created by user), `managed` (MANAGER only; approvals assigned to managed team members/manager), `all` (ADMIN only; workspace-wide). Default `inbox`.
    - `status`: `PENDING` | `APPROVED` | `REJECTED` | `CANCELLED`.
    - `team_id`: optional team scope for `managed` or `all` views (validates Phase 8 manager scope; throws `403 FORBIDDEN` if unauthorized).
    - `limit`, `cursor`.
  - Response: `{ data: ApprovalRequestSummary[], meta: { pagination: { limit, next_cursor, has_more } } }`.

- **`GET /api/v1/workspaces/:workspaceId/approval-requests/:approvalRequestId`**
  - Enforces read authorization (requester, approver, workspace ADMIN, or authorized MANAGER).
  - Returns complete Approval Detail with reconstructed audit fields (created by/when, assigned to, decided by/when/reason, cancelled by/when/reason, linked task summary if authorized).

- **`POST /api/v1/workspaces/:workspaceId/approval-requests/:approvalRequestId/steps/:stepId/approve`**
  - Body: `{ "reason"?: string }`
  - Validates actor is assigned approver or ADMIN, and `actor.id !== requester_id`.
  - Response: `200 OK` with updated request and step.

- **`POST /api/v1/workspaces/:workspaceId/approval-requests/:approvalRequestId/steps/:stepId/reject`**
  - Body: `{ "reason": string }` (Reason mandatory, 3–500 chars).
  - Validates actor is assigned approver or ADMIN, and `actor.id !== requester_id`.
  - Response: `200 OK` with updated request and step.

- **`POST /api/v1/workspaces/:workspaceId/approval-requests/:approvalRequestId/cancel`**
  - Body: `{ "reason"?: string }`
  - Validates actor is requester or ADMIN, and request is `PENDING`. Sets step status to `CANCELLED`.
  - Response: `200 OK` with updated request and step.

- **`GET /api/v1/workspaces/:workspaceId/tasks/:taskId/comments`**
  - Query: `limit`, `cursor`.
  - Validates task view authorization. Returns non-deleted comments sorted chronologically (`created_at ASC, id ASC`) with `mentions: [{ user_id, full_name }]`.

- **`POST /api/v1/workspaces/:workspaceId/tasks/:taskId/comments`**
  - Body: `{ "content": string, "mentioned_user_ids"?: string[] }`
  - Normalization: trims leading/trailing whitespace; rejects empty-after-trim (`400 VALIDATION_ERROR`); max 2000 chars after trim. Preserves internal spaces/newlines.
  - Validates all `mentioned_user_ids` are active workspace members authorized to view the task.
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
| `COMMENT_MENTIONED` | `POST /tasks/:tid/comments` | Each `mentioned_user_id` (except author) | `comment-mention-${commentId}-${userId}` | `/workspaces/${wid}/tasks?selected_task_id=${taskId}` |

- **Transactional Guarantee:** Outbox events are inserted inside the same database transaction as the business state mutation.
- **Admin Override:** In-app notification payload includes `decided_by_user_id` / `cancelled_by_user_id` so recipient sees if an ADMIN executed the action.

## 12. Comments / Mentions Design
- **Comment Content Normalization:** Trimmed leading/trailing whitespace. 1 to 2000 characters. Internal spaces and newlines preserved. Standard React HTML escaping on web UI.
- **Mentions:** Explicit array `mentioned_user_ids: string[]`. Validated against active workspace membership and task authorization. Stored in `mentions` table. API returns `mentions: [{ user_id, full_name }]`.
- **Deletion:** Soft delete sets `deleted_at = NOW()`. Soft-deleted rows excluded from comment list. DB row and mention rows retained as tombstone/audit state. Existing notifications not retracted; deletion emits no new notification.

## 13. Dashboard Integration
Phase 8 reporting queries are updated to compute live `pending_approvals`:
- **Manager Dashboard (`getManagerDashboard`):**
  - Returns count of `PENDING` approval steps assigned to members inside the manager's authorized team scope, or assigned directly to the manager. Workspace `ADMIN` counts all workspace `PENDING` steps.
  - Drilldown URL: `/workspaces/:workspaceId/approvals?view=managed&status=PENDING` (appends `&team_id=...` if team filter active on dashboard).
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
- `400 VALIDATION_ERROR`: Missing title, blank rejection reason, empty content after trim, malformed UUID, invalid cursor.
- `401 UNAUTHENTICATED`: Missing or invalid session.
- `403 FORBIDDEN`: Non-approver attempting decision, non-admin attempting admin override, unauthorized approval detail read, unauthorized team scope, non-author attempting comment deletion, `ACCOUNT_INACTIVE`.
- `404 NOT_FOUND`: Resource missing.
- `409 APPROVAL_NOT_PENDING`: Decision or cancellation attempted on non-pending approval.
- `422 CROSS_WORKSPACE_REFERENCE`: Referenced task, approver, or mentioned user belongs to another workspace.
- `422 SELF_APPROVAL_NOT_ALLOWED`: Requester attempting to approve or reject their own request (including ADMIN requester).
- `422 INACTIVE_APPROVER`: Assigned approver is deactivated or suspended.

## 16. Security Review
- **Cross-workspace isolation & Same-Workspace Invariants:** Enforced via transactional service checks (`task.workspace_id == route workspace`, active membership for requester, approver, and mention targets).
- **Approval Read Authorization:** Enforced on both list views and direct detail GET endpoints.
- **Self-Approval Loophole Closed:** Enforced for all decision actors (`decision_actor_user_id !== requester_id`).
- **Double Decisions:** Prevented via `SELECT ... FOR UPDATE` row locks.
- **XSS & Mention Spoofing:** Plain text escaping; server-side active task-authorized user validation for mentions.

## 17. Accessibility
- Approval decision confirmation dialogs feature focus trapping and Escape-to-close.
- Deep-linkable selected-item pattern maintains proper keyboard focus management when opening/closing detail.
- High-contrast status badges for `PENDING`, `APPROVED`, `REJECTED`, and `CANCELLED`.

## 18. Testing Strategy
- **Unit & Integration Tests:**
  - State machine transitions (including cancel setting step status to `CANCELLED` with null decision fields).
  - Concurrency lock tests: simultaneous `Approve` vs `Reject` and `Approve` vs `Cancel` asserting one success and one `409 APPROVAL_NOT_PENDING`.
  - Self-approval prohibition tests for standard members and ADMIN override.
  - Read authorization tests: unauthorized approval detail read attempt returns `403 FORBIDDEN`.
  - Task-linked approval authorization tests for requester and approver.
  - Stale approver + ADMIN override recovery test.
  - Comment normalization, keyset pagination, and repeated soft delete (idempotent `204`).
  - Manager `view=managed` scope authorization and team filter tests.
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
| **Cancellation Step State** | `approval_steps.status = CANCELLED`, decision fields `null` | Cancellation is distinct from rejection; preserves clean step state | `REJECTED` or preserved pending | Multi-step cancel semantics |
| **Approval Read Policy** | Restricted to Requester, Approver, ADMIN, or authorized MANAGER | Prevents unauthorized member enumeration/snooping | Public workspace read | Role-based ACLs |
| **Detail Navigation** | Selected-item pattern (`?selected_approval_request_id=`) | Matches canonical Floz URL/state architecture | Dedicated routes / Modals | Deep-linkable UI |
| **Eligible Approver** | Any ACTIVE workspace member (including `FIELD_WORKER`) | Assignment grants authority; allows field verification sign-offs | Role-restricted approvers | Configurable per workflow |
| **Self-Approval** | FORBIDDEN for all actors (`decision_actor !== requester`) | Closes ADMIN loophole; separation of duties | Allow ADMIN self-approval | Admin override setting |
| **Decision Actor Audit** | Persist `decided_by_user_id` and `cancelled_by_user_id` | Audit clarity for normal decisions vs ADMIN overrides | Overwrite `approver_user_id` | Full audit log entity |
| **Rejection Reason** | REQUIRED (3–500 chars) | Constructive feedback mandatory for rejections | Optional rejection reason | Configurable rules |
| **Cancellation** | Requester or ADMIN while `PENDING` | Prevents stale/orphaned approval requests | Approver cancellation | Reason tracking |
| **Task Status Sync** | No automatic task status change | Decouples approval state machine from workflow rules | Auto-advance task | Workflow triggers in Phase 11 |
| **Comment Deletion** | Soft-delete (`deleted_at`); Author or ADMIN; Idempotent `204` | Preserves tombstone; simple and safe; idempotent API | Hard delete / In-place edit | Comment edit history |
| **Mentions** | Structured `mentioned_user_ids` array | Deterministic, secure, zero parsing overhead | Regex parser on server | Interactive token editor |
| **Dashboard Metric** | Live `pending_approvals` on Manager Dashboard (`view=managed`); Member Dashboard unchanged | Fulfills deferred Phase 8 metric; Member Dashboard unchanged | Requester pending on Member | Custom KPI drilldowns |
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
2. Approval Request & Steps backend API with pessimistic locking and read policies.
3. Comments & Mentions backend API with validation and normalization.
4. Outbox events & worker notification handlers with canonical deep-links.
5. Manager Dashboard pending approvals query integration.
6. Web UI (Approvals Inbox/Sent/Managed/All views, selected-item detail panel, Task Comments & Mentions) and Playwright E2E verification.

## 24. Acceptance Criteria
- Active workspace members can create approval requests (standalone or task-linked).
- Assigned approvers can approve (optional reason) or reject (mandatory reason).
- Cancellation sets request and step status to `CANCELLED` with null decision fields and records `cancelled_by_user_id`.
- Read authorization restricts approval list/detail visibility to requester, approver, workspace ADMIN, or authorized MANAGER.
- Concurrency conflicts return `409 APPROVAL_NOT_PENDING` without inconsistent side effects.
- Self-approval is rejected with `422 SELF_APPROVAL_NOT_ALLOWED` for all actors.
- Task comments and mentions persist, paginate chronologically, normalize input, and support idempotent soft deletion.
- In-app notifications are reliably delivered via outbox worker using exact canonical deep links (`selected_approval_request_id` and `selected_task_id`).
- Manager Dashboard correctly displays pending approval count for `view=managed&status=PENDING` and supports drilldown navigation.
- All existing Phase 0–9 regression tests and new real-stack E2E tests pass.
