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

In Progress
- None.

Next
- Phase 10 is not started. Await explicit direction; do not proceed automatically.

Blocked
- None.

Phase 9 verification
- Complete. Clean DB (`scripts/test-clean-db.ps1`) API + auth 38/38, exit 0; E2E (`scripts/test-e2e.ps1`) 15/15 Playwright; worker integration 16/16 against real PostgreSQL + Redis; lint, typecheck, and build PASS.
- Root `pnpm test` passed twice consecutively: database 24, config 2, contracts 19, api 52, web 58, worker 28 — zero failures/skips both runs.
- Task 11 added ADMIN account lookup, corrected member `full_name` shape, team `isActive` contract, and task-detail refetch on row open; no migration was added in Phase 9 (zero-migration).
- Phase 9 commits: `959a3dc`, `837c455`, `2bfe827`, `9b98a82`, `7bac4d8`, `aa16d1d`, `bd81e88`, `4b822ac`, `26ba556`, `95f1812`, `a38f113`, `6c3792c`, `5f6aa87`, `38d9bc4`, `3eac635`. Earlier Task 8–10 commits were rebased once; the rebase is documented and the current hashes above are canonical (see `PHASE_9_REPORT.md`).
- Nonblocking: Next.js multi-lockfile warning and existing ESLint Pages warning.

Open Decisions
- See `docs/decisions/OPEN_DECISIONS.md`.

Known Limitations
- Approval notifications, comments, mentions, attachments, audit, notification preferences UI, push, email delivery, and remaining product UI beyond Phase 9 are out of scope.
- Reporting has no historical snapshots, exports, scheduled reports, charting warehouse, saved filters, custom KPI formulas, audit analytics, or cross-workspace reporting.
- Calendar start-only tasks (`start_at != null && due_at == null`) remain unsupported and are excluded from projection.
- `CUSTOM` recurrence remains unsupported; password recovery/reset for existing accounts and email/push delivery remain out of scope.
- Some pre-existing accessibility follow-ups remain: several admin dialogs lack Escape-to-close/focus-trap handling, and skip-link support is future hardening.
- Better Auth `baseURL` is set in test env for deterministic API integration tests.
- Web production builds pass; previous React Hook dependency warnings were cleared.

