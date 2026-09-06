# Phase 10: Approval & Collaboration Core Design

**Status**: DRAFT DESIGN / AWAITING APPROVAL

## 1. Current State Reconstructed
Phase 9 is complete, accepted, and frozen (master HEAD: `f4f2076`). The core platform provides workspace isolation, tasks, Kanban, Calendar, Recurrence, Notifications, Dashboards, and comprehensive Administration. Approval and collaboration functions are entirely absent. The database contains zero tables for approvals, comments, or mentions. The `outbox_events` and worker infrastructure successfully process async transactional events for recurrence and notifications. The Phase 8 Dashboard API exists but `pending_approvals` metrics were deferred pending this design.

## 2. Problem / Goal
Floz needs the core Approval & Collaboration capability for Gate B (Collaborative Pilot). Teams must be able to request formal approvals (optionally linked to tasks), make binding approval/rejection decisions safely under concurrency, converse via task comments, and alert colleagues using mentions. The design must integrate with the existing in-app notification outbox engine and dashboard projections.

## 3. Proposed Phase 10 Scope
- **Approval Core:** Request creation, approver assignment (1 step), Inbox (`/workspaces/:wid/approvals`), Detail view, canonical state machine (PENDING, APPROVED, REJECTED, CANCELLED), and robust double-decision protection.
- **Collaboration Core:** Task comments (text, chronological list, soft-delete) and explicit structured mentions.
- **Integration:** 
  - Transactional `outbox_events` for approval/mention notifications.
  - Enabling the `pending_approvals` count on Manager/Member dashboards.
- **UI:** Approval list, task/approval detail components, comment timeline, and mention selection.

## 4. Explicit Non-Goals
To prevent scope creep, the following are strictly excluded from Phase 10:
- Phase 11 Workflow Configuration UI, multi-stage approval rules, or dynamic transition triggers.
- Automatic task status changes based on approval decisions.
- Parallel approvers, quorum, external/guest approvers.
- Attachments, rich-text comment editing, or comment edit history.
- Comment reactions.
- Email/push notification delivery and notification preferences UI.
- Historical KPI snapshots, custom KPI formulas, or reporting exports.

## 5. Domain Model
**Approval Requests (`approval_requests`)**: Independent entity scoped to a workspace, capable of an optional context link to a `task_id`.
**Approval Steps (`approval_steps`)**: Child entity tracking the specific approver assigned. For MVP, one step is created alongside the request.
**Comments (`comments`)**: Textual collaboration tied to a `task_id`.
**Mentions (`mentions`)**: A junction entity resolving a comment to a specific `user_id`.

## 6. State Machines
**Approval State Machine:**
- Initial State: `PENDING`.
- Transitions:
  - `PENDING` -> `APPROVED`: Allowed by Assigned Approver (or Admin override). Reason is OPTIONAL.
  - `PENDING` -> `REJECTED`: Allowed by Assigned Approver (or Admin override). Reason is REQUIRED.
  - `PENDING` -> `CANCELLED`: Allowed by Requester (or Admin override).
- Terminal behavior: `APPROVED`, `REJECTED`, and `CANCELLED` are terminal. No further edits or decisions allowed.

## 7. Authorization Model
- **Workspace Isolation:** All requests validate the `workspace_id` from the path against the user's active membership.
- **Create Approval:** Any ACTIVE workspace member.
- **Assigned Approver:** Any ACTIVE workspace member, but Self-Approval is FORBIDDEN (`requester_id != approver_user_id`).
- **Decide Approval:** Only the specific assigned `approver_user_id` (must be ACTIVE at decision time), or a workspace `ADMIN`.
- **Comments/Mentions:** Any active member with access to the task. Mentions are validated against active workspace membership.

## 8. Concurrency / Transaction Semantics
Approval decisions are business-critical. A race condition (e.g., two users cancelling/approving simultaneously, or double-clicks) must not corrupt history.
- **Mechanism:** PostgreSQL pessimistic row-level lock (`SELECT ... FOR UPDATE` on `approval_requests` and `approval_steps`).
- **Execution:** 
  1. Begin Transaction.
  2. Lock `approval_requests` and `approval_steps` rows.
  3. Verify `status === 'PENDING'` and validate permissions/active membership.
  4. Update `approval_steps` (decision, reason, decided_at, status).
  5. Update `approval_requests` (status, completed_at).
  6. Insert `outbox_events` (notification trigger).
  7. If `task_id` exists, insert `task_history` entry (Approval Decided).
  8. Commit Transaction.
- **Conflict:** Throws `409 CONFLICT` if no longer `PENDING`.

## 9. Database Design
**Migration required:** Yes (one versioned migration).
**Proposed Schema additions (in `packages/database/src/schema.ts`):**

