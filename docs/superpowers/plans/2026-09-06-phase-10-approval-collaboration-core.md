# Phase 10: Approval & Collaboration Core Implementation Plan

**Status**: DRAFT IMPLEMENTATION PLAN / AWAITING APPROVAL  
**Design Reference**: `docs/superpowers/specs/2026-09-06-phase-10-approval-collaboration-core-design.md` (FINAL DESIGN / APPROVED FOR IMPLEMENTATION PLANNING)

---

## 1. Current Verified Repository State

- **Branch:** `master`
- **Canonical master HEAD:** `1930d8004eecf7087ea3c0bed3467300cc9f1017`
- **origin/main HEAD:** `f4f2076391a365f7693af71f111ced5fe10ca8fe`
- **Ahead / Behind (`origin/main...master`):** `0 6` (forward docs-only commits for approved Phase 10 design iterations)
- **Worktree:** Clean (`git status --short` empty)

---

## 2. Pre-Implementation Git & Worktree Procedure

Planning occurs on `master`. Implementation Tasks 1–12 MUST occur in an isolated worktree branch.

After this implementation plan receives FINAL human approval:
1. Verify worktree is clean: `git status --short` returns empty.
2. Run security & secret audit over outgoing documentation commits.
3. Fetch origin: `git fetch origin`.
4. Verify `origin/main` is an ancestor of `master`: `git merge-base --is-ancestor origin/main master`.
5. Publish approved Phase 10 design and plan to `origin/main` via fast-forward only: `git push origin master:main`.
6. Verify divergence is `0 0`: `git rev-list --left-right --count origin/main...master`.
7. Create isolated implementation worktree and branch:
   - Branch name: `phase10-approval-collaboration-core`
   - Worktree path: `D:\Portofolio\Floz\app\.worktrees\phase10-approval-collaboration-core`
   - Command: `git worktree add -b phase10-approval-collaboration-core .worktrees/phase10-approval-collaboration-core master`
8. Tasks 1–12 are executed inside `.worktrees/phase10-approval-collaboration-core`.
9. **Divergence Protection:** If `origin/main` diverges unexpectedly, STOP and report immediately. Never auto-rebase or force push.

---

## 3. Migration Strategy

- **1 Versioned Drizzle Migration:** Generate a clean Drizzle SQL migration (`database/drizzle/0007_phase10_approval_collaboration.sql`) adding:
  - `approval_requests`: `id`, `workspace_id`, `task_id`, `requester_id`, `cancelled_by_user_id`, `title`, `description`, `cancel_reason`, `status`, `submitted_at`, `completed_at`, `created_at`, `updated_at`.
  - `approval_steps`: `id`, `workspace_id`, `approval_request_id`, `step_order`, `approver_user_id`, `decided_by_user_id`, `status`, `decision`, `reason`, `decided_at`, `created_at`, `updated_at`.
  - `comments`: `id`, `workspace_id`, `task_id`, `author_id`, `content`, `created_at`, `updated_at`, `deleted_at`.
  - `mentions`: `id`, `workspace_id`, `comment_id`, `mentioned_user_id`, `created_at`.
  - Unique Constraints: `UNIQUE(approval_request_id, step_order)` on `approval_steps`, `UNIQUE(comment_id, mentioned_user_id)` on `mentions`.
  - Indexes:
    - `approval_requests(workspace_id, status, submitted_at DESC, id DESC)`
    - `approval_requests(workspace_id, requester_id, status, submitted_at DESC, id DESC)`
    - `approval_requests(workspace_id, task_id)`
    - `approval_steps(workspace_id, approver_user_id, status, created_at DESC)`
    - `comments(workspace_id, task_id, created_at ASC, id ASC)`
    - `mentions(workspace_id, mentioned_user_id, created_at DESC)`
- **Zero Alterations to `tasks` Table:** All existing task columns and invariants remain untouched.
- **Verification:** Run `pwsh scripts/test-clean-db.ps1` to ensure disposable PostgreSQL cleanly applies migration and passes all constraints.

---

## 4. Concurrency & Side-Effect Strategy

- **Universal Terminal Mutation Lock Order:**
  `approval_requests` FOR UPDATE (`id = :approvalRequestId AND workspace_id = :workspaceId`) -> `approval_steps` FOR UPDATE (`approval_request_id = :approvalRequestId AND workspace_id = :workspaceId AND step_order = 1`).
  - Decision endpoints (`/steps/:stepId/approve`, `/steps/:stepId/reject`) bind exact `:stepId` matching `:approvalRequestId` and `workspace_id`.
  - Cancellation endpoint (`/cancel`) locks the single step `step_order = 1` for `:approvalRequestId`.
