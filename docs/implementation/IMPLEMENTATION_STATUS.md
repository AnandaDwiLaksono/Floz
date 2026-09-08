# Implementation status

Completed
- Phase 0 repository foundation.
- Phase 1 schema foundation with Drizzle ORM/Kit and PostgreSQL tables for Better Auth identity/session data plus Floz users profile fields, roles, workspaces, workspace memberships, teams, and team memberships.
- Phase 1 API foundation with real PostgreSQL-backed auth login/logout/current session, workspace list/get, member list, and team CRUD/member endpoints.
- Better Auth secure HttpOnly cookie session transport documented in ADR.
- Provisional ADMIN-only team mutation policy documented in ADR.
- Disposable PostgreSQL migration, seed, auth persistence, workspace isolation, cross-workspace read/mutation/reference, and repository test coverage.
- Phase 2 workflow and task core with seeded default workflows/statuses/transitions, transactional task CRUD/assignment/transition/history, centralized task policy, and PostgreSQL-backed integration coverage.
- Phase 2 keyset cursor pagination with deterministic ID tie-breaker sorting.
- Phase 3 Core Web Application building on Next.js App Router, fully integrating Better Auth HTTP session cookies, responsive Shell layout, active workspace loading, task filtering, creation, patch editing, assignments, soft delete, and version conflict UI handling.
- Phase 4 Kanban API projection and web board with workflow, team, assignee, priority, and due-date filters; native drag/drop and accessible status controls; transition and version-conflict handling.
- Phase 4 production-build E2E harness verified with 1/1 Playwright test passing against disposable PostgreSQL.
- Phase 5 Calendar projection, thin route, timezone utility, task handoff, docs, and integration coverage.
- Phase 6 recurring tasks, persistent task template snapshot, ledger unique occurrences, outbox, BullMQ worker runtime, advisory-locked chronological catch-up, edit/stop semantics, and recurring Task Create modal UI.
- Phase 7 P0 in-app notifications and reminders with assignment, due-soon, overdue, durable schedule-aware deduplication, outbox/worker/reconciliation recovery, workspace/user-isolated APIs, accessible Notification Center, polling refresh, and real-stack E2E coverage.
- Phase 8 Dashboard, KPI Reporting & My Work, including final documentation and verification gates.
- Phase 9 Operator Usability & Administration: ADMIN-only account provisioning with one-time temporary credentials and no auto-membership/session, profile and password management with session hygiene, no-workspace onboarding, workspace settings, member identity projection and lifecycle with last-active-admin and active-team-manager invariants under row locking, team administration with archive/restore and manager invariants, multi-assignee task creation, task filter controls with canonical `overdue=true` and cursor hygiene, calendar reschedule with context preservation, and field worker server-authoritative quick status. See `PHASE_9_REPORT.md`.
- Phase 10 Approval & Collaboration Core: migration 0007 (`0007_bizarre_kabuki.sql`), one-step approval engine with terminal row-locking and canonical audit outbox/history, task comments with soft delete, structured mentions, in-app approval/mention notification worker handlers, manager/admin pending approvals dashboard metrics, web approval list/detail/create/decision/cancel UX with accessibility and keyboard navigation, and real-stack Playwright E2E coverage. See `PHASE_10_REPORT.md`.

In Progress
- None. Checkpoint F reached.

Next
- Phase 11 is not started. Await explicit direction; do not proceed automatically.

Blocked
- None.

Phase 10 verification
- Complete. Clean DB (`scripts/test-clean-db.ps1`) 64/64 passed, exit 0; E2E (`scripts/test-e2e.ps1`) 19/19 Playwright passed, exit 0; worker integration 16/16 passed against real PostgreSQL + Redis; lint, typecheck, and build PASS.
- Root `pnpm test` passed twice consecutively with zero failures/skips: database 31, config 2, domain 19, api 85, web 103, worker 33 = 273 tests per run.
- Task 12 resolved active team membership filtering, linked task authorization, and component unmount race conditions via forward commits `0413ae7` and `04de057`.

Known limitations
- Approval workflow configuration, multi-step/quorum/reassignment, attachments, rich text/reactions, notification preferences UI, push, email delivery, and remaining product UI beyond Phase 10 are out of scope.
- Reporting has no historical snapshots, exports, scheduled reports, charting warehouse, saved filters, custom KPI formulas, audit analytics, or cross-workspace reporting.
- Calendar start-only tasks (`start_at != null && due_at == null`) remain unsupported and are excluded from projection.
- `CUSTOM` recurrence remains unsupported; password recovery/reset for existing accounts and email/push delivery remain out of scope.
