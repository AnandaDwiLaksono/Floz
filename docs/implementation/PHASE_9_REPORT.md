# Phase 9 Implementation Report

## Status

Phase 9 Operator Usability & Administration is complete. Phase 10 is not started. Blockers: none. This report records actual implemented and verified behavior, not the original plan.

## Delivered scope

### Account / Profile

- Better Auth `emailAndPassword.autoSignIn` is `false`; provisioning never creates a session or cookie, and no `set-cookie` header is emitted.
- No public self-registration: `POST /auth/sign-up/email` returns `404`; there is no public signup route.
- ADMIN-only account provisioning via `POST /workspaces/:workspaceId/accounts`; non-ADMIN gets `403`, anon `401`.
- Temporary password (24+ chars, `randomBytes(24).base64url`) is revealed exactly once in the provision response/UI. `Cache-Control: no-store`. It is never stored in plaintext and cannot be re-read: `/me` and `/members` expose only public user projections, and no endpoint returns the temporary password again.
- Provisioning creates an identity only: zero workspace memberships, zero workspaces, zero sessions. Asserts in E2E.
- The provisioning ADMIN's own session is preserved unchanged.
- Profile update `PATCH /me` (full name, timezone, locale, avatar).
- Password change `PATCH /me/password`: current password required, wrong current password → `401 INVALID_CREDENTIALS`; success keeps the current session and revokes other sessions. E2E proves old password fails and new password works after change.
- No-workspace UX: provisioned user logs in and lands on a usable "No workspace access yet" page with email/name display, a working password-change form, and a Log out action (no redirect loop).

### Workspace / Membership

- Workspace settings `PATCH /workspaces/:workspaceId` (name, timezone); slug is immutable. E2E verifies slug unchanged and timezone persisted.
- Member identity projection is a single flat object `{ user_id, full_name, email, role, status }`. Phase 9 fixed web reads that incorrectly assumed a nested `user` object.
- Add existing account `POST /workspaces/:workspaceId/members` by `user_id`, with role and status; supported roles `ADMIN|MANAGER|MEMBER|FIELD_WORKER`; statuses `INVITED|ACTIVE|SUSPENDED|REMOVED`. Phase 9 added the `GET /workspaces/:workspaceId/users?email=` ADMIN lookup so the UI can resolve an email to a user that is not yet a member of the workspace.
- Membership lifecycle transitions: `INVITED → ACTIVE → SUSPENDED → REMOVED`.
- Last-active-admin invariant: a mutation that would leave zero `ACTIVE` + `ADMIN` memberships is rejected with `409 LAST_ACTIVE_ADMIN`. It is enforced under a workspace-row `SELECT ... FOR UPDATE` lock plus an explicit workspace lock inside a transaction, so concurrent demotions cannot both succeed (concurrency test asserts `200`/`409`).
- Active-team manager invariant: a member who manages an active team cannot be demoted to a non-manager role or moved to a non-ACTIVE status (`409 ACTIVE_TEAM_MANAGER`).
- Effective team membership semantics: active team members are `team_memberships` rows with `left_at IS NULL` joined to `ACTIVE` workspace memberships; archives and restores preserve retained manager assignment unless explicitly changed.

### Team Administration

- Create/update teams; update supports name, description, `manager_user_id` (null clears, undefined retains), and `is_active`.
- Archive/restore via `is_active:false` / `is_active:true`; restore with a retained demoted manager → `409 INVALID_MANAGER`; explicitly supplied invalid manager → `400 INVALID_MANAGER`.
- Archived teams reject member-add with `409 TEAM_ARCHIVED` (both controller and service enforce it).
- Manager must be an `ACTIVE` `ADMIN|MANAGER` workspace member.
- Manager scope is reflected in the Manager Dashboard: a MANAGER sees only their active managed teams (E2E verifies the managed team appears in `Workload by team`).
- Historical team references: archived teams remain readable; existing tasks keep their team reference (server responds `TEAM_SCOPE_MISMATCH` for inactive-team filters on reports).

### Task / Calendar / Field Worker

