# Phase 5 Calendar Design

## Scope

Phase 5 adds a workspace Calendar as a read projection of canonical Tasks. It adds no schema, calendar event model, mutation endpoint, recurrence, reminders, notifications, or drag rescheduling.

## Architecture

`GET /api/v1/workspaces/:workspaceId/calendar/tasks` authorizes workspace membership, validates `from`, `to`, `team_id`, and `assignee_id`, then queries PostgreSQL directly. A scheduled task overlaps a half-open range `[from, to)` when `start_at < to AND due_at >= from`. A deadline-only task matches when `start_at IS NULL AND due_at >= from AND due_at < to`. Tasks with `start_at != null AND due_at == null` are unsupported in Phase 5 Calendar projection because the source documentation does not define their Calendar semantics; they must not receive fabricated due times or durations. Soft-deleted tasks are excluded. Team and assignee references must belong to the workspace.

The response is `{ data: CalendarTask[], meta: { from, to } }`. Each item contains `id`, `task_key`, `title`, `status`, `priority`, `start_at`, `due_at`, `is_deadline_only`, and `primary_assignee`. The endpoint never mutates Tasks.

## Timezone

`workspace.timezone` is the sole workspace Calendar timezone. Month, week, day, Today, API boundaries, display, and date grouping use that IANA timezone. Boundaries are calculated in workspace-local civil time, then converted to offset-bearing ISO 8601 instants. Stored timestamps remain timezone-aware UTC instants. Browser timezone never affects grouping; it is only an explicit fallback if workspace timezone is unavailable. The page displays the active timezone unobtrusively.

A small replaceable dependency-free timezone utility uses `Intl.DateTimeFormat` for zoned parts and offset conversion. It stays behind a narrow interface so Temporal or a timezone library can replace it later if tests expose complexity. Tests cover midnight, offsets, month transitions, DST-capable zones, multi-day tasks, and differing browser timezones.

## Web UI

The protected `/workspaces/:workspaceId/calendar` route is linked from the authenticated shell. URL parameters hold `view=month|week|day`, `date=YYYY-MM-DD`, `team_id`, and `assignee_id`. Previous, next, Today, and view controls update URL state; each resulting bounded range fetches a fresh server projection.

Desktop and tablet render conventional lightweight Month, Week, and Day layouts. Mobile prioritizes a readable agenda presentation while preserving selected view state. Task controls remain keyboard accessible and identify status/priority with text, not color alone. Deadline-only items are labelled as deadlines and receive no fabricated start time.

## Canonical Task Integration

Selecting an item deep-links to the existing Tasks route with `selected_task_id`, reusing canonical detail/edit behavior. Creating from a date/time context deep-links to the existing task creation flow with prefill URL parameters. Existing Task creation owns submission through `POST /tasks`; prefilled scheduling values remain editable. Returning to Calendar causes a fresh projection request.

## States and Errors

The page distinguishes initial loading, range loading, empty range, filtered no-results, API failure, permission failure, and invalid range. Navigation and view buttons have accessible names, selected/current dates are conveyed semantically, controls have labels, focus remains visible, and touch targets remain usable.

## Verification

PostgreSQL/API tests cover scheduled overlap, deadline-only inclusion, exclusion outside range, deleted exclusion, workspace isolation, filters, validation, metadata, and timezone boundaries. Real-stack Playwright covers login, rendering, navigation, views, deadline display, filters, create/open integration, persistence refresh, and mobile smoke. Final gates are clean DB, E2E, lint, typecheck, test, and build.
