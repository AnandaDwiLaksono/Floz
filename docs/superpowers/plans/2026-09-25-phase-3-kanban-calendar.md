# Phase 3 Kanban + Calendar Implementation Plan

> Base SHA: `b41f2b9` (`feat(web): redesign core work surfaces`)

**Goal:** Harden and redesign the existing Kanban and Calendar surfaces without changing API contracts, task lifecycle semantics, or the established Phase 2 Task Detail flow.

**Architecture:** Keep the existing client routes and API client. Add only presentation helpers/components when concretely shared. Keep URL state canonical, reuse `taskRoute`, `selected_task_id`, `edit_schedule`, `cal_view`, `cal_date`, and calendar return context. Preserve native drag/drop plus accessible non-drag status controls.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind 4, Vitest, existing API client, `Intl.DateTimeFormat`.

## Taste Skills

- `design-taste-frontend`: audit-first anti-slop lens; use restrained hierarchy, semantic color, purposeful density.
- `redesign-existing-projects`: improve existing implementation in place; no rewrite or new product language.
- `minimalist-ui`: utilitarian editorial hierarchy, warm neutral surfaces, compact borders, no decorative gradients/shadows.
- `high-end-visual-design`: inspected for visual quality; operational brief overrides its marketing-heavy motion/card defaults.
- `nextjs-app-router-development`: preserve current route/client architecture and SSR-safe conventions.
- `test-driven-development`: every behavior change follows RED → GREEN → focused regression.
- `dogfood`: disposable runtime and screenshot QA for interaction/responsive states.
- `requesting-code-review`: final diff/security/quality review before stopping.

## Exact Expected Files

- Modify: `apps/web/app/workspaces/[workspaceId]/kanban/page.tsx`
- Modify: `apps/web/app/workspaces/[workspaceId]/calendar/page.tsx`
- Modify: `apps/web/app/workspaces/[workspaceId]/tasks/page.tsx` only if required for existing handoff context; no duplicate detail UI
- Modify: `apps/web/lib/task-route.ts` only if required to preserve return context safely
- Modify: `apps/web/lib/i18n-labels.ts` only for shared presentation labels/date helpers
- Modify: `apps/web/test/kanban-page.test.tsx`
- Modify: `apps/web/test/calendar-page.test.tsx`
- Modify: `apps/web/lib/calendar-time.test.ts` when range/grouping regressions need coverage
- Create: only directly reused shared UI/helper files, if duplication is proven
- Create: this plan under `docs/superpowers/plans/`

## Kanban Behavior

1. Preserve `GET /workspaces/{workspaceId}/kanban` query semantics: workflow, team, assignee, priority, due range.
2. Keep active and occupied archived status columns readable; archived targets remain non-droppable.
3. Keep optimistic movement, server-provided transition validation, versioned transition mutation, rollback, refetch, and `VERSION_CONFLICT` handling.
4. Add visible Indonesian loading/error/empty states and clear valid/invalid drag target feedback.
5. Keep keyboard/touch-accessible status select as a first-class alternative to drag.
6. Use `selected_task_id` through `taskRoute` for Task Detail; closing must restore Kanban URL state.
7. Progressive disclosure for filters; active-filter summary and reset remain discoverable.
8. Cards show key, title, localized due/overdue, priority, primary assignee, and accessible status action only.

## Calendar Behavior

1. Preserve workspace-timezone range calculations and API `from`/`to` semantics.
2. Keep Month/Week/Day URL-backed views, previous/next, Today, team/assignee filters.
3. Make period heading and active view explicit; use Indonesian labels.
4. Preserve scheduled overlap and deadline-only inclusion; deadline-only items display `Tenggat` without fabricated start time.
5. Keep create handoff to canonical Tasks route with prefilled scheduling values and calendar context.
6. Keep task open/reschedule handoff through `taskRoute`, including `cal_view`, `cal_date`, team, assignee, and return context.
7. Keep event presentation compact: title, time/deadline marker, concise status/priority only where useful.
8. Make mobile a readable agenda/stack while retaining selected view semantics; avoid unusably narrow seven-column cells.

## TDD Sequence

### Kanban vertical slices

- Add failing tests for localized controls, progressive filters, empty states, task detail routing, and failed transition rollback/error copy.
- Run focused Kanban tests; confirm expected failures.
- Implement the minimum page changes.
- Run focused tests; then related Calendar/Task regressions.
- Add only necessary drag-state assertions that test behavior, not Tailwind classes.

### Calendar vertical slices

- Add failing tests for Indonesian Month/Week/Day controls, heading/navigation labels, deadline-only rendering, empty/filtered states, and create/open context.
- Run focused Calendar tests; confirm expected failures.
- Implement the minimum page changes.
- Run focused tests plus `calendar-time.test.ts`.
- Verify timezone range calls remain unchanged.

## Responsive QA

Capture Kanban and Calendar at 1440, 1024, 768, and 390 widths. Verify horizontal Kanban behavior, readable mobile cards, calendar mobile agenda, touch targets, no viewport overflow, and stable light/dark hierarchy.

## Visual QA

Disposable infrastructure only. Capture populated, filtered, empty, detail-open, deadline-only, and create-context states. Review against Modern Calm Workspace: neutral surfaces, restrained semantic accents, no gradients, no decorative metrics, no card-inside-card, low motion.

## Rollback/Error Verification

- Kanban: valid transition persists; invalid transition does not call mutation; mutation failure restores prior board and exposes Indonesian error; 409 refetches latest state without blind retry.
- Calendar: API errors retain controls/context; schedule handoff retains calendar state; deadline-only remains visible; invalid view/date is explicit.

## Final Gates

```bash
git diff --check
npm exec --yes --package=pnpm@9.15.4 -- pnpm --filter @floz/web lint
npm exec --yes --package=pnpm@9.15.4 -- pnpm --filter @floz/web typecheck
npm exec --yes --package=pnpm@9.15.4 -- pnpm --filter @floz/web test
rm -rf apps/web/.next
npm exec --yes --package=pnpm@9.15.4 -- pnpm --filter @floz/web build
```

Review full diff against `b41f2b9` for Phase 1/2 regressions, API changes, authorization changes, timezone drift, duplicated Task Detail, and Phase 4 scope creep.

STOP before Phase 4. Do not commit, merge, deploy, or push.
