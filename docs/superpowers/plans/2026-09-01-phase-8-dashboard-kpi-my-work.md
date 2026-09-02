# Phase 8 Dashboard, KPI & My Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver PostgreSQL-backed Member/Manager Dashboards, canonical My Work summary, workload monitoring, and basic live-retrospective KPI reporting with accessible responsive web surfaces.

**Architecture:** Focused PostgreSQL query modules derive all projections from current canonical Task/workflow/assignment/team records. API services enforce viewer scope and expose canonical summary contracts; `/tasks` remains the full-list and drilldown surface. Web pages compose these read endpoints without duplicating business predicates.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, NestJS, Next.js App Router, React, Vitest, Playwright.

## Global Constraints
- PostgreSQL remains canonical; no KPI storage, Redis cache, materialized view, reporting table, snapshot, or event reconstruction.
- Reuse canonical DB workflow/status semantics, never UI labels.
- Operational active: non-deleted Task in a non-terminal current status.
- KPI eligible: non-deleted Task whose current status category is not `CANCELLED`.
- “Not completed by cutoff” uses `completed_at` and cutoff, not current status alone.
- Public reporting timestamps define `[from, to)`; current MTD upper bound is `evaluation_at = now`.
- KPI rates are decimal ratios; duration is `average_completion_time_seconds`.
- Preserve `/my-work`, `/tasks`, and `selected_task_id` contracts.
- `pending_approvals` and P1 KPI-items remain deferred.
- No Phase 9/later functionality.
- Every task receives requirements review and code-quality review before the next dependent task.

## Worktree and Git Strategy
1. Start execution only after explicit plan approval.
2. Invoke `using-git-worktrees`; create an isolated Phase 8 worktree from clean `master` under the repository’s ignored `.worktrees/` location.
3. Confirm `git status --short`, branch base, migrations, and baseline tests before Task 1.
4. Keep `.superpowers/sdd/**` scratch artifacts out of product commits; stage explicit paths only.
5. One focused commit per task after tests and both review gates pass. Never amend, force-push, or commit generated runtime artifacts.
6. Stop at Checkpoints A–D for user review; do not begin the next group without approval.

## Dependency Order

```text
Task 1 schema/policy baseline
  └─ Task 2 shared predicates/time/filter contracts
       ├─ Task 3 My Work query
       ├─ Task 4 KPI query
       └─ Task 5 Dashboard query
            └─ Task 6 API endpoints/contracts
                 ├─ Task 7 canonical Task filters/routes
                 ├─ Task 8 My Work + Member UI
                 └─ Task 9 Manager + KPI UI
                      └─ Task 10 E2E/accessibility
                           └─ Task 11 docs/final verification
```

---

### Task 1: Managed-Team Schema and Policy Alignment

**Files:**
- Modify: `database/src/schema.ts`
- Create: generated migration under `database/drizzle/` via `pnpm --filter @floz/database db:generate`; record the generated filename in the task commit.
- Modify: `apps/api/src/floz.service.ts`
- Modify: relevant team DTO/controller files under `apps/api/src/`
- Test: `apps/api/test/api.test.ts`
- Test: relevant database schema integration test

**Produces:** nullable `teams.manager_user_id` behavior aligned with baseline; `teams(workspace_id, manager_user_id)` index; validated manager assignment and explicit null clearing.

- [ ] Write failing API/database tests: MANAGER and ADMIN accepted; MEMBER, FIELD_WORKER, inactive membership, and cross-workspace users rejected; null clears manager; index/schema shape exists.
- [ ] Run focused tests; verify failures identify current missing role/active/null-clear behavior.
- [ ] Implement minimal schema/index migration and transaction-safe team create/update validation using workspace membership role/status.
- [ ] Run migration on disposable DB and focused tests.
- [ ] Run `pnpm --filter @floz/api typecheck` and relevant lint command discovered from package scripts.
- [ ] Requirements review, then code-quality review; resolve all findings.
- [ ] Commit: `feat(teams): align managed-team authorization baseline`.

**Stop condition:** no reporting query work until manager authority tests pass.

---

### Task 2: Shared Reporting Semantics and Contract Types

**Files:**
- Create: `database/src/reporting-core.ts`
- Test: `database/test/reporting-core.test.ts`
- Modify: `apps/api/src/task.service.ts` only if canonical Task filtering needs shared priority/date predicates
- Create/modify: focused API DTO/types files under `apps/api/src/`

