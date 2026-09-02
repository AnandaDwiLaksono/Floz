## Current phase
Phase 8 Dashboard, KPI Reporting & My Work complete. Phase 9 is not started.

## Completed work
- Phase 6 Recurring Tasks + Worker Foundation accepted complete.
- Phase 7 delivered P0 in-app `TASK_ASSIGNED`, `TASK_DUE_SOON`, and `TASK_OVERDUE` notifications.
- Phase 8 delivered canonical reporting predicates, My Work, member and manager dashboards, KPI reporting, role-scoped API projections, reporting drilldowns, and responsive accessible web surfaces.
- My Work applies workspace-local boundaries, strict overdue semantics, due-date ordering, and workspace/assignee isolation.
- KPI and dashboard reporting applies explicit intervals, evaluation-time cutoffs, current-field semantics, cancellation/deletion exclusions, and member/manager/admin scopes.
- Added database, API, web-unit, and real-stack Playwright reporting coverage. See `PHASE_8_REPORT.md`.

## Current blocker
- None.

## Verification
- Post-fix controller verification: clean DB API 25/25 plus auth 2/2, exit 0; E2E 8/8 after the KPI scope and harness fixes; My Work PostgreSQL 3/3; worker 28/28; lint, typecheck, and build PASS; two consecutive root `pnpm test` passes each reported API 29/29, web 34/34, and worker 28/28.
- Latest fixes harden KPI team, assignee, and timestamp validation; enforce dashboard scope in the direct handler; and make E2E app binds parallel-safe (`cbbd082`, `e4c6700`).
- Latest commits: `1e80d35`, `cbbd082`, `e0fc112`, `e4c6700`, `12251cb`, `e36ff22`, `d852eec`, `bcf8cff`, `5089855`, `18ac07b`.
- Nonblocking: Next.js multi-lockfile warning and existing ESLint Pages warning.

## Next actions
- Stop after Phase 8. Phase 9 is not started; await explicit direction.

## Phases/features that must not be started
- Phase 9 and later.
- Approval notifications, comments, mentions, attachments, audit analytics, notification preferences UI, push, email delivery, non-task Calendar events, reporting exports, scheduled reports, and cross-workspace reporting.
