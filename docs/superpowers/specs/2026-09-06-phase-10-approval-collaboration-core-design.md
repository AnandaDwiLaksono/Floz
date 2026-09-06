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
  - Decisions: Approve (optional reason), Reject (mandatory reason), Cancel (requester or ADMIN while pending, optional reason).
  - Explicit decision/cancellation actor persistence (`decided_by_user_id`, `cancelled_by_user_id`, `cancel_reason`).
  - Complete self-approval prohibition applying to all decision actors (including ADMIN override).
  - Eligible approver: any ACTIVE same-workspace member (including `FIELD_WORKER`).
- **Collaboration Core:** 
  - Task comments (plain text up to 2000 chars, chronological keyset pagination `created_at ASC, id ASC`, soft-delete).
  - Explicit structured mentions (`mentioned_user_ids: string[]`) validated against active workspace members authorized to view the task.
  - Response projection includes structured mention chips `mentions: [{ user_id, full_name }]`.
- **Integration:** 
  - Transactional `outbox_events` for approval and mention notifications (`APPROVAL_REQUESTED`, `APPROVAL_APPROVED`, `APPROVAL_REJECTED`, `APPROVAL_CANCELLED`, `COMMENT_MENTIONED`).
  - Enable live `pending_approvals` count on Manager Dashboard scoped to authorized teams and pending steps assigned to the manager; Member Dashboard contract unchanged.
- **Web UI:** 
  - Approval Inbox/Sent views at `/workspaces/:workspaceId/approvals`.
  - Approval Detail with complete audit reconstruction (created by/when, assigned to, decided by/when/reason, cancelled by/when/reason).
  - Task Detail Comments section with structured mention chips and delete action.

## 4. Explicit Non-Goals
To prevent scope creep, the following are strictly excluded from Phase 10:
- Phase 11 Workflow Configuration UI, custom approval workflows, multi-stage approval rules, or dynamic status transition triggers.
- Automatic task status changes based on approval decisions.
- Multi-step approval execution (schema supports steps, but Phase 10 application logic enforces exactly 1 step).
- Parallel approvers, quorum, external/guest approvers.
- Attachments, rich-text editing, inline token-position rendering, comment editing, comment reactions.
- Email/push notification delivery and notification preferences UI.
- Historical KPI snapshots, custom KPI formulas, reporting exports, offline mode.

## 5. Domain Model
- **Approval Requests (`approval_requests`)**: Independent entity scoped to a workspace, with optional context link to `task_id`. Tracks requester, title, description, aggregate status, submission timestamp, completion timestamp, cancellation actor, and cancel reason.
- **Approval Steps (`approval_steps`)**: Child entity tracking the assigned approver (`approver_user_id`), the actual decision actor (`decided_by_user_id`), step order, decision status, decision type, decision reason, and decision timestamp. In Phase 10, exactly one step (`step_order = 1`) is created per request.
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
    - Reason: **REQUIRED** (non-empty string, 3–500 chars).
    - Step update: `status = 'REJECTED'`, `decision = 'REJECTED'`, `decided_by_user_id = actor.id`, `decided_at = NOW()`, `reason = input.reason`.
    - Request update: `status = 'REJECTED'`, `completed_at = NOW()`.
  - `PENDING` -> `CANCELLED`:
    - Actor: `approval_requests.requester_id` OR workspace `ADMIN`.
    - Cancel Reason: **OPTIONAL** (string up to 500 chars).
    - Request update: `status = 'CANCELLED'`, `completed_at = NOW()`, `cancelled_by_user_id = actor.id`, `cancel_reason = input.reason ?? null`.
    - Step update: `status = 'REJECTED'` or preserved as terminal state.
- **Terminal Behavior:** `APPROVED`, `REJECTED`, and `CANCELLED` are immutable terminal states. Any mutation attempt on non-pending approvals throws `409 APPROVAL_NOT_PENDING`.