**Produces:** shared SQL predicate builders/constants for operational-active, KPI eligibility, explicit priority rank, reporting interval parsing, MTD cutoff, and canonical filter metadata.

- [ ] Write failing unit/integration checks for non-terminal active semantics, CANCELLED KPI exclusion, `URGENT > HIGH > MEDIUM > LOW`, `[from,to)`, MTD `evaluation_at`, tomorrow-midnight Upcoming, and strict overdue equality.
- [ ] Run focused tests; verify semantic failures.
- [ ] Implement minimal reusable database helpers. Resolve workflow status through canonical joined status fields; do not accept UI labels as predicate inputs.
- [ ] Implement ISO-8601 timestamp DTO validation: both timestamps required together, `from < to`, no timezone override.
- [ ] Run focused tests, lint, and typecheck.
- [ ] Requirements review, then code-quality review; resolve findings.
- [ ] Commit: `feat(reporting): add canonical projection semantics`.

## Checkpoint A
Present Task 1–2 diffs, migration, tests, and reviews. Wait for approval before projection queries.

---

### Task 3: My Work Projection

**Files:**
- Create: `database/src/my-work.ts`
- Test: `database/test/my-work.integration.test.ts`

**Consumes:** Task 2 active/date predicates.

**Produces:** `getMyWorkSummary(db, { workspaceId, userId, date, timezone, now })` returning preserved `today`, `upcoming`, `overdue`, and counts.

- [ ] Write failing PostgreSQL tests for assignment/workspace isolation, user timezone with workspace fallback input, active predicate, cancelled exclusion, midnight Upcoming inclusion, strict overdue boundary, soft delete, and deterministic ordering.
- [ ] Run focused test; verify failure.
- [ ] Implement one bounded summary projection plus bounded item lists matching the existing API baseline.
- [ ] Verify no full-list pagination is invented; full lists remain `/tasks`.
- [ ] Run focused test, database suite, lint, and typecheck.
- [ ] Requirements review, then code-quality review.
- [ ] Commit: `feat(database): add my work projection`.

---

### Task 4: Live-Retrospective KPI Projection

**Files:**
- Create: `database/src/kpis.ts`
- Test: `database/test/kpis.integration.test.ts`

**Consumes:** Task 2 KPI eligibility, period, cutoff, priority/filter semantics.

**Produces:** `getKpis(db, ReportingScope)` returning decimal rates, denominators, seconds, workload, period metadata, and canonical Task filter metadata.

- [ ] Write failing PostgreSQL fixtures for due-period population, no `created_at` population, decimal ratios, zero denominators, historical/custom `[from,to)`, MTD future exclusion, `evaluation_at`, completion exactly at cutoff, overdue equality, on-time equality, average seconds, reopen/current `completed_at`, reschedule/current `due_at`, and live result mutability.
- [ ] Add explicit cancelled fixture proving no change to every denominator, numerator, rate, average, or workload.
- [ ] Run focused test; verify failures.
- [ ] Implement minimal aggregate SQL using current canonical rows. Evaluate “not completed by cutoff” as `completed_at IS NULL OR completed_at > cutoff`.
- [ ] Return no human-formatted percentage/duration and no approval metric.
- [ ] Run focused test, database suite, lint, and typecheck.
- [ ] Capture `EXPLAIN (ANALYZE, BUFFERS)` for representative fixtures; add only evidence-supported indexes.
- [ ] Requirements review, then code-quality review.
- [ ] Commit: `feat(database): add live retrospective KPI projection`.

---

### Task 5: Member and Manager Dashboard Projections

**Files:**
- Create: `database/src/dashboard.ts`
- Test: `database/test/dashboard.integration.test.ts`

**Consumes:** Tasks 2–4 semantics and KPI projection.

**Produces:** `getMemberDashboard(...)` and `getManagerDashboard(...)`.

- [ ] Write failing tests for member assignment scope, completed inclusion, manager managed-team scope, admin workspace scope, inactive-team handling, outside-team assignee visibility, unassigned team workload, explicit priority order, and no `pending_approvals`.
- [ ] Run focused tests; verify failures.
- [ ] Implement bounded summaries/breakdowns using shared predicates; do not duplicate KPI formulas.
- [ ] Ensure workload-by-team includes unassigned Tasks; workload-by-assignee includes assigned Tasks; return explicit unassigned count.
- [ ] Run focused and database suites, lint, and typecheck.
- [ ] Review representative query plans; add no cache/materialized view.
- [ ] Requirements review, then code-quality review.
- [ ] Commit: `feat(database): add dashboard projections`.

