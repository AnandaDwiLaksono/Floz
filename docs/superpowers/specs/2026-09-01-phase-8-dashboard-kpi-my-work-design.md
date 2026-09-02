# Phase 8 Dashboard, KPI & My Work Design

## Status
Approved for implementation planning; implementation requires a separate explicit approval.

## Goal
Add live PostgreSQL projections for personal work, member/manager dashboards, workload, and basic KPI reporting without duplicating Task state.

## Scope
Includes Member Dashboard, Manager Dashboard, My Work, operational workload, Due Today/Upcoming/Overdue/Completed projections, basic KPIs, canonical Task-list drilldown, managed-team authorization, responsive accessible UI, API/PostgreSQL integration tests, and Playwright E2E.

Excludes Approval and `pending_approvals`, comments/mentions, notification preferences, email/push, advanced reporting/export, immutable historical snapshots or point-in-time reconstruction, effort/capacity planning, Redis caching, materialized views, reporting tables, KPI-items P1 endpoint, workflow configuration, new search architecture, and Calendar start-only behavior.

## Canonical predicates
A completed Task enters workflow status category `DONE`; the transition controls `completed_at`. `completed_at IS NOT NULL` identifies completed work. `is_terminal` alone never identifies completion; `CANCELLED` is terminal but not completed.

Shared operational-active predicate:

```text
deleted_at IS NULL
AND current workflow status is non-terminal
```

Use it for active dashboard counts, Due Today, Upcoming, Overdue, and Workload.

Shared KPI eligibility predicate:

```text
deleted_at IS NULL
AND current status category is not CANCELLED
```

Add metric-specific timestamp predicates. `DONE` may participate in completed KPI work. `CANCELLED` participates in no KPI population.

## Scope and authorization
Members and Field Workers see non-deleted Tasks assigned to themselves; personal projections may include completed work. Managers see Tasks belonging to teams where `teams.manager_user_id` is the authenticated user. Admins see workspace-wide data. Managed-team Tasks remain in scope when unassigned or assigned to a workspace member outside that team.

`manager_user_id` is canonical baseline alignment. It is nullable; referenced users must be ACTIVE members of the same workspace and hold `MANAGER` or `ADMIN`. MEMBER/FIELD_WORKER, inactive, and cross-workspace references are rejected. Explicit null clearing is supported. Add `teams(workspace_id, manager_user_id)` if absent.

## My Work and dashboards
Preserve `GET /api/v1/workspaces/{workspace_id}/my-work?date=YYYY-MM-DD`, returning `today`, `upcoming`, `overdue`, `counts`, `meta.date`, and `meta.timezone`. It remains a lightweight convenience projection. Full lists, search, filters, and cursor pagination use canonical `/tasks`; the web page may combine both sources.

Member Dashboard includes personal active/completed counts, date buckets, recent completed work, workload, and personal KPIs. Manager Dashboard includes managed-team active/completed/overdue counts, status/priority breakdowns, team and assignee workload, explicit unassigned workload, and KPIs.

`pending_approvals` is an explicit temporary API contract deviation: deferred until Approval exists, omitted rather than fabricated as zero. Document this before implementation in the API specification and implementation decisions.

## Buckets
All active buckets use the operational-active predicate. Due Today is due during the effective local day. Upcoming uses `due_at >= today_end_exclusive AND due_at < upcoming_end_exclusive`; midnight tomorrow belongs to Upcoming. Overdue uses `evaluation_at > due_at`; equality is not overdue. Completed uses `completed_at IS NOT NULL`.

## Time and reporting intervals
Manager/Admin reporting uses workspace timezone. Personal My Work uses authenticated-user timezone with workspace fallback. Public `from` and `to` parameters are ISO-8601 timestamps defining `[from, to)` (`from` inclusive, `to` exclusive). Internal PostgreSQL queries use the same normalized half-open instants. No precision end-of-day values are exposed.

Default KPI mode is current calendar month-to-date: local month start through `evaluation_at = now`. Future work later today or later in the month is excluded. Metadata exposes `evaluation_at`. Custom periods use the supplied public `[from, to)` interval.

## Live retrospective KPI semantics
Phase 8 reports are live retrospective projections over current canonical Task records and canonical timestamps, not immutable historical snapshots. They do not reconstruct historical Task state. Reopened Tasks whose `completed_at` was cleared are no longer currently completed; rescheduled Tasks use their current `due_at`; later mutations can change past-period results intentionally. Cutoffs still control comparisons such as `completed_at <= cutoff` and `due_at < cutoff`. Snapshots, event reconstruction, and historical trends are deferred.

## KPIs
Rates are decimal ratios in `0..1`; UI formats them as percentages. Duration is canonical `average_completion_time_seconds`.

Completion Rate uses KPI-eligible non-deleted Tasks whose current `due_at` falls within the effective interval. The numerator is that same population with `completed_at` set and `completed_at <= cutoff`. No `created_at` population criterion.

Overdue Rate uses the same due-period KPI population; numerator is not completed by cutoff and `due_at < cutoff`.

On-Time Completion Rate uses due-period KPI-eligible Tasks completed by cutoff; numerator has `completed_at <= due_at`.

Average Completion Time is `AVG(completed_at - created_at)` for due-period KPI-eligible Tasks completed by cutoff, returned in seconds.

Workload counts operational-active Tasks, by team and assignee, with an explicit unassigned bucket. Priority ordering is explicit: `URGENT > HIGH > MEDIUM > LOW`; never rely on lexical PostgreSQL ordering.

Zero denominators return ratio `0` with denominator metadata. Cancelled Tasks change none of the KPI denominators, numerators, rates, average duration, or workload.

## Drilldown and navigation
Defer P1 `/reports/kpis/{metric}/items`. KPI cards provide canonical Task filters opening the existing Task List. Individual Task context always uses `/workspaces/{workspaceId}/tasks?selected_task_id={taskId}`. This convention applies to Dashboard, My Work, KPI, Calendar, Kanban, and Notifications.

## Data architecture
Use focused live query modules for My Work, Dashboard, and KPIs over PostgreSQL operational tables. Enforce workspace and authorization predicates server-side, exclude soft deletes, reuse canonical workflow semantics, use parameterized SQL, half-open ranges, explicit priority rank, deterministic ordering, and no N+1 queries. Do not add KPI storage, cache, materialized views, reporting tables, or partial-success API envelopes.

Candidate evidence-driven indexes: `tasks(workspace_id, deleted_at, due_at)`, `tasks(workspace_id, deleted_at, completed_at)`, `tasks(workspace_id, team_id, deleted_at)`, `task_assignees(user_id, task_id)`, `task_assignees(task_id, user_id)`, `task_history(task_id, created_at)`, and `teams(workspace_id, manager_user_id)`.

## UI and states
Responsive desktop/mobile layouts, semantic headings/landmarks, keyboard-operable tabs and filters, visible focus, text alternatives for breakdowns, no color-only meaning, reduced-motion support, and clear loading/empty/error/permission states. Independent frontend requests may have independent states; APIs remain full-success or canonical-error.

## Verification
API tests cover contracts, scope, manager role tightening, null clearing, intervals, MTD cutoff, KPI ratios, cancelled exclusion, and deferred fields. PostgreSQL tests cover all predicate, boundary, timezone, DONE/CANCELLED, live-retrospective, unassigned, priority, and zero-denominator semantics. Playwright covers dashboards, My Work, KPI display/drilldown, selected_task_id navigation, responsive/accessibility states, and Phase 0–7 regression. Preserve all existing final verification gates.