## 7. Authorization Model
- **Workspace Isolation:** All endpoints strictly require an active workspace membership matching the route `workspaceId`.
- **Create Approval Request:** Any ACTIVE workspace member (ADMIN, MANAGER, MEMBER, FIELD_WORKER).
- **Eligible Approver:** Any ACTIVE workspace member (including `FIELD_WORKER`). Role does not grant approval authority; explicit assignment in the approval step does. Self-approval is forbidden (`requester_id !== approver_user_id`).
- **Decide Approval (Approve/Reject):** Only the assigned `approver_user_id` OR an active workspace `ADMIN` (ADMIN override). In all cases, `decision_actor_user_id !== requester_id` (ADMIN cannot approve/reject their own requests).
- **Cancel Approval:** Requester or active workspace `ADMIN`.
- **Comment Creation & Reading:** Actor must be ACTIVE and authorized to view the task context.
- **Mention Target:** Must be an ACTIVE same-workspace member authorized to view the task context.
- **Comment Deletion:** Comment author OR workspace `ADMIN`.

## 8. Concurrency / Transaction Semantics
To prevent races between concurrent decisions, double submissions, or approve vs cancel:
- **Canonical Pessimistic Lock Order:**
  1. `BEGIN` transaction.
  2. `SELECT * FROM approval_requests WHERE id = $1 AND workspace_id = $2 FOR UPDATE`
  3. `SELECT * FROM approval_steps WHERE approval_request_id = $1 AND step_order = 1 FOR UPDATE`
  4. Verify both records exist (throw `404 NOT_FOUND` if missing).
  5. Validate `approval_requests.status === 'PENDING'`. If not, throw `409 APPROVAL_NOT_PENDING` with `{ current_status: request.status }`.
  6. Validate actor active membership and permissions.
  7. For Approve/Reject: validate `actor.id !== request.requester_id` (throw `422 SELF_APPROVAL_NOT_ALLOWED` if violated).
  8. Update `approval_steps` row.
  9. Update `approval_requests` row.
  10. Insert `outbox_events` row (transactional notification handoff).
  11. If `task_id` is present, insert `task_history` entry (`APPROVAL_DECIDED` or `APPROVAL_CANCELLED`).
  12. `COMMIT` transaction.

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
  - Validates `approver_user_id !== actor.id` and active workspace memberships. Creates request and single step (`step_order = 1`).
  - Response: `201 Created` with full Approval Request & step projection.

- **`GET /api/v1/workspaces/:workspaceId/approval-requests`**
  - Query: `view` (`inbox` | `sent`, default `inbox`), `status` (`PENDING` | `APPROVED` | `REJECTED` | `CANCELLED`), `limit`, `cursor`.
  - Inbox view returns requests where `approver_user_id = current_user`. Sent view returns requests where `requester_id = current_user`.
  - Response: `{ data: ApprovalRequestSummary[], meta: { pagination: { limit, next_cursor, has_more } } }`.

- **`GET /api/v1/workspaces/:workspaceId/approval-requests/:approvalRequestId`**
  - Returns complete Approval Detail with reconstructed audit fields (created by, assigned to, decided by, decision reason, cancelled by, cancel reason, linked task summary).

- **`POST /api/v1/workspaces/:workspaceId/approval-requests/:approvalRequestId/steps/:stepId/approve`**
  - Body: `{ "reason"?: string }`
  - Validates actor is assigned approver or ADMIN, and `actor.id !== requester_id`.
  - Response: `200 OK` with updated request and step.

- **`POST /api/v1/workspaces/:workspaceId/approval-requests/:approvalRequestId/steps/:stepId/reject`**
  - Body: `{ "reason": string }` (Reason is mandatory).
  - Validates actor is assigned approver or ADMIN, and `actor.id !== requester_id`.
  - Response: `200 OK` with updated request and step.

- **`POST /api/v1/workspaces/:workspaceId/approval-requests/:approvalRequestId/cancel`**
  - Body: `{ "reason"?: string }`
  - Validates actor is requester or ADMIN, and request is `PENDING`.
  - Response: `200 OK` with updated request.

