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

In Progress
- None.

Next
- None. Do not proceed to Phase 7 automatically.

Blocked
- None.

Open Decisions
- See `docs/decisions/OPEN_DECISIONS.md`.

Known Limitations
- Recurrence, worker activation, queue/outbox, notifications, approvals, comments, attachments, audit, KPI, and remaining product UI beyond Phase 6 are out of scope.
- Calendar start-only tasks (`start_at != null && due_at == null`) remain unsupported and are excluded from projection.
- Better Auth `baseURL` is set in test env for deterministic API integration tests.
- Web production builds now pass; previous React Hook dependency warnings were cleared.

