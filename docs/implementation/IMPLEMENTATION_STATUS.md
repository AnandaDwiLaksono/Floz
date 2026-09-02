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

In Progress
- None.

Next
- Phase 9 is not started. Await explicit direction; do not proceed automatically.

Blocked
- None.

Phase 8 verification
- Complete. Post-fix clean DB passed with API 25/25 and auth 2/2, exit 0; E2E passed 8/8 after the KPI scope and harness fixes; database My Work passed 3/3; worker integration passed 28/28; lint, typecheck, and build passed.
- Root tests passed twice consecutively: API 29/29, web 34/34, worker 28/28.
- Latest fixes harden KPI team, assignee, and timestamp validation; enforce dashboard scope in the direct handler; and make E2E app binds parallel-safe (`cbbd082`, `e4c6700`).
- Nonblocking: Next.js multi-lockfile warning and existing ESLint Pages warning.
- Latest commits: `1e80d35`, `cbbd082`, `e0fc112`, `e4c6700`, `12251cb`, `e36ff22`, `d852eec`, `bcf8cff`, `5089855`, `18ac07b`.

Open Decisions
- See `docs/decisions/OPEN_DECISIONS.md`.

Known Limitations
- Approval notifications, comments, mentions, attachments, audit, notification preferences UI, push, email delivery, and remaining product UI beyond Phase 8 are out of scope.
- Phase 8 reporting has no historical snapshots, exports, scheduled reports, charting warehouse, saved filters, custom KPI formulas, audit analytics, or cross-workspace reporting.
- Calendar start-only tasks (`start_at != null && due_at == null`) remain unsupported and are excluded from projection.
- Better Auth `baseURL` is set in test env for deterministic API integration tests.
- Web production builds now pass; previous React Hook dependency warnings were cleared.