- **`GET /api/v1/workspaces/:workspaceId/tasks/:taskId/comments`**
  - Query: `limit`, `cursor`.
  - Returns non-deleted comments sorted chronologically (`created_at ASC, id ASC`) with `mentions: [{ user_id, full_name }]`.

- **`POST /api/v1/workspaces/:workspaceId/tasks/:taskId/comments`**
  - Body: `{ "content": string, "mentioned_user_ids"?: string[] }`
  - Validates content length (1–2000 chars) and validates all `mentioned_user_ids` are active workspace members authorized for the task.
  - Response: `201 Created` with comment and resolved mentions.

- **`DELETE /api/v1/workspaces/:workspaceId/tasks/:taskId/comments/:commentId`**
  - Validates actor is comment author or ADMIN. Soft-deletes row (`deleted_at = NOW()`).
  - Response: `204 No Content`.

## 11. Notification / Outbox Design
Reuses Phase 7 transactional `outbox_events` and worker BullMQ dispatcher:

| Event Type | Trigger Endpoint | Recipient | Dedup Key | Deep-Link Destination |
|---|---|---|---|---|
| `APPROVAL_REQUESTED` | `POST /approval-requests` | Assigned `approver_user_id` | `approval-req-${reqId}-${stepId}` | `/workspaces/${wid}/approvals?id=${reqId}` |
| `APPROVAL_APPROVED` | `POST .../steps/:sid/approve` | `requester_id` | `approval-decided-${reqId}-${stepId}` | `/workspaces/${wid}/approvals?id=${reqId}` |
| `APPROVAL_REJECTED` | `POST .../steps/:sid/reject` | `requester_id` | `approval-decided-${reqId}-${stepId}` | `/workspaces/${wid}/approvals?id=${reqId}` |
| `APPROVAL_CANCELLED` | `POST .../cancel` | Assigned `approver_user_id` | `approval-cancelled-${reqId}` | `/workspaces/${wid}/approvals?id=${reqId}` |
| `COMMENT_MENTIONED` | `POST /tasks/:tid/comments` | Each `mentioned_user_id` (except author) | `comment-mention-${commentId}-${userId}` | `/workspaces/${wid}/tasks?selectedTask=${taskId}` |

- **Transactional Guarantee:** Outbox events are inserted inside the same database transaction as the business state mutation.
- **Admin Override:** In-app notification payload includes `decided_by_user_id` / `cancelled_by_user_id` so the recipient sees if an ADMIN executed the action.

## 12. Comments / Mentions Design
- **Comment Text:** Plain text only (max 2000 characters). Rendered securely using React standard auto-escaping.
- **Mentions:** Structured payload `mentioned_user_ids: string[]`. Backend validates each ID against active workspace membership. Stored in `mentions` table. API returns structured chips `mentions: [{ user_id, full_name }]`. Inline token positions are not persisted in Phase 10.
- **Deletion:** Soft delete retains the row as tombstone. Query filters out soft-deleted comments. Deletion does not retract existing in-app notifications.

## 13. Dashboard Integration
Phase 8 reporting queries are updated to compute live `pending_approvals`:
- **Manager Dashboard (`getManagerDashboard`):**
  - Returns count of `PENDING` approval steps assigned to users in the manager's authorized team scope, or assigned directly to the manager.
  - For workspace `ADMIN`, counts all `PENDING` approval steps across the workspace.
  - Drilldown link: `/workspaces/:workspaceId/approvals?status=PENDING` (appends `&team_id=...` if team filtered).
- **Member Dashboard (`getMemberDashboard`):**
  - Contract preserved. No pending approval metric added to Member Dashboard.

## 14. Web UX / Routes
- **Route `/workspaces/:workspaceId/approvals`:**
  - Tab navigation: **Inbox** (pending decisions for current user), **Sent** (requests submitted by current user), and **All/Completed** (for ADMINs/Managers).
  - Filter by status (`PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`).
  - Approval Card: title, requester name, submit date, linked task badge, status pill.