- `approval_requests`: 
  `id` (PK), `workspace_id` (FK), `task_id` (FK nullable), `requester_id` (FK), `title`, `description`, `status` (PENDING, APPROVED, REJECTED, CANCELLED), `submitted_at`, `completed_at`, `created_at`, `updated_at`.
  *Indexes:* `(workspace_id, status)`, `(requester_id, status)`.
- `approval_steps`: 
  `id` (PK), `workspace_id` (FK), `approval_request_id` (FK), `step_order` (int), `approver_user_id` (FK), `status`, `decision`, `reason`, `decided_at`, `created_at`, `updated_at`.
  *Indexes:* `(approver_user_id, status)`.
- `comments`: 
  `id` (PK), `workspace_id` (FK), `task_id` (FK), `author_id` (FK), `content` (text), `created_at`, `updated_at`, `deleted_at`.
  *Indexes:* `(workspace_id, task_id, created_at)`.
- `mentions`: 
  `id` (PK), `workspace_id` (FK), `comment_id` (FK), `mentioned_user_id` (FK), `created_at`.
  *Indexes:* `(comment_id, mentioned_user_id)`.

## 10. API Design
**Approvals:**
- `GET /api/v1/workspaces/:wid/approvals`: List/inbox (filters: status, requester_id, approver_user_id, cursor).
- `POST /api/v1/workspaces/:wid/approvals`: Create request (requires `title`, `approver_user_id`, optional `task_id`, `description`).
- `GET /api/v1/workspaces/:wid/approvals/:id`: Detail view.
- `POST /api/v1/workspaces/:wid/approvals/:id/approve`: Approve (optional `reason`).
- `POST /api/v1/workspaces/:wid/approvals/:id/reject`: Reject (required `reason`).
- `POST /api/v1/workspaces/:wid/approvals/:id/cancel`: Cancel (optional `reason`).

**Comments & Mentions:**
- `GET /api/v1/workspaces/:wid/tasks/:tid/comments`: Chronological list.
- `POST /api/v1/workspaces/:wid/tasks/:tid/comments`: Create (requires `content`, optional `mentioned_user_ids: string[]`).
- `DELETE /api/v1/workspaces/:wid/tasks/:tid/comments/:cid`: Soft delete.

## 11. Notification / Outbox Design
Leverages the robust Phase 7 outbox/worker. Transactions creating/deciding approvals or creating comments insert into `outbox_events`:
- Event `approval.requested` -> notifies `approver_user_id`.
- Event `approval.decided` -> notifies `requester_id`.
- Event `approval.cancelled` -> notifies `approver_user_id`.
- Event `comment.mentioned` -> notifies each `mentioned_user_id`.
- Handlers in `apps/worker` translate these outbox payloads into `notifications` rows with appropriate deep-links.

## 12. Comments / Mentions Design
Comments are task-bound and displayed chronologically. Mentions are explicitly defined via `mentioned_user_ids` payload rather than complex regex parsing on the backend, ensuring precise user identification and preventing spoofing. The frontend is responsible for rendering mention badges based on the stored comment text and mention ID intersection.

## 13. Dashboard Integration
Phase 8 reporting queries will be updated to include `pending_approvals`:
- `getManagerDashboard`: Counts `PENDING` approval steps where `approver_user_id = userId`.
- `getMemberDashboard`: Counts `PENDING` approval requests where `requester_id = userId`.

## 14. Web UX / Routes
- **Route:** `/workspaces/:workspaceId/approvals` for Inbox (tabs for Pending, Completed, Sent).
- **Detail View:** Standard Floz modal/slide-over or dedicated route `/workspaces/:workspaceId/approvals/:id` showing context, task link, and decision history.
- **Task Detail:** A new "Comments" tab/section rendering the chronological timeline, composer, and explicit confirmation modals for destructive actions.

## 15. Error Contracts
- `400 BAD_REQUEST`: Validation errors, `SELF_APPROVAL_NOT_ALLOWED`.
- `403 FORBIDDEN`: Invalid workspace, unauthorized decision attempt, `INACTIVE_APPROVER`.
- `404 NOT_FOUND`: Resource missing.
- `409 CONFLICT`: `APPROVAL_ALREADY_DECIDED`, `APPROVAL_ALREADY_CANCELLED` (race condition handling).

## 16. Security Review
- **Cross-workspace access:** Thwarted by mandatory `workspace_id` verification on every read/write.
- **Unauthorized decision:** Prevented by `approver_user_id` and role check in the `FOR UPDATE` transaction.
- **Self-approval:** Explicitly forbidden during creation validation.
- **Double decisions:** Prevented by pessimistic locking and terminal state checks.
- **XSS:** Comments stored as plain text, frontend Next.js/React standard escaping used.
- **Mention Spoofing:** Mentions validated server-side to ensure target users are active members of the workspace.

## 17. Accessibility
- Approval decisions (Approve/Reject) require clear focus management and explicit confirmation dialogs.
- Comment composer and timeline must support keyboard navigation (skip links, tab order).
- Notification badges must have appropriate `aria-label`.

