# Phase 10: Approval & Collaboration Core Implementation Plan

**Status**: DRAFT IMPLEMENTATION PLAN / AWAITING APPROVAL  
**Design Reference**: `docs/superpowers/specs/2026-09-06-phase-10-approval-collaboration-core-design.md` (FINAL DESIGN / APPROVED FOR IMPLEMENTATION PLANNING)

---

## 1. Current Verified Repository State

- **Branch:** `master`
- **HEAD Commit:** `1930d8004eecf7087ea3c0bed3467300cc9f1017`
- **origin/main:** `f4f2076391a365f7693af71f111ced5fe10ca8fe`
- **Divergence (`origin/main...master`):** `0 5` (5 forward docs-only commits for approved Phase 10 design iterations)
- **Worktree:** Clean (`git status --short` empty)

---

## 2. Prerequisites & Assumptions

- **Master Codebase Authoritative:** Implementation builds directly on canonical post-Phase-9 `master`.
- **Zero Schema Alterations to `tasks`:** New persistence is isolated to 4 new tables: `approval_requests`, `approval_steps`, `comments`, `mentions`.
- **Strict Verification:** All new features require automated tests (unit/integration/E2E). No implementation moves to next step without explicit approval.
- **Git Discipline:** Forward commits only; no rebase, squash, or history modification.

---

## 3. Migration Strategy

- **1 Versioned Drizzle Migration:** Generate a clean Drizzle SQL migration (e.g. `0007_phase10_approval_collaboration.sql`) adding:
  - `approval_requests`
  - `approval_steps`
  - `comments`
  - `mentions`
  - Unique constraints: `UNIQUE(approval_request_id, step_order)`, `UNIQUE(comment_id, mentioned_user_id)`
  - Performance & sorting indexes: `(workspace_id, status, submitted_at DESC, id DESC)`, `(workspace_id, requester_id, status, submitted_at DESC, id DESC)`, `(workspace_id, approver_user_id, status, created_at DESC)`, `(workspace_id, task_id, created_at ASC, id ASC)`, `(workspace_id, mentioned_user_id, created_at DESC)`.
- **Verification:** Run `pwsh scripts/test-clean-db.ps1` to ensure disposable PostgreSQL cleanly applies migration and passes all assertions.

---

## 4. Concurrency & Locking Strategy

- **Decision Locking (`/steps/:stepId/approve`, `/steps/:stepId/reject`):**
  Pessimistic lock order: `approval_requests` FOR UPDATE (`id = :approvalRequestId AND workspace_id = :workspaceId`) -> `approval_steps` FOR UPDATE (`id = :stepId AND approval_request_id = :approvalRequestId AND workspace_id = :workspaceId AND step_order = 1`).
- **Cancellation Locking (`/cancel`):**
  Pessimistic lock order: `approval_requests` FOR UPDATE (`id = :approvalRequestId AND workspace_id = :workspaceId`) -> `approval_steps` FOR UPDATE (`approval_request_id = :approvalRequestId AND workspace_id = :workspaceId AND step_order = 1`).
- **Conflict Handling:** Terminal state check under lock. Stale/losing race requests immediately fail with `409 APPROVAL_NOT_PENDING` (`{ current_status: request.status }`).
- **Concurrent Test Harness:** Schedule real parallel Promise races (`Promise.all`) testing:
  1. Approve vs Reject
  2. Approve vs Cancel
  3. Reject vs Cancel
  4. Cancel vs Cancel

---

## 5. Worker, Outbox & Deep-Link Strategy

- **Outbox Events:**
  - `approval.requested` -> In-app `APPROVAL_REQUESTED`
  - `approval.decided` -> In-app `APPROVAL_APPROVED` or `APPROVAL_REJECTED`
  - `approval.cancelled` -> In-app `APPROVAL_CANCELLED`
  - `comment.mentioned` -> In-app `COMMENT_MENTIONED`
- **Worker Handlers (`apps/worker/src/outbox-dispatcher.ts`):** Map events to `notifications` table inserts via existing outbox dispatcher runtime. Deduplication enforced via `notification_dedup_ledger`.
- **Deep Links:**
  - Approvals: `/workspaces/${wid}/approvals?selected_approval_request_id=${reqId}` (preserving `view=inbox|sent`)
  - Task Mentions: `/workspaces/${wid}/tasks?selected_task_id=${taskId}`

---

## 6. Dashboard & Reporting Strategy