- **Atomic Side Effects:**
  - Creation: atomic `approval_request` + `approval_step` + `approval.requested` outbox + `APPROVAL_REQUESTED` task_history (when task-linked).
  - Decision/Cancellation: atomic request mutation + step mutation + `approval.decided` or `approval.cancelled` outbox + `APPROVAL_COMPLETED` task_history (when task-linked).
  - Comments: atomic `comment` + deduplicated `mentions` + one `comment.mentioned` outbox per unique eligible recipient (except author).
- **Concurrency Test Suite (Task 3):**
  Real parallel `Promise.all` tests against PostgreSQL testing:
  1. Approve vs Reject
  2. Approve vs Cancel
  3. Reject vs Cancel
  4. Cancel vs Cancel
  - Required Assertions: Exactly 1 terminal state succeeds; racing losers receive `409 APPROVAL_NOT_PENDING`; `approval_request` and `approval_step` match terminal state; exactly one outbox event is created; exactly one `APPROVAL_COMPLETED` task_history row is appended; zero contradictory history/outbox/actor metadata.

---

## 5. Worker, Outbox & Deep-Link Strategy

- **Outbox Consumer (Task 5):**
  Worker consumes already-created Phase 10 outbox events without retrofitting backend transactional writes:
  - `approval.requested` -> In-app `APPROVAL_REQUESTED` to assigned approver
  - `approval.decided` (APPROVED) -> In-app `APPROVAL_APPROVED` to requester
  - `approval.decided` (REJECTED) -> In-app `APPROVAL_REJECTED` to requester
  - `approval.cancelled` -> In-app `APPROVAL_CANCELLED` to assigned approver
  - `comment.mentioned` -> In-app `COMMENT_MENTIONED` to mentioned user
- **Deduplication:** Enforced via `notification_dedup_ledger` using canonical dedup keys.
- **Deep Links:**
  - Approvals: `/workspaces/${wid}/approvals?selected_approval_request_id=${reqId}` (preserving `view=inbox|sent`)
  - Task Mentions: `/workspaces/${wid}/tasks?selected_task_id=${taskId}`

---

## 6. Dashboard & Reporting Strategy

- **Manager Dashboard (`getManagerDashboard`):**
  - Evaluated using set semantics: `COUNT(DISTINCT approval_steps.id)` on `PENDING` approval steps assigned to members inside the manager's authorized team scope or assigned directly to the manager.
  - Workspace `ADMIN` counts all workspace `PENDING` approval steps.
  - Multi-team membership deduplication: a member belonging to two teams managed by the same manager is counted exactly once.
  - Role-aligned drilldowns:
    - MANAGER: `/workspaces/:workspaceId/approvals?view=managed&status=PENDING` (appends `&team_id=:teamId` if filtered)
    - ADMIN: `/workspaces/:workspaceId/approvals?view=all&status=PENDING` (appends `&team_id=:teamId` if filtered)
- **Member Dashboard:** Preserved unchanged.

---

## 7. Explicit Non-Goals

- Phase 11 Workflow Configuration UI / custom rules.
- Automatic task status changes based on approval decisions.
- Multi-step approval execution (application logic enforces 1 step).
- Reassignment endpoint, parallel/quorum approvers.
- Attachments, rich-text editing, comment editing, comment reactions.
- Email/push notification delivery and notification preferences UI.
- Generic `Idempotency-Key` table persistence (deferred; race safety provided via `FOR UPDATE`).

---

## 8. Detailed Task Breakdown & Checkpoints

### Task 1: Database Schema, Migration & Constraints
- **Scope:** Define Drizzle ORM schema for `approval_requests`, `approval_steps`, `comments`, and `mentions`. Generate migration `database/drizzle/0007_phase10_approval_collaboration.sql`.
- **Expected Files:**
  - `database/src/schema.ts`
  - `database/drizzle/0007_phase10_approval_collaboration.sql`
  - `database/drizzle/meta/_journal.json`
  - `database/test/approval-schema.integration.test.ts`
- **Execution & Review Discipline:**
  1. **RED:** Write integration tests in `approval-schema.integration.test.ts` asserting table creation, foreign keys, unique constraints (`UNIQUE(approval_request_id, step_order)`, `UNIQUE(comment_id, mentioned_user_id)`), indexes, and duplicate rejection.
  2. **Minimal Implementation:** Add schema definitions in `database/src/schema.ts` and generate migration `0007_phase10_approval_collaboration.sql`.
  3. **Focused GREEN:** Run `pnpm --filter @floz/database test`.
  4. **Requirements & Code-Quality Review:** Verify schema matches §9 of final design.
  5. **Security/Integrity Review:** Verify foreign keys and nullability constraints.
  6. **Fix & Re-review Clean:** Resolve findings.
  7. **Focused Forward Commit:** `feat(database): add Phase 10 approval and collaboration schema and migration (Task 1)`

