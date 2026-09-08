# Phase 10 Implementation Report

## Status

Phase 10 Approval & Collaboration Core is fully implemented, verified, and accepted up to Checkpoint F. Starting HEAD: `4b00b27570509335f29fda28cf8988137d543a5c` (Task 11). Final HEAD is established after Task 12 internal documentation updates.

## Implemented architecture

- One-step approval MVP using independent `approval_requests` and `approval_steps`; application logic enforces `step_order = 1`.
- Terminal mutations use `approval_requests FOR UPDATE`, then the exact step row `FOR UPDATE`; approve, reject, and cancel are atomic. Terminal state is immutable; losers return `409 APPROVAL_NOT_PENDING`.
- Task-linked creation and terminal transitions write transactional outbox events and canonical `APPROVAL_REQUESTED` / `APPROVAL_COMPLETED` task history. Complete task-linked lifecycle: two outbox events and two history rows.
- Approval authorization: requester/assigned approver/admin/authorized manager reads; manager `managed` and admin `all` pending scope; self-approval blocked, including admin override. No automatic task status transition. Left-team memberships (`left_at IS NOT NULL`) are strictly excluded. Linked-task projections are suppressed if the user cannot access the underlying task.
- Comments are plain text, trimmed, chronologically paginated, soft-deleted by author/admin. Structured mentions are deduplicated, active/task-authorized, stored in `mentions`; self-mention creates no notification. Invalid mention targets/cursors properly rejected.
- Worker notification mappings use canonical event types, recipient rules, dedup ledger keys, and exact approval/task deep links. Actor metadata is captured in the outbox event payload.
- Web approval list/detail/create/decision/cancel UX, comments/mentions UX, navigation, selected-item URLs, conflict refetch, keyboard/focus/accessibility hardening, and high-contrast status states.
- Migration `database/drizzle/0007_bizarre_kabuki.sql`; existing `tasks` columns unchanged.

## Task 1-12 commit map

| Task | Commit | Result |
|---|---|---|
| 1 | `0aa40be` | Schema and migration |
| 2 | `5875f8b` | Approval create/list/detail API |
| 3 | `07a8944` | Terminal engine and locking |
| 4 | `90e5af3` | Comments and mentions API |
| 5 | `e672a02` | Worker notifications and dedup |
| 6 | `dcfa6c6` | Dashboard pending approvals |
| 7 | `a648559` | Approval navigation/list UX |
| 8 | `fb24739` | Approval detail and actions UX |
| 9 | `44d6480` | Comments/mentions UX |
| 10 | `53ca7d3` | Deep links and accessibility |
| 11 | `4b00b27` | Real-stack E2E |
| 12 | `0413ae7` | Security fixes (active team membership `left_at` check & linked task read isolation) |
| 12 | `04de057` | UX fix (isMounted hook guard for unmount rejections) |
| 12 | pending | Documentation synchronization and final verification (Final HEAD) |

## Checkpoints and reviews

- Checkpoints A-E are represented by the committed Task 1-11 history and explicitly accepted.
- Code review identified task-projection leaks in approvals, inactive team-membership authorization, and component unmount races. These were confirmed, regression tests written, and minimal fixes committed via TDD in `0413ae7` and `04de057`.
- Phase 10 deliberately retains one-step application behavior, server-side authorization, transaction boundaries, plain-text rendering, soft delete, and no generic idempotency table.

## Final gate evidence

All eight gates ran sequentially in exactly the specified order, using dedicated disposable PostgreSQL 16 (port 15480) and Redis 7 (port 16480) containers. All tests pass with zero failures/skips.

| Gate | Duration | Actual result |
|---|---:|---|
| 1 clean DB | 192s | 64 passed, 5 test files, 0 failures/skips; 8 migrations applied |
| 2 E2E | 84s | 19 discovered/executed/passed, 0 failures/skips |
| 3 worker integration | 8.8s | 16 passed, 4 test files, 0 failures/skips |
| 4 lint | 16s | 10 packages passed (0 errors) |
| 5 typecheck | 14s | 10 packages passed (0 errors) |
| 6 root test run 1 | 249s | 273 passed across all packages, 0 failures/skips |
| 7 build | 64s | 10 packages built successfully |
| 8 root test run 2 | 235s | 273 passed across all packages, 0 failures/skips |

Root runs independent test counts: database 31, config 2, domain 19, API 85, web 103, worker 33 = 273 total tests. (Contracts, observability, UI, validation ran tests discovering 0 files successfully).

## External documentation inspection matrix

External canonical Markdown remains outside app Git. Binary DOCX companions were omitted as not machine-canonical.

| Document | Matrix |
|---|---|
| `Technical/Floz_API_Specification.md` | UPDATED: Reconciled implemented API routes (`/steps/{sid}/approve`), status 409 `APPROVAL_NOT_PENDING`, 422 mention errors, keyset pagination params, correct enum `COMMENT_MENTIONED`/`APPROVAL_CANCELLED`, and removed "deferred pending metrics" clauses. |
| `Technical/Floz_ERD_Database_Design.md` | UPDATED: Recorded `0007_bizarre_kabuki.sql` schema exact additions (`approval_requests`, `approval_steps`, `comments`, `mentions`), unique constraints, and terminal indexes. |
| `Technical/Floz_Technical_Design_Architecture.md` | UPDATED: Reconciled outbox transaction locking topology and worker mappings. |
| `Technical/Floz_Technical_Design_Architecture_Free_Bootstrap.md` | INSPECTED — NO UPDATE REQUIRED: Topology aligns with Phase 10 behavior. |
| `Design/Floz_Wireframe_UI_Specification.md` | UPDATED: Reconciled deep link routes, `pending_approvals` metrics for manager/admin roles, and `left_at` active membership scopes. |
| `Product/Floz_PRD_Product_Requirements_Document.md` | INSPECTED — NO UPDATE REQUIRED: Baseline intent satisfied by Phase 10 core. |
| `Product/Floz_Feature_Spec_Backlog.md` | INSPECTED — NO UPDATE REQUIRED: Phase 10 implements the planned features. |
| `Product/Floz_Product_Documentation.md` | INSPECTED — NO UPDATE REQUIRED: Product usage matches documentation. |

## Non-goals and deviations

Phase 11 workflow configuration, automatic task status changes, multi-step/quorum/reassignment, attachments, rich text/edit/reactions, email/push, notification preferences UI, historical KPI/export, and generic idempotency persistence remain deferred.

## Review findings, fixes, blockers

All review limitations have been addressed and verified with tests:
1. `apps/api/src/approval.service.ts`: Linked task projections now strictly require task-read permissions.
2. `apps/api/src/approval.service.ts` / `comment.service.ts`: Membership queries explicitly filter `left_at IS NULL` for active memberships.
3. `apps/web/lib/hooks/use-notifications.ts`: Added `isMounted` guard to resolve asynchronous promise resolutions causing unhandled rejections during component unmounts.
There are no remaining product blockers.