- **Manager Dashboard (`getManagerDashboard`):**
  - Uses set semantics (`COUNT(DISTINCT approval_steps.id)`) on `PENDING` approval steps assigned to members inside the manager's authorized team scope or assigned directly to the manager.
  - Workspace `ADMIN` counts all workspace `PENDING` approval steps.
  - Drilldown URLs:
    - MANAGER: `/workspaces/:workspaceId/approvals?view=managed&status=PENDING` (appends `&team_id=:teamId` if filtered)
    - ADMIN: `/workspaces/:workspaceId/approvals?view=all&status=PENDING` (appends `&team_id=:teamId` if filtered)
- **Member Dashboard:** Unchanged (preserves Phase 8 contract).

---

## 7. Explicit Non-Goals

- Phase 11 Workflow Configuration UI / custom rules.
- Automatic task status changes based on approval decisions.
- Multi-step approval execution (application logic enforces 1 step).
- Reassignment endpoint, parallel/quorum approvers.
- Attachments, rich-text editing, comment editing, comment reactions.
- Email/push notification delivery and notification preferences UI.

---

## 8. Detailed Task Breakdown & Checkpoints

### Task 1: Database Schema, Migration & Constraints
- **Goal:** Define Drizzle ORM schema for `approval_requests`, `approval_steps`, `comments`, `mentions`, generate migration `0007_phase10_approval_collaboration.sql`, and add database tests.
- **Expected Files:**
  - `database/src/schema.ts`
  - `database/drizzle/0007_phase10_approval_collaboration.sql`
  - `database/test/approval-schema.integration.test.ts`
- **RED Tests:** Assert table existence, unique constraints (`UNIQUE(approval_request_id, step_order)`, `UNIQUE(comment_id, mentioned_user_id)`), index behavior, and duplicate rejection.
- **Verification Command:** `pnpm --filter @floz/database test`

---

### Task 2: Approval Creation, List & Detail API + Read Authorization
- **Goal:** Implement REST endpoints for `POST /approval-requests`, `GET /approval-requests` (with `view=inbox|sent|managed|all` and `submitted_at DESC, id DESC` cursor pagination), and `GET /approval-requests/:approvalRequestId` with strict read authorization and error contracts (`422 INACTIVE_APPROVER`, `422 INVALID_APPROVER_TARGET`, `422 SELF_APPROVAL_NOT_ALLOWED`, `422 CROSS_WORKSPACE_REFERENCE`, `403 FORBIDDEN`).
- **Expected Files:**
  - `apps/api/src/approval.service.ts`
  - `apps/api/src/approval.dto.ts`
  - `apps/api/src/floz.controller.ts`
  - `apps/api/src/error.filter.ts`
  - `apps/api/test/approval-api.test.ts`
- **RED Tests:** Test creation validations, target approver checks, task-linked access, `submitted_at DESC, id DESC` pagination stability, and read authorization for requester, approver, manager, and admin.
- **Verification Command:** `pnpm --filter @floz/api test`

---

### Task 3: Approval Terminal Mutation Engine & Real Concurrency Tests
- **Goal:** Implement decision endpoints (`POST .../steps/:stepId/approve`, `POST .../steps/:stepId/reject`) and cancellation endpoint (`POST .../cancel`) using pessimistic row-level locking (`approval_requests` -> `approval_steps`) and exact `:stepId` resource binding.
- **Expected Files:**
  - `apps/api/src/approval.service.ts`
  - `apps/api/src/floz.controller.ts`
  - `apps/api/test/approval-concurrency.integration.test.ts`
- **RED Tests:**
  - Resource binding: mismatched `:stepId` and `:approvalRequestId` returns `404 NOT_FOUND`.
  - Self-approval prohibition on decision (`422 SELF_APPROVAL_NOT_ALLOWED`).
  - Stale approver + ADMIN override recovery test.
  - Reason normalization tests (approve: optional max 500, reject: mandatory 3-500, cancel: optional max 500).
  - Parallel concurrency tests (`Promise.all`): Approve vs Reject, Approve vs Cancel, Reject vs Cancel, Cancel vs Cancel -> exactly 1 succeeds, racing losers receive `409 APPROVAL_NOT_PENDING`.
- **Verification Command:** `pnpm --filter @floz/api test`

---

### CHECKPOINT A — STOP
- **Action:** Present backend Approval Core API & real concurrency test results. Await explicit approval before continuing.

---

### Task 4: Task Comments & Mentions API
- **Goal:** Implement REST endpoints `GET /tasks/:taskId/comments`, `POST /tasks/:taskId/comments` (with content normalization, mention deduplication, and `422 INVALID_MENTION_TARGET` validation), and `DELETE /tasks/:taskId/comments/:commentId` (author/ADMIN soft-delete with idempotent `204`).
- **Expected Files:**
  - `apps/api/src/comment.service.ts`
  - `apps/api/src/comment.dto.ts`
  - `apps/api/src/floz.controller.ts`
  - `apps/api/test/comment-api.test.ts`
