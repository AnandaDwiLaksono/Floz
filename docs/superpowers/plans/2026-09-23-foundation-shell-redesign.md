# Foundation Shell Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved Modern Calm Workspace foundation and responsive shell without changing Floz business behavior.

**Architecture:** Tailwind v4 semantic CSS variables provide light-default and explicit dark themes. `Shell` remains the auth/workspace-aware orchestrator while focused components own canonical navigation, workspace selection, drawers, notifications, and theme selection. One typed navigation model drives every form factor with deterministic segment matching.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS v4, lucide-react, Vitest, Testing Library, Playwright.

## Global Constraints

- Base SHA: `84aef3aa665b93bbe0e5e75fad90b3a0a1964c1a`.
- Branch: `redesign/foundation-shell`; never merge or deploy.
- `DESIGN_VARIANCE: 5`, `MOTION_INTENSITY: 3`, `VISUAL_DENSITY: 5`.
- Light is default; dark is the only explicit alternative; persistence key is `floz-theme`.
- Tailwind dark utilities must use an explicit selector, never OS preference.
- Mobile `<768`, tablet `768–1023`, desktop `>=1024`; permanent sidebar is desktop-only.
- Preserve route-aware workspace resolution, permissions, auth, APIs, notification behavior, and real data.
- Shell/shared copy touched in this scope defaults to Bahasa Indonesia.
- No new UI framework, icon package, npm font dependency, PWA manifest, or page-content redesign.
- Do not use/reset manual PostgreSQL `5432` or Redis `6379`.
- Apply TDD: each behavior test must fail for the expected reason before implementation.

---

### Task 1: Theme foundation and primitives

