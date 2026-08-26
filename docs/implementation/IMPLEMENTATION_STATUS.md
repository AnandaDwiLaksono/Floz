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

In Progress
- None.

Next
- Phase 4 features not yet started (Kanban, Calendars).

Blocked
- None.

Open Decisions
- See `docs/decisions/OPEN_DECISIONS.md`.

Known Limitations
- Queue, recurrence, notifications, approvals, comments, attachments, audit, KPI, and product UI remain out of scope.
- Better Auth `baseURL` is set in test env for deterministic API integration tests.