- **RED Tests:** Comment content trimming, empty rejection (`400 VALIDATION_ERROR`), mention deduplication, target task-view authorization (`422 INVALID_MENTION_TARGET`), keyset pagination (`created_at ASC, id ASC`), and repeated DELETE calls returning `204`.
- **Verification Command:** `pnpm --filter @floz/api test`

---

### Task 5: Approval & Mention Outbox Events + Worker Handlers
- **Goal:** Wire `outbox_events` generation in approval/comment transactions and add worker event handlers in `apps/worker` for `APPROVAL_REQUESTED`, `APPROVAL_APPROVED`, `APPROVAL_REJECTED`, `APPROVAL_CANCELLED`, and `COMMENT_MENTIONED` with notification deduplication and exact deep links.
- **Expected Files:**
  - `apps/api/src/approval.service.ts`
  - `apps/api/src/comment.service.ts`
  - `apps/worker/src/outbox-dispatcher.ts`
  - `apps/worker/test/approval-notifications.integration.test.ts`
- **RED Tests:** Assert outbox event insertion, worker batch dispatch, notification ledger deduplication, and exact deep-link destinations (`selected_approval_request_id` and `selected_task_id`).
- **Verification Command:** `pnpm --filter @floz/worker test:integration`

---

### CHECKPOINT B — STOP
- **Action:** Present Comments/Mentions API and Outbox Worker integration test results. Await explicit approval before continuing.

---

### Task 6: Manager Dashboard `pending_approvals` & Drilldown Integration
- **Goal:** Update `getManagerDashboard` in `database/src/dashboard.ts` and `apps/api/src/floz.controller.ts` to compute set-based `pending_approvals` count (`COUNT(DISTINCT approval_steps.id)`). Add role-aligned drilldown URLs (`view=managed` for MANAGER, `view=all` for ADMIN).
- **Expected Files:**
  - `database/src/dashboard.ts`
  - `apps/api/src/floz.controller.ts`
  - `database/test/dashboard-approvals.integration.test.ts`
- **RED Tests:** Test manager dashboard metrics, multi-team member deduplication, ADMIN workspace-wide scope, and team filtering.
- **Verification Command:** `pnpm --filter @floz/database test`

---

### Task 7: Web API Client & Approvals Navigation, List & Filter Views
- **Goal:** Update `apps/web/lib/api-client.ts` with Phase 10 DTO types and endpoints. Add `/workspaces/:workspaceId/approvals` page with view tabs (`Inbox`, `Sent`, `Managed`, `All`), status filters, and `submitted_at DESC, id DESC` cursor pagination. Update `apps/web/components/shell.tsx` navigation sidebar.
- **Expected Files:**
  - `apps/web/lib/api-client.ts`
  - `apps/web/app/workspaces/[workspaceId]/approvals/page.tsx`
  - `apps/web/components/shell.tsx`
  - `apps/web/test/approvals-list.test.tsx`
- **RED Tests:** Test API client calls, tab view switching, status filter preservation, and sidebar navigation link rendering.
- **Verification Command:** `pnpm --filter web test`

---

### Task 8: Approval Selected-Item Detail & Create/Decision/Cancel UX
- **Goal:** Implement Approval Detail panel/dialog driven by `selected_approval_request_id` query parameter on `/workspaces/:workspaceId/approvals`. Add Create Approval Request modal and decision dialogs (Approve with optional reason, Reject with mandatory 3-500 reason, Cancel with optional reason).
- **Expected Files:**
  - `apps/web/app/workspaces/[workspaceId]/approvals/page.tsx`
  - `apps/web/components/approval-detail-panel.tsx`
  - `apps/web/components/create-approval-modal.tsx`
  - `apps/web/test/approval-ux.test.tsx`
- **RED Tests:** Test selected-item URL opening/closing, decision dialog validations, self-approval error handling, and complete audit trail rendering.
- **Verification Command:** `pnpm --filter web test`

---

### CHECKPOINT C — STOP
- **Action:** Present Web Approvals Inbox, Detail Panel, and Creation/Decision UX test results. Await explicit approval before continuing.

---

### Task 9: Task Comments & Structured Mention UX
- **Goal:** Implement Comments section in Task Detail modal/page with chronological feed, plain-text body rendering, structured mention chips, member selection dropdown, and author/ADMIN soft-delete action.
- **Expected Files:**
  - `apps/web/components/task-comments.tsx`
  - `apps/web/app/workspaces/[workspaceId]/tasks/page.tsx`
  - `apps/web/test/task-comments.test.tsx`