**Files:**
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/app/layout.tsx`
- Create: `apps/web/components/ui/theme-provider.tsx`
- Create: `apps/web/components/ui/theme-switcher.tsx`
- Create only as consumed: `apps/web/components/ui/button.tsx`, `surface.tsx`, `badge.tsx`, `skeleton.tsx`, `page-container.tsx`
- Test: `apps/web/test/theme.test.tsx`

**Interfaces:**
- Produces `ThemeProvider`, `ThemeSwitcher`, `Theme = 'light' | 'dark'`.
- `ThemeProvider` reads/writes `floz-theme`, defaults to light, sets `data-theme` and `color-scheme`.

- [ ] Write failing tests for default light, explicit switch, persistence/reload, and invalid persisted value fallback.
- [ ] Run targeted theme tests; confirm expected failures.
- [ ] Define approved semantic tokens for both themes and explicit Tailwind v4 dark variant.
- [ ] Add minimal pre-hydration bootstrap and provider without hydration mismatch.
- [ ] Set `<html lang="id">`; use Plus Jakarta Sans via `next/font/google` with only required weights.
- [ ] If font build fails due network/offline portability, stop and report; do not choose another font.
- [ ] Add only primitives immediately consumed by shell.
- [ ] Run theme tests, typecheck, and production build.

### Task 2: Canonical navigation model

**Files:**
- Create: `apps/web/components/shell-navigation.tsx`
- Test: `apps/web/test/shell-navigation-model.test.tsx`

**Interfaces:**
- Produces `navigationGroups`, `visibleNavigationItems(role)`, `isNavigationItemActive(pathname, workspaceId, item)` and `ShellNavigation`.
- Each item owns label, icon, route segment, permission, active matcher, and group.

- [ ] Write failing tests for Indonesian labels, route parity, Kanban inclusion, one Pengaturan, role visibility, and exact-prefix matching.
- [ ] Run targeted tests; confirm failures caused by missing model.
- [ ] Implement one immutable typed model and deterministic route-segment matcher.
- [ ] Render links from this model; keep icon stroke treatment consistent.
- [ ] Run targeted model tests.

### Task 3: Workspace switcher and responsive navigation

**Files:**
- Create: `apps/web/components/workspace-switcher.tsx`
- Create: `apps/web/components/mobile-navigation.tsx`
- Modify: `apps/web/test/shell-navigation.test.tsx`

**Interfaces:**
- `WorkspaceSwitcher` consumes resolved workspace, user workspaces, and existing `setActiveWorkspace`.
- `MobileNavigation` consumes canonical navigation items and owns modal focus behavior.

- [ ] Extend tests first for Indonesian copy, workspace switching, no stale route workspace/role, outside click, Arrow/Home/End/Escape, drawer focus trap, Escape, focus return, and all routes.
- [ ] Run tests; confirm expected failures.
- [ ] Implement semantic buttons/links, `aria-expanded`, `aria-controls`, safe outside click, and focus return.
- [ ] Implement mobile/tablet drawer for `<1024`; keep all touch targets at least 44px.
- [ ] Ensure long workspace names and role labels truncate safely.
- [ ] Run shell and auth workspace tests.

### Task 4: Header, notifications, and shell orchestration

**Files:**
- Create: `apps/web/components/app-header.tsx`
- Create: `apps/web/components/app-sidebar.tsx`
- Modify: `apps/web/components/notification-center.tsx`
- Modify: `apps/web/components/notification-item.tsx` only if semantic tokens/copy require it
- Modify: `apps/web/components/shell.tsx`
- Test: `apps/web/test/shell-navigation.test.tsx`
- Test: `apps/web/test/notification-routing.test.tsx`

**Interfaces:**
- `Shell` alone computes `resolvedWorkspace` using `workspaceResolving` and route workspace ID.
- `AppHeader` composes drawer trigger, safe workspace context, role, theme switcher, notifications, and profile affordances.
- Notification selection continues through existing `notificationRoute` and mark-read behavior.

- [ ] Write failing tests for notification open/close, unread display, navigation, Escape/focus return, outside click, and responsive panel semantics.
- [ ] Run targeted tests; confirm expected failures.
- [ ] Refactor `Shell` into orchestration only; preserve public route and auth outcome behavior.
- [ ] Implement desktop sidebar only at `lg`; tablet/mobile use drawer and form-factor-specific header sizing.
- [ ] Use semantic tokens, calm structural contrast, Indonesian copy, reduced-motion-safe transitions, and content overflow guards.
- [ ] Ensure no workspace role/name renders until route-aware resolution is complete.
- [ ] Run shell, auth, notification, and logout tests.

### Task 5: Compatibility and automated regression

**Files:**
- Modify only tests or foundation files needed by concrete failures.

- [ ] Run `pnpm --filter @floz/web lint`; record existing non-blocking warnings separately.
- [ ] Run `pnpm --filter @floz/web typecheck`.
- [ ] Run `pnpm --filter @floz/web test`.
- [ ] Run `pnpm --filter @floz/web build` with `NODE_ENV` unset and clean `apps/web/.next` if required.
- [ ] Run relevant root regressions using disposable infrastructure only when required.
- [ ] Fix only Foundation/Shell regressions; do not expand into page redesign.

### Task 6: Visual verification

**Files:**
- Create: screenshot artifacts under a git-ignored evidence directory or existing project evidence convention.

- [ ] Start the real existing Floz stack without touching manual PostgreSQL `5432` or Redis `6379`.
- [ ] Verify widths `1440`, `1024`, `768`, `390` in light and dark.
- [ ] Capture desktop light, desktop dark, mobile light, mobile dark.
- [ ] Review hierarchy, spacing, typography, contrast, overflow, workspace switcher, navigation, notifications, theme persistence, and real data.
- [ ] Correct Foundation/Shell defects via failing regression tests first.

### Task 7: Final review and stop

- [ ] Run whole-branch spec and code review against `84aef3a`.
- [ ] Re-run lint, typecheck, tests, and build after final fixes.
- [ ] Record final SHA, clean/dirty worktree, warnings, risks, blockers, and screenshot locations.
- [ ] Stop. Do not merge, deploy, or begin Core Work Surfaces.