---

### Task 2: Approval Creation, List & Detail API + Read Authorization
- **Scope:** Implement REST endpoints:
  - `POST /api/v1/workspaces/:workspaceId/approval-requests` (atomic transaction: request + step 1 + `approval.requested` outbox + `APPROVAL_REQUESTED` task_history when task-linked).
  - `GET /api/v1/workspaces/:workspaceId/approval-requests` (`view=inbox|sent|managed|all`, status filter, stable `submitted_at DESC, id DESC` cursor pagination, set semantics for `managed`).
  - `GET /api/v1/workspaces/:workspaceId/approval-requests/:approvalRequestId` (strict read authorization: requester, approver, workspace ADMIN, authorized MANAGER).
- **Expected Files:**
  - `apps/api/src/approval.service.ts`
  - `apps/api/src/approval.dto.ts`
  - `apps/api/src/floz.controller.ts`
  - `apps/api/src/error.filter.ts`
  - `apps/api/test/approval-api.test.ts`
- **Execution & Review Discipline:**
  1. **RED:** Write tests in `approval-api.test.ts` covering:
     - Atomic creation of request, step, outbox event, and task history; assert complete rollback on failure.
     - Error mapping: `422 INACTIVE_APPROVER` (inactive target), `422 INVALID_APPROVER_TARGET` (target lacks Task access), `422 SELF_APPROVAL_NOT_ALLOWED` (requester == approver), `422 CROSS_WORKSPACE_REFERENCE` (foreign workspace ID).
     - Role view authorization: MANAGER cannot use `all`, non-MANAGER cannot use `managed`, unauthorized `team_id` -> `403 FORBIDDEN`.
     - Member in two managed teams appears once (`view=managed`).
     - Stable pagination: `submitted_at DESC, id DESC` with equal-timestamp stability.
     - Detail read authorization: requester, approver, manager, admin pass; unrelated member -> `403 FORBIDDEN`.
  2. **Minimal Implementation:** Implement `approval.service.ts`, DTO validation, controller routes, and error filter mappings.
  3. **Focused GREEN:** Run `pnpm --filter @floz/api test`.
  4. **Requirements & Code-Quality Review:** Verify atomic rollback and error contracts.
  5. **Security/Authorization Review:** Verify cross-workspace isolation and Task-linked access rules.
  6. **Fix & Re-review Clean:** Resolve findings.
  7. **Focused Forward Commit:** `feat(api): add approval request creation, list, and detail endpoints with read authorization (Task 2)`

---

### Task 3: Approval Terminal Mutation Engine & Real Concurrency Tests
- **Scope:** Implement decision endpoints (`POST .../steps/:stepId/approve`, `POST .../steps/:stepId/reject`) and cancellation endpoint (`POST .../cancel`).
  - Pessimistic lock order: `approval_requests` FOR UPDATE -> `approval_steps` FOR UPDATE.
  - Exact `:stepId` resource binding on decision endpoints.
  - Reason normalization: Approve (optional, trim, max 500), Reject (mandatory, trim, 3–500), Cancel (optional, trim, max 500).
  - Atomic terminal mutation: updates request + step (`CANCELLED` sets decision fields null) + `approval.decided` or `approval.cancelled` outbox + `APPROVAL_COMPLETED` task_history (when task-linked).
- **Expected Files:**
  - `apps/api/src/approval.service.ts`
  - `apps/api/src/floz.controller.ts`
  - `apps/api/test/approval-concurrency.integration.test.ts`
- **Execution & Review Discipline:**
  1. **RED:** Write tests in `approval-concurrency.integration.test.ts` covering:
     - Exact resource binding: mismatched `:stepId` and `:approvalRequestId` returns `404 NOT_FOUND`.
     - Self-approval prohibition on decision: `422 SELF_APPROVAL_NOT_ALLOWED`.
     - Stale approver: suspended approver gets `403 FORBIDDEN`; active ADMIN override succeeds while `PENDING`.
     - Real parallel concurrency (`Promise.all`): Approve vs Reject, Approve vs Cancel, Reject vs Cancel, Cancel vs Cancel.
     - Assertions: exactly 1 succeeds; losers get `409 APPROVAL_NOT_PENDING`; request and step terminal states match; exactly 1 outbox event; exactly 1 task_history row; zero contradictory metadata.
  2. **Minimal Implementation:** Implement transactional locking, reason normalization, and decision/cancel handlers.
  3. **Focused GREEN:** Run `pnpm --filter @floz/api test`.
  4. **Requirements & Code-Quality Review:** Verify lock ordering and atomic history/outbox.
  5. **Security/Concurrency Review:** Verify zero race leaks or contradictory audit states.
  6. **Fix & Re-review Clean:** Resolve findings.
  7. **Focused Forward Commit:** `feat(api): implement approval decision and cancellation engine with concurrency locking (Task 3)`