- `overdue=true` filter with strict `due_at < evaluation_at`; the API rejects `overdue` values other than `true`.
- `ReportingClock` defaults to the real clock and fails closed on an invalid `FLOZ_TEST_REPORTING_NOW` so tests are deterministic without leaking a test hook into production.
- `start_at <= due_at` validation on task create and update (client + API), `400 VALIDATION_ERROR` on violation.
- Multi-assignee task creation with exactly one primary assignee; primary auto-assigned to the first, Make Primary re-assigns, unchecking the primary promotes another. Persisted and read back correctly (E2E asserts exactly one primary in the DB).
- Calendar reschedule: a task card's "Reschedule" action opens the edit-schedule form with `edit_schedule=1` plus canonical calendar context (`cal_view`, `cal_date`, `cal_team_id`, `cal_assignee_id`); the title button opens read-only detail instead. After save, "Return to Calendar" reconstructs the same context and the updated schedule is visible after refetch.
- Field Worker quick status: per-card "Quick status" fetches the task detail and server-provided available transitions on demand (no N+1), renders server-authoritative transition buttons (verified by a custom server-seeded status no hardcoded UI could render), submits with the authoritative version, handles `409 VERSION_CONFLICT`, and refetches My Work on success so the projection updates.

## Real-stack defects discovered (Phase 9) and forward fixes

- **Add-existing member lookup was scoped to current members.** The UI searched the workspace member list, so an existing account outside the workspace could never be added. Fixed forward: added ADMIN-only `GET /workspaces/:workspaceId/users?email=` reusing `userByEmail` and `publicUser`; the UI resolves the email first (404 → "Provision an account first.") then adds by `user_id`.
- **Member name API-shape mismatch.** Web read member names via a non-existent nested `user.full_name`, rendering UUIDs/`System`. Fixed forward: flat `full_name` reads across tasks (assignee select, creator, detail), calendar assignee filter, and kanban assignee filter.
- **Team `isActive` contract mismatch.** Web `Team` type and page read `is_active`, but the API returns camelCase `isActive`, so every team rendered "Archived" and archive/restore was dead. Fixed forward: aligned `Team.isActive` and the teams page.
- **Stale task-detail assignment/version state.** The task list API hardcodes `assignees: []`, so clicking a list row opened detail with an empty assignment panel and a stale version. Fixed forward: row-open now refetches the task detail (matching the URL-open path).

## Known limitations / deferred items (unchanged scope exclusions)

- Approval notifications, comments/mentions, attachments, audit.
- Notification preferences UI, email/push delivery, password recovery/reset for existing accounts.
- Calendar start-only tasks (`start_at` without `due_at`) remain unsupported in projection.
- Historical KPI/export, scheduled reports, custom KPI formulas.
- `CUSTOM` recurrence remains unsupported.
- Offline mode.
- No migration was added in Phase 9 (zero-migration); the `database/` tree is untouched within the Phase 9 range.

## Known pre-existing accessibility follow-ups

- Some admin dialogs (members, teams, add) still lack Escape-to-close/focus-trap handling; escape and focus behavior is present on the task-create dialog, shell navigation, and notifications.
- Skip-link support remains future accessibility hardening.

These accessibility gaps are pre-existing and are not new Phase 9 regressions. Phase 9 added control labels (member role/status, team manager) and keyboard-operated flows with Playwright assertions for the provisioning and password flows.

## Verification evidence

All counts below are from the final Phase 9 gate run; see `IMPLEMENTATION_STATUS.md` for the complete canonical totals.

- clean DB: API + auth via `scripts/test-clean-db.ps1`.
- E2E via `scripts/test-e2e.ps1`: 15/15 Playwright.
- Worker integration: 16/16 with real PostgreSQL + Redis.
- Lint, typecheck, build: PASS.
- Root `pnpm test` twice consecutively: database 24, config 2, contracts 19, api 52, web 58, worker 28 — zero failures/skips both runs.
- Diff check and worktree clean at commit time.

## Phase 9 milestone range

Base for Phase 9 is `abc8e3e` (final Phase 9 plan). HEAD at acceptance is `3eac635`.