- **RED Tests:** Test comment timeline rendering, mention member selection, trim normalization, and soft-delete UI removal.
- **Verification Command:** `pnpm --filter web test`

---

### Task 10: Notification Deep-Link Integration & Accessibility Hardening
- **Goal:** Update `NotificationCenter` and `notificationRoute` in `apps/web` to handle `selected_approval_request_id` and `selected_task_id` deep links cleanly. Harden accessibility (focus trap, Escape-to-close, high contrast badges, aria-live).
- **Expected Files:**
  - `apps/web/lib/task-route.ts`
  - `apps/web/components/notification-center.tsx`
  - `apps/web/components/approval-detail-panel.tsx`
  - `apps/web/test/notification-links.test.tsx`
- **RED Tests:** Test deep-link navigation for approval and task mention notifications, and keyboard navigation/focus management.
- **Verification Command:** `pnpm --filter web test`

---

### CHECKPOINT D — STOP
- **Action:** Present Task Comments/Mentions UX and Notification Deep-Link test results. Await explicit approval before continuing.

---

### Task 11: Real-Stack Phase 10 E2E & Phase 0–9 Regression
- **Goal:** Add comprehensive Playwright E2E scenarios covering Phase 10 end-to-end user journeys (Create approval -> Deep link navigation -> Approver decision -> Notification -> Manager dashboard drilldown -> Task comment & mention). Ensure zero regressions across Phase 0–9 workflows.
- **Expected Files:**
  - `apps/web/e2e/flow.spec.ts` (or `apps/web/e2e/approval-flow.spec.ts`)
- **RED Tests:** 4 new Playwright E2E scenarios covering approval creation, decision, manager drilldown, and task mention.
- **Verification Command:** `pwsh scripts/test-e2e.ps1`

---

### CHECKPOINT E — STOP
- **Action:** Present real-stack Playwright E2E test results. Await explicit approval before continuing.

---

### Task 12: Documentation Synchronization & Final Verification Report
- **Goal:** Create `docs/implementation/PHASE_10_REPORT.md` and update `docs/implementation/IMPLEMENTATION_STATUS.md`, `CURRENT_HANDOFF.md`, and `OPEN_DECISIONS.md`. Execute full canonical Phase 10 gate sequence.
- **Expected Files:**
  - `docs/implementation/PHASE_10_REPORT.md`
  - `docs/implementation/IMPLEMENTATION_STATUS.md`
  - `docs/implementation/CURRENT_HANDOFF.md`
  - `docs/decisions/OPEN_DECISIONS.md`
- **Verification Gate Sequence:**
  1. `pwsh scripts/test-clean-db.ps1`
  2. `pwsh scripts/test-e2e.ps1`
  3. `pnpm --filter @floz/worker test:integration`
  4. `pnpm lint`
  5. `pnpm typecheck`
  6. `pnpm test` (Run #1)
  7. `pnpm build`
  8. `pnpm test` (Run #2)

---

### CHECKPOINT F — STOP FOR FINAL ACCEPTANCE
- **Action:** Present final verification report and wait for human acceptance.

---

## 9. Rollback & Recovery Guidance

- **Database Rollback:** If a migration issue occurs in dev, drop the disposable container via `pwsh scripts/test-clean-db.ps1`.
- **Git Safety:** Maintain strict forward commits per task. Never use `git reset --hard` or force push.

---

## 10. Summary of Checkpoints & Verification Gates

| Checkpoint | Scope Covered | Key Verification |
|---|---|---|
| **Checkpoint A** | Schema migration, Approval CRUD API, locking & real concurrency tests | `pnpm --filter @floz/database test` & `pnpm --filter @floz/api test` |
| **Checkpoint B** | Comments & Mentions API, Outbox & Worker Notification handlers | `pnpm --filter @floz/api test` & `pnpm --filter @floz/worker test:integration` |
| **Checkpoint C** | Manager Dashboard `pending_approvals` metric & Web Approvals Inbox/Detail UX | `pnpm --filter @floz/database test` & `pnpm --filter web test` |
| **Checkpoint D** | Web Task Comments/Mentions UX, Notification deep links, Accessibility | `pnpm --filter web test` |
| **Checkpoint E** | Playwright Real-Stack E2E & Phase 0-9 Regression | `pwsh scripts/test-e2e.ps1` |
| **Checkpoint F** | Final Documentation, Gate Sequence Execution & Publication Report | Full 8-step verification gate sequence |