---

### 🛑 CHECKPOINT A — STOP
- **Prerequisites:** Tasks 1–3 completed and committed.
- **Evidence Required:** Commit hashes; files changed; exact test commands; test counts (executed/passed/failed/skipped); real concurrency race outcomes and side-effect counts; `pnpm lint`; `pnpm typecheck`; `git diff --check`; `git status --short`; blockers/deviations.
- **Handoff:** STOP and wait for explicit human approval before Task 4.

---

### Task 4: Task Comments & Mentions API
- **Scope:** Implement REST endpoints:
  - `GET /api/v1/workspaces/:workspaceId/tasks/:taskId/comments` (Task access check, chronological `created_at ASC, id ASC` keyset pagination, returns structured mention chips `mentions: [{ user_id, full_name }]`).
  - `POST /api/v1/workspaces/:workspaceId/tasks/:taskId/comments` (atomic transaction: validates Task access, trims content, rejects empty, enforces max 2000 chars, deduplicates `mentioned_user_ids`, validates all targets have active membership and Task access (`422 INVALID_MENTION_TARGET`), inserts comment, inserts mentions, inserts `comment.mentioned` outbox per unique recipient except author).
  - `DELETE /api/v1/workspaces/:workspaceId/tasks/:taskId/comments/:commentId` (author or workspace ADMIN only; soft-deletes row `deleted_at = NOW()`; repeated authorized DELETE returns `204 No Content` idempotently; no notifications retracted).
- **Expected Files:**
  - `apps/api/src/comment.service.ts`
  - `apps/api/src/comment.dto.ts`
  - `apps/api/src/floz.controller.ts`
  - `apps/api/test/comment-api.test.ts`
- **Execution & Review Discipline:**
  1. **RED:** Write tests in `comment-api.test.ts` covering:
     - Content normalization (trim, empty rejection `400 VALIDATION_ERROR`, max 2000 chars).
     - Mention deduplication (duplicate IDs in body produce single mention row and single outbox event).
     - Mention authorization: ineligible/unauthorized target returns `422 INVALID_MENTION_TARGET`; author self-mention produces no notification.
     - Keyset pagination stability (`created_at ASC, id ASC`).
     - Soft delete: author/ADMIN passes; unauthorized member gets `403 FORBIDDEN`; repeated delete returns `204`; deleted comments hidden from GET.
  2. **Minimal Implementation:** Implement `comment.service.ts`, DTO validation, controller routes, and soft delete logic.
  3. **Focused GREEN:** Run `pnpm --filter @floz/api test`.
  4. **Requirements & Code-Quality Review:** Verify atomic comment/mention insertion and deduplication.
  5. **Security/XSS Review:** Verify plain-text storage and target access validation.
  6. **Fix & Re-review Clean:** Resolve findings.
  7. **Focused Forward Commit:** `feat(api): add task comments and structured mentions endpoints with soft-delete (Task 4)`

---

### Task 5: Approval & Mention Outbox Worker Notification Handlers
- **Scope:** Implement worker event handlers in `apps/worker` to consume already-created Phase 10 outbox events:
  - `approval.requested` -> `APPROVAL_REQUESTED`
  - `approval.decided` (APPROVED) -> `APPROVAL_APPROVED`
  - `approval.decided` (REJECTED) -> `APPROVAL_REJECTED`
  - `approval.cancelled` -> `APPROVAL_CANCELLED`
  - `comment.mentioned` -> `COMMENT_MENTIONED`
  - Ledger deduplication via `notification_dedup_ledger`.
  - Canonical deep links: `/workspaces/${wid}/approvals?selected_approval_request_id=${reqId}` and `/workspaces/${wid}/tasks?selected_task_id=${taskId}`.
  - ADMIN override actor metadata preserved in notification payload.
- **Expected Files:**
  - `apps/worker/src/outbox-dispatcher.ts`
  - `apps/worker/test/approval-notifications.integration.test.ts`