- **Approval Detail (Slide-Over or Modal):**
  - Header with status badge and created timestamp.
  - Requester info and assigned Approver info.
  - Full description and linked Task details (with link to open Task).
  - Decision audit trail: "Approved by [User] at [Time]" or "Rejected by [User] at [Time] — Reason: [Reason]".
  - Action buttons: `Approve` (opens dialog with optional reason), `Reject` (opens dialog with mandatory reason), `Cancel Request` (for requester/ADMIN).
- **Task Detail Comments Section:**
  - Chronological comment list with author avatar, name, relative timestamp, plain-text body, and mention badges.
  - Comment composer with text area and member multi-select dropdown for mentions.
  - Delete button on comment for author/ADMIN with confirmation.

## 15. Error Contracts
- `400 VALIDATION_ERROR`: Missing title, blank rejection reason, malformed UUID, invalid cursor.
- `401 UNAUTHENTICATED`: Missing or invalid session.
- `403 FORBIDDEN`: Non-approver attempting decision, non-admin attempting admin override, non-author attempting comment deletion, `ACCOUNT_INACTIVE`.
- `404 NOT_FOUND`: Resource missing.
- `409 APPROVAL_NOT_PENDING`: Decision or cancellation attempted on non-pending approval.
- `422 CROSS_WORKSPACE_REFERENCE`: Referenced task, approver, or mentioned user belongs to another workspace.
- `422 SELF_APPROVAL_NOT_ALLOWED`: Requester attempting to approve or reject their own request (including ADMIN requester).
- `422 INACTIVE_APPROVER`: Assigned approver is deactivated or suspended.

## 16. Security Review
- **Cross-workspace isolation:** Guaranteed via strict `workspace_id` filtering on all tables and foreign keys.
- **Self-Approval Loophole Closed:** Prevented at both creation and decision time (`actor.id !== requester_id`).
- **Double Decisions:** Prevented via `SELECT ... FOR UPDATE` row locks.
- **XSS Prevention:** Stored as plain text; rendered safely via React standard escaping.
- **Mention Spoofing:** Server-side verification ensures mentioned IDs exist, are active members, and have task access.
- **Stale Membership:** Approver/decision actor active status verified under lock at decision time.

## 17. Accessibility
- Approve/Reject/Cancel actions feature keyboard-navigable confirmation dialogs with focus trap and Escape-to-close.
- Clear `aria-live` announcements for comment posting and deletion.
- High-contrast status badges for `PENDING`, `APPROVED`, `REJECTED`, and `CANCELLED`.

## 18. Testing Strategy
- **Unit & Integration Tests:**
  - State machine transitions & invalid transition rejection.
  - Concurrency test: simultaneous `Approve` vs `Reject` and `Approve` vs `Cancel` under race conditions to assert exactly one terminal commit and one `409 APPROVAL_NOT_PENDING`.
  - Self-approval enforcement test for standard members and ADMIN override.
  - Soft-delete comment behavior and keyset pagination stability.
  - Same-workspace reference validations.
- **Worker & Outbox Integration:**
  - Verify outbox event insertion and worker dispatch to in-app `notifications` and `notification_dedup_ledger`.
- **E2E Playwright Tests:**
  - Member creates task-linked approval request -> Approver sees item in Inbox -> Approver approves -> Requester receives notification.
  - Task comment posting with mentions -> Mentioned user receives in-app notification.
  - Dashboard pending approval count increments and supports drilldown.

## 19. Migration & Compatibility Strategy
- 1 Drizzle migration creating `approval_requests`, `approval_steps`, `comments`, `mentions`, and required indexes.
- No modifications to existing `tasks` table columns.
- Fully backward compatible with Phase 0–9 API and UI surfaces.

## 20. Alternatives Considered
- **Approvals Embedded into Workflow Transitions:** Rejected because PRD mandates independent operational approval requests unlinked to workflow transitions.
- **Dynamic Regex Mention Parser:** Rejected in favor of structured `mentioned_user_ids` array to eliminate parsing ambiguities, performance bugs, and XSS risks.
- **Generic Activity Log Table:** Rejected to prevent unnecessary abstraction; domain tables (`approval_steps`, `approval_requests`, `task_history`) provide complete audit reconstruction.