## 18. Testing Strategy
- **Database / API Integration:** Verify transaction integrity, locking (simulate concurrent `Approve` vs `Reject`), and role restrictions.
- **Outbox Integration:** Assert outbox rows are inserted atomically with business state.
- **Playwright E2E:** Real-stack tests covering create approval, mention selection, and approval inbox navigation.
- **Regression:** Ensure Phase 9 core workflows (Kanban, Calendar, Dashboard) remain unaffected.

## 19. Migration / Compatibility Strategy
Zero breaking changes to existing endpoints. New tables added without altering `tasks` schema (using FK back to `tasks`). Phase 8 Dashboard API maintains its contract shape, populating the previously unused `pending_approvals` field.

## 20. Alternatives Considered
- **Workflow-driven Approval:** Instead of a standalone `approvals` module, build approval triggers into Phase 11 `workflow_transitions`. *Rejected:* Too complex for MVP, and PRD specifies independent approval requests (e.g. general requests) unlinked to tasks.
- **Optimistic Versioning (Optimistic Concurrency) for Approvals:** *Rejected:* Pessimistic `FOR UPDATE` locking is safer for single-record, high-contention business-critical decisions like Approvals.

## 21. Decision Table

| Item | Decision | Rationale | Alternatives Rejected | Future Compatibility |
|---|---|---|---|---|
| Approval Scope | Independent workspace entity with optional Task context | Supports general operational requests + task approvals | Task-only approval | Easy extension to multi-task or workflow attachments |
| Approver Steps | Single step in MVP UI/logic using `approval_requests` + `approval_steps` schema | Fulfills core pilot requirements with minimal complexity | Multi-step sequential/parallel rules | Schema naturally supports multi-step in Phase 11+ |
| Eligible Approver | Any active workspace member (ADMIN, MANAGER, MEMBER); self-approval forbidden | Manager/Admin usually approve, but peer review or cross-functional approval is allowed | MANAGER-only approvers | Role-based policies can be added per workflow |
| Self Approval | Forbidden (`requester_id != approver_user_id`) | Prevents conflict of interest in approval audits | Allow self-approval | Optional admin override policy flag |
| Rejection Reason | Mandatory (non-empty text) | Clear context required for rejected work items | Optional rejection reason | Configurable min length |
| Cancellation | Allowed by Requester or Admin only while status is `PENDING` | Prevents orphaned pending requests | Approver cancellation | Cancel reason tracking |
| Task Status Sync | No automatic task status change | Decouples approval state machine from workflow transition rules | Auto-move task to Done on Approve | Workflow triggers in Phase 11 |
| Comments Edit/Delete | Create & soft-delete only; no edit in MVP | Minimizes UI complexity; audit trail integrity | Plain edit without history | Revision history in Phase 11+ |
| Mentions Scope | Structured `mentioned_user_ids` array | Simple, safe against XSS/parsing errors, deterministic | Unstructured text regex parser | Text parser with autocomplete UI |
| Notifications | In-app notification via transactional outbox | Reliable async delivery; reuses Phase 7 outbox engine | Sync fire-and-forget DB inserts | Email/push queue consumers |
| Dashboard | Enable live `pending_approvals` count on Manager/Member dashboards | Fulfills deferred Phase 8 dashboard specification | Dummy static numbers / zero | Custom KPI metrics |
| DB Migration | 1 versioned Drizzle migration required | Persistence needed for approval, comment, and mention tables | Schema-less JSON columns | Reversible migration scripts |

## 22. Risks / Open Questions
- **Risk:** Comment volumes. Without pagination/infinite scrolling on the web, massive comment threads could degrade performance. *Mitigation:* API will implement cursor pagination, though MVP web UI may load a fixed limit initially.
- **Risk:** Mention parsing UI. Building a robust `@` mention dropdown in React can be complex. *Mitigation:* Standardize on a simple select component or lightweight popover rather than custom rich-text parser.

## 23. Proposed Phase Boundaries
Phase 10 is strictly bound to the delivery of this document's scope. Implementation is planned in iterative slices:
1. Database Migration & Core DTOs.
2. Approval Engine & Concurrency Locks.
3. Comments & Mentions API.
4. Notifications & Outbox Worker Handlers.
5. Dashboard Integration.
6. Web UX Implementation & E2E Validation.

## 24. Acceptance Criteria
- Authorized members can create, cancel, approve, and reject approval requests.
- Concurrency locks reject invalid transitions (e.g. Approve after Reject).
- Comments and Mentions are persisted and retrievable.
- Notifications are successfully delivered for approval decisions and mentions.
- Dashboard projections accurately reflect `pending_approvals`.
- No new regressions in Phase 0-9 capabilities.
- Security and isolation invariant tests pass.