- **Execution & Review Discipline:**
  1. **RED:** Write integration tests in `approval-notifications.integration.test.ts` covering:
     - Worker dispatch of each event type to `notifications`.
     - Exact recipient mapping and dedup key construction.
     - Idempotent replay: re-processing an outbox event produces zero duplicate notification rows.
     - Deep-link destinations matching canonical routes.
     - Actor metadata included for ADMIN override.
  2. **Minimal Implementation:** Add event dispatch branches in `apps/worker/src/outbox-dispatcher.ts`.
  3. **Focused GREEN:** Run `pnpm --filter @floz/worker test:integration`.
  4. **Requirements & Code-Quality Review:** Verify existing Phase 7 worker infrastructure conventions preserved.
  5. **Security/Isolation Review:** Verify workspace and recipient isolation in notifications.
  6. **Fix & Re-review Clean:** Resolve findings.
  7. **Focused Forward Commit:** `feat(worker): add approval and mention notification worker handlers with deduplication (Task 5)`

---

### 🛑 CHECKPOINT B — STOP
- **Prerequisites:** Tasks 4–5 completed and committed.
- **Evidence Required:** Commit hashes; files changed; exact test commands; test counts; exact outbox/worker/notification dedup evidence; `pnpm lint`; `pnpm typecheck`; `git diff --check`; `git status --short`; blockers/deviations.
- **Handoff:** STOP and wait for explicit human approval before Task 6.

---

### Task 6: Manager Dashboard `pending_approvals` & Drilldown Integration
- **Scope:** Update `getManagerDashboard` in `database/src/dashboard.ts` to compute set-based `pending_approvals` count (`COUNT(DISTINCT approval_steps.id)`).
  - Scope: pending steps assigned to members of the manager's authorized teams or directly to the manager.
  - ADMIN scope: all workspace pending steps.
  - Set semantics: member belonging to two managed teams counted once.
  - API/Web response contract: exposes role-aligned drilldown paths:
    - MANAGER: `/workspaces/:workspaceId/approvals?view=managed&status=PENDING` (appends `&team_id=:teamId` when team filtered)
    - ADMIN: `/workspaces/:workspaceId/approvals?view=all&status=PENDING` (appends `&team_id=:teamId` when team filtered)
  - Member Dashboard remains unchanged.
- **Expected Files:**
  - `database/src/dashboard.ts`
  - `apps/api/src/floz.controller.ts`
  - `database/test/dashboard-approvals.integration.test.ts`
  - `apps/api/test/dashboard-approvals-api.test.ts`
- **Execution & Review Discipline:**
  1. **RED:** Write tests covering:
     - Database integration: `COUNT(DISTINCT)` set semantics, multi-team member deduplication, team filtering, ADMIN workspace scope.
     - API integration: manager and admin dashboard response shapes, role-aligned drilldown URL contracts, and team ID preservation.
  2. **Minimal Implementation:** Update `dashboard.ts` query and `floz.controller.ts`.
  3. **Focused GREEN:** Run `pnpm --filter @floz/database test` and `pnpm --filter @floz/api test`.
  4. **Requirements & Code-Quality Review:** Verify set semantics and drilldown URL alignment.
  5. **Security/Scope Review:** Verify Phase 8 manager scope constraints preserved.
  6. **Fix & Re-review Clean:** Resolve findings.
  7. **Focused Forward Commit:** `feat(dashboard): integrate pending approvals metric and role-aligned drilldowns for manager dashboard (Task 6)`

---

### Task 7: Web API Client & Approvals Navigation, List & Filter Views
- **Scope:** Update `@floz/web`:
  - `apps/web/lib/api-client.ts`: Add Phase 10 types (`ApprovalRequestSummary`, `ApprovalRequestDetail`, `ApprovalStep`, `Comment`, `Mention`) and API client methods.
  - `apps/web/components/shell.tsx`: Add "Approvals" navigation link to desktop sidebar and mobile navigation drawer.
  - `apps/web/app/workspaces/[workspaceId]/approvals/page.tsx`: Implement Approvals page shell with view tabs (`Inbox`, `Sent`, `Managed` [MANAGER only], `All` [ADMIN only]), status filters (`PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`), stable `submitted_at DESC, id DESC` keyset cursor pagination, and URL state synchronization.
- **Expected Files:**
  - `apps/web/lib/api-client.ts`
  - `apps/web/components/shell.tsx`
  - `apps/web/app/workspaces/[workspaceId]/approvals/page.tsx`
  - `apps/web/test/approvals-list.test.tsx`