## Checkpoint B
Present Tasks 3–5 SQL contracts, boundary evidence, query plans/index decisions, and reviews. Wait for approval before API exposure.

---

### Task 6: Dashboard, My Work, and KPI APIs

**Files:**
- Modify: `apps/api/src/floz.controller.ts`
- Modify/create: focused service/DTO files under `apps/api/src/`
- Test: `apps/api/test/api.test.ts` or focused `apps/api/test/reporting.test.ts`
- Modify: `apps/web/lib/api-client.ts` contract types/client methods

**Produces:** baseline endpoints:
- `GET /api/v1/workspaces/:workspaceId/my-work?date=YYYY-MM-DD`
- `GET /api/v1/workspaces/:workspaceId/dashboard/member`
- `GET /api/v1/workspaces/:workspaceId/dashboard/manager?from=<timestamp>&to=<timestamp>&team_id=<uuid>`
- `GET /api/v1/workspaces/:workspaceId/reports/kpis?from=<timestamp>&to=<timestamp>&team_id=<uuid>&assignee_id=<uuid>`

- [ ] Write failing API tests for envelopes, preserved My Work fields, auth/scope, manager filters, admin scope, `[from,to)`, MTD metadata, decimal ratios, seconds, denominator metadata, filter metadata, canonical errors, and omitted `pending_approvals`.
- [ ] Run focused API test; verify failures.
- [ ] Implement thin controllers/services over Tasks 3–5. Validate filters cannot expand caller scope.
- [ ] Add typed web client methods matching exact response fields; do not add KPI-items API.
- [ ] Run API tests, lint, and typecheck.
- [ ] Requirements review, then code-quality review.
- [ ] Commit: `feat(api): expose phase 8 reporting projections`.

---

### Task 7: Canonical Task Filters and Navigation

**Files:**
- Modify: `apps/api/src/task.service.ts`
- Modify: relevant Task DTO/controller query parsing
- Create: `apps/web/lib/task-route.ts`
- Modify: Task, Calendar, Kanban, and Notification route construction sites
- Test: focused API/web tests

**Produces:** canonical `/tasks` filters for dashboard/My Work drilldown and one helper preserving `selected_task_id`.

- [ ] Write failing tests for Due Today, Upcoming, Overdue, Completed filters, active/cancelled semantics, half-open dates, cursor stability, explicit priority sort, and canonical route helper output.
- [ ] Run tests; verify failures.
- [ ] Extend existing `/tasks` filtering minimally; reuse Task 2 semantics rather than duplicating formulas.
- [ ] Centralize existing route construction as `/workspaces/{workspaceId}/tasks?selected_task_id={taskId}`; preserve notification `context.route` precedence.
- [ ] Run focused tests, existing Calendar/Kanban/Notification tests, lint, and typecheck.
- [ ] Requirements review, then code-quality review.
- [ ] Commit: `feat(tasks): add reporting filters and canonical task routes`.

## Checkpoint C
Present Tasks 6–7 API contracts, compatibility evidence, and reviews. Wait for approval before UI work.

---

### Task 8: My Work and Member Dashboard UI

**Files:**
- Create: `apps/web/app/workspaces/[workspaceId]/my-work/page.tsx`
- Create: `apps/web/app/workspaces/[workspaceId]/dashboard/page.tsx` or repository-conventional member route
- Create/modify: focused components under `apps/web/components/`
- Modify: `apps/web/components/shell.tsx`
- Test: focused web component/helper tests

**Produces:** cohesive My Work summary/full-list handoff and accessible Member Dashboard.

- [ ] Write failing UI/helper tests for loading, empty, error, permission, tab/filter URLs, ratio formatting, duration formatting, and canonical drilldown.
- [ ] Run tests; verify failures.
- [ ] Implement responsive semantic pages using API values only; no KPI or bucket business logic in React.
- [ ] Use `/my-work` for summary and `/tasks` filter links/full lists. Preserve keyboard focus, visible labels, text alternatives, and reduced-motion behavior.
- [ ] Run focused tests, lint, typecheck, and production build.
- [ ] Requirements review, accessibility review, then code-quality review.
- [ ] Commit: `feat(web): add my work and member dashboard`.

---

### Task 9: Manager Dashboard and KPI UI

**Files:**
- Create: manager dashboard/report route(s) following existing App Router conventions
- Create/modify: focused dashboard/KPI/workload components
- Modify: Shell navigation/role-aware links
- Test: focused web tests