## 21. Decision Table

| Item | Decision | Rationale | Alternatives Rejected | Future Compatibility |
|---|---|---|---|---|
| **API Path** | `/workspaces/:wid/approval-requests` | Matches canonical API specification (§48-50) | `/approvals` | Fully consistent |
| **Approval Scope** | Independent workspace entity with optional Task link | Supports operational approvals and task sign-offs | Task-only approvals | Workflow attachments |
| **Approver Steps** | Single-step MVP via `approval_requests` + `approval_steps` | Minimal complexity; prevents future schema breaking changes | Multi-step sequential rules | Phase 11 multi-step ready |
| **Eligible Approver** | Any ACTIVE workspace member (including `FIELD_WORKER`) | Assignment grants authority; allows field verification sign-offs | Role-restricted approvers | Configurable per workflow |
| **Self-Approval** | FORBIDDEN for all actors (`decision_actor !== requester`) | Closes ADMIN loophole; separation of duties | Allow ADMIN self-approval | Admin override setting |
| **Decision Actor Audit** | Persist `decided_by_user_id` and `cancelled_by_user_id` | Audit clarity for normal decisions vs ADMIN overrides | Overwrite `approver_user_id` | Full audit log entity |
| **Rejection Reason** | REQUIRED (3–500 chars) | Constructive feedback mandatory for rejections | Optional rejection reason | Configurable rules |
| **Cancellation** | Requester or ADMIN while `PENDING` | Prevents stale/orphaned approval requests | Approver cancellation | Reason tracking |
| **Task Status Sync** | No automatic task status change | Decouples approval state machine from workflow rules | Auto-advance task | Workflow triggers in Phase 11 |
| **Comment Deletion** | Soft-delete (`deleted_at`); Author or ADMIN | Preserves tombstone; simple and safe | Hard delete / In-place edit | Comment edit history |
| **Mentions** | Structured `mentioned_user_ids` array | Deterministic, secure, zero parsing overhead | Regex parser on server | Interactive token editor |
| **Dashboard Metric** | Live `pending_approvals` on Manager Dashboard | Fulfills deferred Phase 8 metric; Member Dashboard unchanged | Requester pending on Member | Custom KPI drilldowns |
| **Lock Ordering** | `approval_requests` FOR UPDATE -> `approval_steps` FOR UPDATE | Prevents deadlocks; guarantees race safety | Optimistic versioning | High concurrency safety |
| **DB Migration** | 1 versioned Drizzle migration | Required for new tables and indexes | Untyped JSON columns | Clean rollback path |

## 22. Risks / Open Questions
- **Risk:** Stale Approver. If an assigned approver is suspended or leaves the workspace while a request is pending, the request could stall.
  - *Resolution:* Workspace `ADMIN` can override the decision or cancel the request.
- **Risk:** High comment volume on complex tasks.
  - *Resolution:* Keyset cursor pagination on API (`limit` + `cursor`) ensures scalable fetching.

## 23. Proposed Phase Boundaries
1. Database migration & Drizzle schema.
2. Approval Request & Steps backend API with pessimistic locking.
3. Comments & Mentions backend API with validation.
4. Outbox events & worker notification handlers.
5. Manager Dashboard pending approvals query integration.
6. Web UI (Approvals Inbox/Detail, Task Comments & Mentions) and Playwright E2E verification.

## 24. Acceptance Criteria
- Active workspace members can create approval requests (standalone or task-linked).
- Assigned approvers can approve (optional reason) or reject (mandatory reason).
- Requesters and ADMINs can cancel pending requests.
- Concurrency conflicts return `409 APPROVAL_NOT_PENDING` without inconsistent side effects.
- Self-approval is rejected with `422 SELF_APPROVAL_NOT_ALLOWED`.
- Task comments and mentions persist, paginate chronologically, and support author/admin soft deletion.
- In-app notifications are reliably delivered via the outbox worker for approvals and mentions.
- Manager Dashboard correctly displays pending approval count and supports drilldown navigation.
- All existing Phase 0–9 regression tests and new real-stack E2E tests pass.