- **Execution & Review Discipline:**
  1. **RED:** Write component/page tests in `approvals-list.test.tsx` covering:
     - Tab visibility based on role (Managed only for MANAGER, All only for ADMIN).
     - Canonical URL query synchronization (`view`, `status`, `cursor`).
     - Cursor reset when switching view tab or status filter.
     - Card rendering (title, requester, approver, status pill, submitted date).
     - Sidebar navigation link rendering.
  2. **Minimal Implementation:** Implement API client methods, shell link, and approvals list page.
  3. **Focused GREEN:** Run `pnpm --filter @floz/web test`.
  4. **Requirements & Code-Quality Review:** Verify URL-driven state and tab access rules.
  5. **Accessibility Review:** Verify keyboard navigation, tab roles, and ARIA labels.
  6. **Fix & Re-review Clean:** Resolve findings.
  7. **Focused Forward Commit:** `feat(web): add approvals navigation, view tabs, and list page with cursor pagination (Task 7)`

---

### Task 8: Approval Selected-Item Detail & Create/Decision/Cancel UX
- **Scope:** Implement Approval Detail slide-over/panel and action modals:
  - Selected-item pattern driven by URL query parameter `selected_approval_request_id` (closing preserves view tab and status filter context).
  - Create Approval Request modal (approver member selector, task context link, validation error handling for `422 INACTIVE_APPROVER`, `422 INVALID_APPROVER_TARGET`, `422 SELF_APPROVAL_NOT_ALLOWED`).
  - Decision dialogs: Approve (optional reason), Reject (mandatory reason with 3–500 char validation), Cancel (optional reason).
  - Complete audit trail rendering: created by/when, assigned to, decided by/when/reason, cancelled by/when/reason.
  - Conflict UX: `409 APPROVAL_NOT_PENDING` displays clear banner and refetches latest state.
- **Expected Files:**
  - `apps/web/app/workspaces/[workspaceId]/approvals/page.tsx`
  - `apps/web/components/approval-detail-panel.tsx`
  - `apps/web/components/create-approval-modal.tsx`
  - `apps/web/components/approval-decision-dialog.tsx`
  - `apps/web/test/approval-ux.test.tsx`
- **Execution & Review Discipline:**
  1. **RED:** Write tests in `approval-ux.test.tsx` covering:
     - Deep-link opening and URL preservation on close.
     - Approver selection and task-linked eligibility error feedback.
     - Decision dialog input normalization and mandatory rejection reason validation.
     - 409 conflict handling and audit actor display (distinguishing approver vs ADMIN override).
  2. **Minimal Implementation:** Implement detail panel, create modal, and decision dialogs.
  3. **Focused GREEN:** Run `pnpm --filter @floz/web test`.
  4. **Requirements & Code-Quality Review:** Verify reason validation and audit reconstruction.
  5. **Accessibility Review:** Verify focus trapping, Escape-to-close, and accessible modal announcements.
  6. **Fix & Re-review Clean:** Resolve findings.
  7. **Focused Forward Commit:** `feat(web): add approval selected-item detail panel, creation modal, and decision dialogs (Task 8)`

---

### 🛑 CHECKPOINT C — STOP
- **Prerequisites:** Tasks 6–8 completed and committed.
- **Evidence Required:** Commit hashes; files changed; exact test commands; test counts; Dashboard scope + Approval UX evidence; `pnpm lint`; `pnpm typecheck`; `git diff --check`; `git status --short`; blockers/deviations.
- **Handoff:** STOP and wait for explicit human approval before Task 9.

---

### Task 9: Task Comments & Structured Mention UX
- **Scope:** Implement Task Detail Comments section:
  - Chronological comment timeline (`created_at ASC, id ASC`) with author avatar, name, relative date, and plain-text body.
  - Structured mention composer: member multi-select dropdown for mentions, chips rendering in comment header/body.
  - Mention deduplication in composer (prevents duplicate IDs in payload; prevents self-mention notification).
  - Soft-delete button visible to author and workspace ADMIN with confirmation modal; idempotent deletion handling.
- **Expected Files:**
  - `apps/web/components/task-comments.tsx`
  - `apps/web/app/workspaces/[workspaceId]/tasks/page.tsx`
  - `apps/web/test/task-comments.test.tsx`
- **Execution & Review Discipline:**
  1. **RED:** Write tests in `task-comments.test.tsx` covering:
     - Chronological comment feed rendering.
     - Composer trimming and submission handling.
     - Mention selection and payload deduplication.
     - Author/ADMIN delete button visibility and UI removal upon soft-deletion.
  2. **Minimal Implementation:** Implement `task-comments.tsx` and integrate into Task Detail.
  3. **Focused GREEN:** Run `pnpm --filter @floz/web test`.
  4. **Requirements & Code-Quality Review:** Verify plain-text escaping and structured mention chip rendering.
  5. **Accessibility Review:** Verify keyboard operation and `aria-live` announcements on comment post/delete.
  6. **Fix & Re-review Clean:** Resolve findings.
  7. **Focused Forward Commit:** `feat(web): add task comments timeline and structured mention composer (Task 9)`

---

