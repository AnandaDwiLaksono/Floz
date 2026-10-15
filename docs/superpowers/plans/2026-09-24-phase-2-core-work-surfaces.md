# Phase 2 Core Work Surfaces Implementation Plan

> Base: `374d413c300cccbbbbccafedf4d2c9283942d2f2`
> Branch: `redesign/core-work-surfaces`

Goal: redesign the existing Tasks, My Work, and selected-task detail surfaces into an Indonesian-first Modern Calm Workspace without changing API contracts or business behavior.

Architecture: keep the existing Tasks route as the canonical list, create flow, selected-task modal, edit flow, assignment flow, transition flow, comments flow, and calendar handoff. Keep My Work on `GET /workspaces/:workspaceId/my-work`; keep canonical `selected_task_id` deep links. Use existing Tailwind v4 semantic tokens and existing icon/dependency stack. Add no framework or backend changes.

## Audit findings

### Concrete UX problems

- Tasks exposes six controls plus date range and overdue checkbox at once; mobile viewport is consumed by filters before task content.
- Tasks and detail use English labels, backend enum values, hard-coded gray/blue/red utilities, and inconsistent date copy despite the Indonesian shell.
- Task rows give title, status, priority, deadline, overdue, and assignee equal visual treatment; overdue and deadline are not the scan anchor.
- Task rows are clickable `li` elements, so keyboard users lack a semantic task target.
- Empty, filtered-empty, loading, and error states are generic or English; error state has no retry despite fetch behavior being available.
- My Work is three equal cards, so overdue work does not lead the hierarchy; section copy and quick-status controls are English.
- My Work loading is a text-only layout shift; per-section empty states do not explain the next action.
- Task detail is a dense equal-weight grid inside a large modal; title, current status, due date, ownership, actions, and comments lack clear grouping.
- Detail destructive action is icon-only without an accessible name; many controls and comment content remain English.

### Visual polish issues

- Phase 1 semantic tokens are bypassed by `gray-*`, `blue-*`, `red-*`, arbitrary gray shades, and heavy shadows.
- Pill/badge repetition obscures information hierarchy.
- Surfaces use repeated boxed cards and borders instead of calm structural grouping.
- Mobile task metadata wraps unpredictably and the modal has no deliberate mobile sheet treatment.
- Skeleton uses an unavailable-looking `gray-150` utility rather than semantic surface tokens.

### Business behavior to preserve

- URL-backed task query filters, cursor reset, keyset load-more, bucket semantics, API pagination, and task selection.
- `selected_task_id` canonical route, calendar context validation, `edit_schedule=1`, return-to-calendar behavior.
- Create and recurring-task payloads, multi-assignee/one-primary semantics, optimistic `version` checks, status transitions, assignment replacement, soft delete, comments/mentions.
- Workspace/auth/role boundaries and server-provided available transitions. No invented task categories, fields, comments, attachments, or APIs.

## Taste skills

Discovered: `design-taste-frontend`, `redesign-existing-projects`, `high-end-visual-design`, `minimalist-ui`, plus `gpt-taste`, `industrial-brutalist-ui`, `popular-web-designs`, `design-md`, `stitch-design-taste`, and `design-taste-frontend-v1`.

Selected:

- `design-taste-frontend`: audit first, anti-generic composition, semantic HTML, real states, focus treatment, no decorative AI-SaaS patterns.
- `redesign-existing-projects`: targeted upgrades in the existing Next.js/Tailwind stack; preserve routes, APIs, and behavior.
- `high-end-visual-design`: measured typography, spacing, restrained interaction feedback, and deliberate hierarchy; its glass/agency/motion prescriptions are intentionally rejected where they conflict with the brief.
- `minimalist-ui`: flat structural surfaces, typographic contrast, muted semantic accents, limited container radius, no gradients/heavy shadows.

## Implementation steps

1. Revert generated `apps/web/next-env.d.ts` baseline churn. Add focused semantic presentation helpers only if reused by Tasks and My Work.
2. Add failing semantic tests for Indonesian labels, task-priority wording, distinct empty-state copy, accessible task targets, and My Work hierarchy. Run targeted tests to confirm RED.
3. Redesign Tasks header, bucket navigation, essential search/status controls, advanced filter disclosure, active-filter summary, task rows, skeleton, retry/error, filtered-empty, and mobile layout. Keep all URL/API behavior unchanged.
4. Redesign the existing create modal copy/layout only; retain exact fields and payload semantics. Preserve recurrence and multi-assignee behavior.
5. Redesign selected-task detail modal hierarchy, action grouping, assignment/status/comment sections, conflict/error copy, mobile width/scroll behavior, and accessible icon actions. Preserve all mutations and route semantics.
6. Redesign My Work into an attention-first hierarchy: overdue first when present, then today/upcoming, existing counts and links, on-demand server transitions, semantic loading/error/empty states. Do not add unsupported categories or metrics.
7. Run targeted web tests, then lint, typecheck, full tests, clean build. Treat baseline typecheck blockers separately unless Phase 2 adds new failures.
8. Run focused diff review against the base SHA. Verify light/dark at 1440, 1024, 768, and 390 with authenticated disposable data where infrastructure is available. Capture representative Tasks, filters, My Work, and Task Detail screenshots.

## Expected files

- Modify: `apps/web/app/workspaces/[workspaceId]/tasks/page.tsx`
- Modify: `apps/web/app/workspaces/[workspaceId]/my-work/page.tsx`
- Modify: `apps/web/test/tasks-page.test.tsx`
- Modify: `apps/web/test/member-pages.test.tsx`
- Add only if consumed: `apps/web/lib/task-presentation.ts`, `apps/web/test/task-presentation.test.ts`
- Add this plan document.

## Responsive and accessibility verification

- 390: no horizontal overflow; primary action and filters remain reachable; task rows are semantic buttons; detail modal uses viewport-safe width and scroll; controls retain approximately 44px touch targets.
- 768/1024: filters disclose progressively; task metadata remains scannable; My Work avoids forced equal-width cards.
- 1440: content uses available width without stretching reading measure; primary action and deadline hierarchy remain obvious.
- Light/dark: only semantic tokens; status/overdue text and labels do not rely on color alone; keyboard focus, Escape, modal semantics, labels, retry, loading announcements remain intact.
- Honor reduced motion through existing global behavior and avoid adding decorative animation.

## Explicit non-goals

Do not touch Foundation/Shell exploration, Kanban, Calendar, Dashboard, Manager Dashboard, Reports/KPI, Approvals as a standalone surface, Teams, Settings, workflow configuration, authentication, notification architecture, PWA, offline sync, backend, database, merge, deploy, or commit.
