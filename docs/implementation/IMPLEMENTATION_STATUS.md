# Implementation status

Completed
- Phase 0 repository foundation.
- Phase 1 schema foundation with Drizzle ORM/Kit and PostgreSQL tables for Better Auth identity/session data plus Floz users profile fields, roles, workspaces, workspace memberships, teams, and team memberships.
- Phase 1 API foundation with real PostgreSQL-backed auth login/logout/current session, workspace list/get, member list, and team CRUD/member endpoints.
- Better Auth secure HttpOnly cookie session transport documented in ADR.
- Provisional ADMIN-only team mutation policy documented in ADR.
- Disposable PostgreSQL migration, seed, auth persistence, workspace isolation, cross-workspace read/mutation/reference, and repository test coverage.

In Progress
- None.

Next
- Phase 2: workflow and task core.

Blocked
- None.

Open Decisions
- See `docs/decisions/OPEN_DECISIONS.md`.

Known Limitations
- No tasks, queue, recurrence, workflow, notifications, approvals, comments, attachments, audit, KPI, or product UI in Phase 1.
- Better Auth `baseURL` remains unset in test environment, producing a non-blocking warning only.