### Task 10: Notification Deep-Link Integration & Accessibility Hardening
- **Scope:** Wire deep links and accessibility:
  - `apps/web/lib/task-route.ts`: Add `approvalRoute(workspaceId, approvalRequestId, view)` returning `/workspaces/${workspaceId}/approvals?view=${view}&selected_approval_request_id=${approvalRequestId}`.
  - `apps/web/components/notification-center.tsx`: Route approval notifications to `approvalRoute` and task mention notifications to `taskRoute(workspaceId, taskId)` (`selected_task_id`).
  - Accessibility hardening across Phase 10 dialogs: focus trap, focus restoration to trigger element on close, Escape key listener, high-contrast badges for all approval statuses (`PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`).
- **Expected Files:**
  - `apps/web/lib/task-route.ts`
  - `apps/web/components/notification-center.tsx`
  - `apps/web/components/approval-detail-panel.tsx`
  - `apps/web/components/create-approval-modal.tsx`
  - `apps/web/components/approval-decision-dialog.tsx`
  - `apps/web/test/notification-links.test.tsx`
- **Execution & Review Discipline:**
  1. **RED:** Write tests in `notification-links.test.tsx` covering:
     - Notification click routing to `selected_approval_request_id` and `selected_task_id`.
     - Preserving existing view/filter query parameters when deep linking.
     - Focus restoration and Escape-to-close behavior across all dialogs.
  2. **Minimal Implementation:** Update routes, notification center handler, and modal focus management.
  3. **Focused GREEN:** Run `pnpm --filter @floz/web test`.
  4. **Requirements & Code-Quality Review:** Verify deep-link destinations match §11 of design.
  5. **Accessibility Review:** Full keyboard run-through of all dialogs and notification interactions.
  6. **Fix & Re-review Clean:** Resolve findings.
  7. **Focused Forward Commit:** `feat(web): wire notification deep links and harden accessibility for approvals and comments (Task 10)`

---

### 🛑 CHECKPOINT D — STOP
- **Prerequisites:** Tasks 9–10 completed and committed.
- **Evidence Required:** Commit hashes; files changed; exact test commands; test counts; Comments/Mentions + deep-link/accessibility evidence; `pnpm lint`; `pnpm typecheck`; `git diff --check`; `git status --short`; blockers/deviations.
- **Handoff:** STOP and wait for explicit human approval before Task 11.

---

### Task 11: Real-Stack Phase 10 Playwright E2E & Phase 0–9 Regression
- **Scope:** Add 4 deterministic real-stack Playwright E2E scenarios covering Phase 10 user workflows while asserting zero regressions across Phase 0–9 tests:
  - **E2E 1 (Approval Creation & Approve Flow):** Requester creates approval request -> logs in as Approver -> opens Approvals Inbox -> views request -> approves with optional reason -> requester receives in-app `APPROVAL_APPROVED` notification -> clicking notification deep-links to request detail.
  - **E2E 2 (Reject & Cancel Lifecycle):** Requester creates approval request -> approver rejects with mandatory reason -> requester views rejection reason in Sent tab -> requester creates second request -> requester cancels request -> status updates to `CANCELLED` and approver receives `APPROVAL_CANCELLED` notification.
  - **E2E 3 (Manager Dashboard & Deduplicated Drilldown):** Two teams managed by same manager with shared member -> requester submits approval to shared member -> Manager Dashboard shows deduplicated `pending_approvals = 1` -> clicking metric drilldowns to `/approvals?view=managed&status=PENDING` displaying exactly 1 item.
  - **E2E 4 (Task Comments & Mention Deep Link):** User creates comment on task with structured mention of another user -> mentioned user receives `COMMENT_MENTIONED` notification -> clicking notification navigates to `/tasks?selected_task_id=:taskId` with comment feed open.
- **Expected Files:**
  - `apps/web/e2e/flow.spec.ts` (or `apps/web/e2e/phase10-approval-collaboration.spec.ts`)
- **Execution & Review Discipline:**
  1. **RED:** Write the 4 deterministic E2E scenarios in Playwright test file.
  2. **Minimal Implementation:** Ensure end-to-end wiring across web, API, worker, and database is green.
  3. **Focused GREEN:** Run `pwsh scripts/test-e2e.ps1`.
  4. **Requirements & Code-Quality Review:** Verify all 4 scenarios pass reliably against disposable container.
  5. **Regression Verification:** Assert all 15 existing Phase 0–9 Playwright tests continue to pass (19/19 total).
  6. **Fix & Re-review Clean:** Resolve findings.
  7. **Focused Forward Commit:** `test(e2e): cover Phase 10 approvals, comments, mentions, and manager drilldown (Task 11)`