**Produces:** managed-team operational overview, KPI cards, breakdowns, unassigned workload, and canonical Task-list drilldowns.

- [ ] Write failing UI/helper tests for MANAGER/ADMIN visibility, period conversion to offset-bearing `[from,to)`, MTD `evaluation_at`, percentage formatting, seconds formatting, unassigned workload, explicit priority order, deferred approval absence, and filter links.
- [ ] Run tests; verify failures.
- [ ] Implement responsive accessible UI; charts must include textual/tabular equivalents and no color-only meaning.
- [ ] Keep Dashboard and KPI request states independent without inventing partial API responses.
- [ ] Run focused tests, lint, typecheck, and build.
- [ ] Requirements review, accessibility review, then code-quality review.
- [ ] Commit: `feat(web): add manager dashboard and KPI reporting`.

---

### Task 10: Real-Stack E2E and Regression Coverage

**Files:**
- Modify: `apps/web/e2e/flow.spec.ts` or split according to existing E2E conventions
- Modify: E2E fixture/seed helpers only as required

**Produces:** real-stack browser proof for Phase 8 and preserved Phase 0–7 flows.

- [ ] Add deterministic fixtures for member, field worker, managed/unmanaged teams, unassigned work, DONE, CANCELLED, overdue/equality/midnight boundaries, and KPI periods.
- [ ] Add Playwright scenarios for Member Dashboard, Manager Dashboard, My Work, KPI display, Task-list drilldown, `selected_task_id`, loading/empty/error/permission states, mobile viewport, keyboard navigation, and textual chart alternatives.
- [ ] Run `./scripts/test-e2e.ps1`; fix product defects, never weaken assertions to hide them.
- [ ] Run focused API/database regression suites.
- [ ] Requirements review, accessibility review, then code-quality review.
- [ ] Commit: `test(e2e): cover phase 8 operational reporting`.

## Checkpoint D
Present Tasks 8–10 UI/E2E evidence and reviews. Wait for approval before final documentation/acceptance gates.

---

### Task 11: Documentation and Deterministic Final Verification

**Files:**
- Modify: `D:\Portofolio\Floz\Documentation\Technical\Floz_API_Specification.md` (outside app Git root; coordinate parent documentation repository explicitly before staging)
- Modify: `D:\Portofolio\Floz\Documentation\Technical\Floz_ERD_Database_Design.md` (outside app Git root; coordinate parent documentation repository explicitly before staging)
- Modify: `docs/implementation/IMPLEMENTATION_STATUS.md`
- Modify: `docs/implementation/CURRENT_HANDOFF.md`
- Create: `docs/implementation/PHASE_8_REPORT.md`
- Modify: `docs/decisions/OPEN_DECISIONS.md`

**Produces:** synchronized contracts, migration/index record, decisions, limitations, final evidence, and clean handoff.

- [ ] Reconcile implemented responses and examples with the approved spec: `[from,to)`, MTD `evaluation_at`, live retrospective semantics, cancelled exclusion, manager-role tightening, approval/KPI-items deferrals, and canonical navigation.
- [ ] Update ERD for touched baseline/schema/index details only.
- [ ] Run gates sequentially with explicit exit-code checks:
  1. `./scripts/test-clean-db.ps1`
  2. `./scripts/test-e2e.ps1`
  3. `pnpm --filter @floz/worker test:integration`
  4. `pnpm lint`
  5. `pnpm typecheck`
  6. `pnpm test`
  7. `pnpm build`
- [ ] From a clean environment, run full `pnpm test` a second consecutive time.
- [ ] Record actual counts/results in `PHASE_8_REPORT.md`; never predeclare success.
- [ ] Restore generated artifacts; confirm no `.superpowers/sdd/**` scratch or secrets staged.
- [ ] Run `git status --short`, `git diff --check`, and inspect `git diff --cached --name-only`.
- [ ] Final requirements review and code-quality review; resolve all findings and rerun affected gates.
- [ ] Commit: `docs: finalize phase 8 verification report`.
- [ ] Stop. Do not start Phase 9.

## Final Acceptance Evidence
- Schema migration and rollback/clean-DB evidence.
- Focused PostgreSQL boundary and cancellation tests.
- API authorization/contract evidence.
- Playwright responsive/accessibility/drilldown evidence.
- Worker regression evidence.
- Lint, typecheck, two consecutive full-test passes, and build.
- Clean worktree with scratch artifacts excluded.
