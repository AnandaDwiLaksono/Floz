# Phase 4 Dashboard and KPI Redesign Plan

**Base SHA:** `2f20eaf` (`feat(web): redesign kanban and calendar`)

## Goal

Improve the existing Member Dashboard and Manager Dashboard into calm, action-oriented operational measurement surfaces. Keep server reporting definitions, scopes, and routes unchanged. No Phase 5 work.

## Current implementation audit

- `dashboard/page.tsx` is an English KPI/status page. It does not answer the member attention question and duplicates the manager KPI treatment.
- `manager-dashboard/page.tsx` has correct API reads and authorization but presents bare tables, separate uncoordinated loading states, English copy, and no team filter despite API support.
- No standalone Reports/KPI route exists. KPI reporting is currently the manager dashboard's existing embedded surface; do not invent a new route.
- Member dashboard API returns projection and KPIs, while existing `/my-work` supplies the supported current task buckets. Reuse it for attention lists rather than fabricating member task collections.
- Existing API methods, half-open `reportingPeriod`, task routing, semantic tokens, and no-chart dependency all support the required UI without a new abstraction/dependency.

## Constraints

- Preserve endpoint behavior, KPI formulas, authorization scope, timezone calculations, Task and Approval routes.
- `pending_approvals` is rendered only when supplied by the Manager API; its `drilldown_url` is used directly.
- Keep `{from,to)` through `reportingPeriod`; date controls represent local inclusive calendar dates and the helper produces the exclusive next-local-day API `to` instant.
- Use native CSS/HTML bars and tables. No chart dependency, fake trend, rate recomputation, capacity score, or fabricated zero.
- Work only on `redesign/dashboard-kpi`; no commit, merge, deploy, push, or Phase 5.

## Taste skills applied

- `design-taste-frontend`: audit-first, avoid generic dashboard/card-wall patterns; retain existing visual system.
- `redesign-existing-projects`: improve current routes and contracts rather than rebuilding shell or adding speculative architecture.
- `minimalist-ui`: typography, grouped panels, dividers, low-shadow surfaces, restrained semantic color.
- `high-end-visual-design`: inspected as a contrast. Its glass, nested card, cinematic motion, and large whitespace directives conflict with the operational brief and are intentionally excluded.
- `gpt-taste`: inspected as a contrast. Its AIDA/GSAP presentation style conflicts with low-motion B2B operational UI and is excluded.
- `codebase-audit`, `test-driven-development`, `nextjs-app-router-development`, `requesting-code-review`: route/API trace, RED→GREEN behavior tests, safe client routing, and final independent review.

## Implementation tasks

1. Add failing member dashboard tests for Indonesian attention hierarchy, supported My Work task buckets, task-detail navigation, empty/error states, and API-derived KPI formatting.
2. Redesign `apps/web/app/workspaces/[workspaceId]/dashboard/page.tsx` using `dashboardMember` plus existing `myWork` data. Keep task links on canonical `selected_task_id` routes; place overdue exceptions before quieter counts; use textual labels and compact status rows.
3. Add failing manager dashboard tests for Indonesian labels, team filter API params, period shortcuts/half-open inputs, pending approval deep-link, ordered status/priority/workload views, no-data handling, and independent request errors.
4. Redesign `apps/web/app/workspaces/[workspaceId]/manager-dashboard/page.tsx`. Reuse `reportingPeriod`, `tasksRoute`, API response values, `api.workspaces.teams`, and manager-safe team options. Present operational health, exceptions, workload, performance, then breakdowns. Use a native `<select>` and HTML/CSS bars with direct text values.
5. Extend `apps/web/lib/report-format.ts` only if necessary for Indonesian duration/rate presentation and zero-denominator context. Never change backend metric values or formulas.
6. Run targeted RED/GREEN tests; run full web lint, typecheck, test, clean build.
7. Run isolated visual QA at 1440/1024/768/390 in light/dark with real API projections and disposable ports only. Verify dashboard landmark readiness, documented filters, no body overflow, text equivalents for bars, empty/sparse state, and no fake trend UI.
8. Review complete diff against `2f20eaf` for scope leak, permissions, metric/context drift, endpoint duplication, localization, accessibility, and visual card spam. Remove QA scripts/processes only after explicit approval.

## Expected file changes

- Modify: `apps/web/app/workspaces/[workspaceId]/dashboard/page.tsx`
- Modify: `apps/web/app/workspaces/[workspaceId]/manager-dashboard/page.tsx`
- Modify: `apps/web/test/member-pages.test.tsx`
- Modify: `apps/web/test/manager-dashboard.test.tsx`
- Possibly modify: `apps/web/lib/report-format.ts`
- Create: this plan only

## Behavioral verification

- Member: counts, attention lists, empty/error, localization, and task-detail links.
- Manager: MANAGER/ADMIN authorization, `from/to/team_id`, API-only metrics, pending approval action, priority order, workload text and error isolation.
- KPI: decimal ratio formatting once, duration display, zero/null context, evaluation timestamp, and no unsupported standalone reporting route.

## Responsive and visual QA

- Member: 1440 light/dark; 390 light/dark; populated and sparse state.
- Manager/KPI embedded surface: 1440 light/dark; 1024; 768; 390; filtered period/team; pending approvals; status, priority, workload; sparse state.
- Validate semantic headings, focus, native controls, text alternatives, 44px mobile targets, readable dark surfaces, and absence of gradients/glass/chart spectacle.

## Explicitly excluded

- Standalone Reports route creation, backend/database changes, KPI formula changes, task/approval redesign, charts/trends, exports, capacity scoring, notifications, settings, Teams, PWA, and Phase 5.