---

### 🛑 CHECKPOINT E — STOP
- **Prerequisites:** Task 11 completed and committed.
- **Evidence Required:** Commit hashes; files changed; exact test command (`pwsh scripts/test-e2e.ps1`); pass/fail/skip counts (19/19 passing); full real-stack E2E regression evidence; `pnpm lint`; `pnpm typecheck`; `git diff --check`; `git status --short`; blockers/deviations.
- **Handoff:** STOP and wait for explicit human approval before Task 12.

---

### Task 12: Documentation Synchronization & Final Verification Report
- **Scope:** 
  1. Author `docs/implementation/PHASE_10_REPORT.md` documenting implemented architecture, test counts, and completed scope.
  2. Update `docs/implementation/IMPLEMENTATION_STATUS.md`, `CURRENT_HANDOFF.md`, and `docs/decisions/OPEN_DECISIONS.md`.
  3. Inspect and synchronize relevant external canonical documentation under `D:\Portofolio\Floz\Documentation`:
     - `Floz_API_Specification.md`: Document approval requests endpoints (§48–50) and comments/mentions (§51).
     - `Floz_ERD_Database_Design.md`: Document migration `0007` tables, constraints, and indexes.
     - External docs remain strictly outside the app git repo; do NOT initialize git there or stage them into the app repo.
  4. Run the full canonical Phase 10 verification gate sequence sequentially.
  5. Prepare the Final Phase 10 Verification Report (do NOT automatically push to origin/main).
- **Expected Files:**
  - `docs/implementation/PHASE_10_REPORT.md`
  - `docs/implementation/IMPLEMENTATION_STATUS.md`
  - `docs/implementation/CURRENT_HANDOFF.md`
  - `docs/decisions/OPEN_DECISIONS.md`
  - `D:\Portofolio\Floz\Documentation\Technical\Floz_API_Specification.md`
  - `D:\Portofolio\Floz\Documentation\Technical\Floz_ERD_Database_Design.md`
- **Execution & Review Discipline:**
  1. **Documentation Drafting:** Draft report, update status and external specifications.
  2. **Gate Sequence Execution:**
     - `pwsh scripts/test-clean-db.ps1`
     - `pwsh scripts/test-e2e.ps1`
     - `pnpm --filter @floz/worker test:integration`
     - `pnpm lint`
     - `pnpm typecheck`
     - `pnpm test` (Run #1)
     - `pnpm build`
     - `pnpm test` (Run #2)
  3. **Verification & Audit:** Record actual executed test counts from all packages.
  4. **Focused Forward Commit:** `docs: finalize phase 10 report, implementation status, and handoff (Task 12)`

---

### 🛑 CHECKPOINT F — STOP FOR FINAL ACCEPTANCE
- **Prerequisites:** Task 12 completed and committed. All 8 verification gates exit 0.
- **Evidence Required:**
  - Final Phase 10 Verification Report.
  - Exact test counts from each package.
  - Worktree state verification.
  - External documentation synchronization summary.
- **Handoff:** STOP. Phase 10 implementation complete. Publication to `origin/main` awaits separate explicit direction.

---

## 9. Rollback & Recovery Guidance

- **Database Rollback:** If a migration issue occurs in dev, drop the disposable container via `pwsh scripts/test-clean-db.ps1`.
- **Git Safety:** Maintain strict forward commits per task. Never use `git reset --hard`, force push, squash, or amend.
- **Worktree Isolation:** All tasks occur in `.worktrees/phase10-approval-collaboration-core`, isolating `master` from unfinished code.

---

## 10. Summary of Checkpoints & Verification Gates

| Checkpoint | Scope Covered | Key Verification Command |
|---|---|---|
| **Checkpoint A** | Schema migration, Approval CRUD API, locking & real concurrency tests | `pnpm --filter @floz/database test` & `pnpm --filter @floz/api test` |
| **Checkpoint B** | Comments & Mentions API, Outbox & Worker Notification handlers | `pnpm --filter @floz/api test` & `pnpm --filter @floz/worker test:integration` |
| **Checkpoint C** | Manager Dashboard `pending_approvals` metric & Web Approvals Inbox/Detail UX | `pnpm --filter @floz/database test` & `pnpm --filter @floz/web test` |
| **Checkpoint D** | Web Task Comments/Mentions UX, Notification deep links, Accessibility | `pnpm --filter @floz/web test` |
| **Checkpoint E** | Playwright Real-Stack E2E (19/19) & Phase 0-9 Regression | `pwsh scripts/test-e2e.ps1` |
| **Checkpoint F** | Final Documentation, Full 8-Step Gate Sequence & Verification Report | Full 8-step verification gate sequence |
