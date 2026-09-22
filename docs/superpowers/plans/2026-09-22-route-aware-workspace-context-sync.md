# Route-Aware Workspace Context Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep workspace identity, role-based UI, route APIs, and redirects synchronized with the workspace ID in the current pathname during initial hydration and client navigation.

**Architecture:** `refetchUser()` only fetches and stores `/me`; a separate AuthProvider resolver reacts to resolved `user` and `pathname`. Workspace routes select the matching membership or canonicalize unauthorized IDs using `router.replace`, while a resolution flag prevents stale privileged UI. Workspace-scoped pages validate route/context identity before role checks; backend authorization remains unchanged.

**Tech Stack:** Next.js App Router, React context/hooks, TypeScript, Vitest, Testing Library, pnpm.

## Global Constraints

- Do not fetch `/me` on pathname changes solely for workspace synchronization.
- Workspace route ID is authoritative when accessible.
- Invalid workspace routes replace to `/workspaces/<first-valid-id>/tasks`; no workspaces replace to `/onboarding`.
- Unknown `/me` failures do not trigger workspace canonicalization.
- Never weaken backend authorization.
- No new dependency, deployment, merge, rebase, force push, database reset, or manual-runtime mutation.

---

### Task 1: AuthProvider route resolver

**Files:**
- Modify: `apps/web/lib/auth-context.tsx`
- Test: `apps/web/test/auth-workspace-resolution.test.tsx`

**Interfaces:**
- Produces: `workspaceResolving: boolean` on `AuthContextType`.
- Produces: route resolution driven by `[user, pathname, authOutcome]`, independent from `/me` fetching.

- [ ] **Step 1: Write failing initial-hydration tests**

Create provider harness assertions for `/workspaces/ws-1/settings/members` with `/me` workspaces `[ws-2, ws-1]`, and the inverse route. Give memberships different roles. Assert observed `activeWorkspace.id` and role match the route.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `pnpm --filter @floz/web test -- test/auth-workspace-resolution.test.tsx`
Expected: route workspace test selects the first `/me` workspace instead of the pathname workspace.

- [ ] **Step 3: Separate fetching from resolution**

Make `refetchUser()` update `user` and `authOutcome` only. Add an exact pathname parser equivalent to:

```ts
const match = pathname?.match(/^\/workspaces\/([^/]+)(?:\/|$)/);
const routeWorkspaceId = match ? decodeURIComponent(match[1]) : null;
```

Add a resolver effect. On successful authenticated state:

```ts
if (routeWorkspaceId) {
  setWorkspaceResolving(true);
  setActiveWorkspaceState(null);
  const routeWorkspace = user.workspaces.find((workspace) => workspace.id === routeWorkspaceId);
  if (routeWorkspace) setActiveWorkspaceState(routeWorkspace);
  else if (user.workspaces[0]) router.replace(`/workspaces/${user.workspaces[0].id}/tasks`);
  else router.replace('/onboarding');
  setWorkspaceResolving(false);
  return;
}
setActiveWorkspaceState((previous) =>
  previous && user.workspaces.some((workspace) => workspace.id === previous.id)
    ? previous
    : user.workspaces[0] ?? null,
);
```

Ensure unknown/failure states neither resolve nor redirect. Avoid pathname dependencies in `refetchUser()`.

- [ ] **Step 4: Add invalid, empty, and unknown-state tests**

Assert invalid route clears context before `replace('/workspaces/ws-2/tasks')`; no workspace replaces `/onboarding`; rejected non-401 `/me` does not replace. Assert pathname rerender changes active workspace without a second `api.auth.me()` call.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run: `pnpm --filter @floz/web test -- test/auth-workspace-resolution.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/auth-context.tsx apps/web/test/auth-workspace-resolution.test.tsx
git commit -m "fix(web): resolve workspace context from route"
```

### Task 2: Suppress stale Shell workspace UI

**Files:**
- Modify: `apps/web/components/shell.tsx`
- Modify: `apps/web/test/shell-navigation.test.tsx`

**Interfaces:**
- Consumes: `workspaceResolving` from `useAuth()`.
- Produces: no workspace header, role badge, or role-gated navigation while unresolved.

- [ ] **Step 1: Write failing Shell regression test**

Mock `workspaceResolving: true` with a stale admin `activeWorkspace`. Assert stale workspace name, `Role: ADMIN`, Settings, and Manager Dashboard are absent.

- [ ] **Step 2: Run focused test and confirm RED**

Run: `pnpm --filter @floz/web test -- test/shell-navigation.test.tsx`
Expected: stale workspace identity or privileged navigation remains visible.

- [ ] **Step 3: Gate workspace-derived Shell UI**

Treat active workspace as unavailable while `workspaceResolving`. Keep global loading/failure behavior intact. Gate desktop/mobile workspace title, role badge, Settings, and Manager Dashboard from the same resolved workspace value.

- [ ] **Step 4: Preserve switcher behavior**

Add/retain an assertion that selecting another workspace calls `setActiveWorkspace` and navigates through its existing implementation after resolution.

- [ ] **Step 5: Run focused test and confirm GREEN**

Run: `pnpm --filter @floz/web test -- test/shell-navigation.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/shell.tsx apps/web/test/shell-navigation.test.tsx
git commit -m "fix(web): hide stale workspace chrome while resolving"
```

### Task 3: Harden workspace settings authorization

**Files:**
- Modify: `apps/web/app/workspaces/[workspaceId]/settings/profile/page.tsx`
- Modify: `apps/web/app/workspaces/[workspaceId]/settings/workspace/page.tsx`
- Modify: `apps/web/app/workspaces/[workspaceId]/settings/members/page.tsx`
- Modify: `apps/web/app/workspaces/[workspaceId]/settings/teams/page.tsx`
- Modify: `apps/web/app/workspaces/[workspaceId]/settings/join/page.tsx`
- Modify: `apps/web/app/workspaces/[workspaceId]/settings/workflows/page.tsx`
- Modify: `apps/web/test/settings-admin.test.tsx`
- Modify: `apps/web/test/workflow-settings.test.tsx`

**Interfaces:**
- Consumes: `workspaceResolving`, `activeWorkspace`, route `workspaceId`.
- Produces: admin UI only when resolution is complete, IDs match, role is `ADMIN`.

- [ ] **Step 1: Add failing mismatch tests**

For Members, Join, Workspace, Teams, Profile settings links, and Workflows, mock an admin active workspace whose ID differs from the route ID. Assert admin controls/content do not render. Add resolving-state assertions with matching stale admin context.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `pnpm --filter @floz/web test -- test/settings-admin.test.tsx test/workflow-settings.test.tsx`
Expected: at least one page renders admin UI from the mismatched active workspace.

- [ ] **Step 3: Apply the canonical guard**

Use the same minimal condition in each page:

```ts
const isRouteAdmin =
  !workspaceResolving &&
  activeWorkspace?.id === workspaceId &&
  activeWorkspace.role === 'ADMIN';
```

Do not call privileged list APIs until route context matches. Render the existing loading/access-denied state appropriately; never render stale admin controls.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `pnpm --filter @floz/web test -- test/settings-admin.test.tsx test/workflow-settings.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/workspaces/[workspaceId]/settings apps/web/test/settings-admin.test.tsx apps/web/test/workflow-settings.test.tsx
git commit -m "fix(web): bind settings authorization to route workspace"
```

### Task 4: Harden remaining role-based workspace UI

**Files:**
- Modify: `apps/web/app/workspaces/[workspaceId]/approvals/page.tsx`
- Modify: `apps/web/app/workspaces/[workspaceId]/tasks/page.tsx`
- Modify if needed: `apps/web/app/workspaces/[workspaceId]/manager-dashboard/page.tsx`
- Modify: `apps/web/test/approval-detail.test.tsx`
- Modify: `apps/web/test/approvals-list.test.tsx`
- Modify: `apps/web/test/tasks-page.test.tsx`
- Modify: `apps/web/test/task-comments.test.tsx`
- Modify: `apps/web/test/manager-dashboard.test.tsx`

**Interfaces:**
- Consumes: resolved membership matching route workspace.
- Produces: approvals, task deletion/comment role, and manager UI based only on route-matched role.

- [ ] **Step 1: Write failing route-role mismatch tests**

Use memberships with distinct roles. Assert approval admin actions, task admin deletion/comment controls, and manager dashboard cannot inherit privileges from another workspace. Assert resolving state hides those controls.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `pnpm --filter @floz/web test -- test/approval-detail.test.tsx test/approvals-list.test.tsx test/tasks-page.test.tsx test/task-comments.test.tsx test/manager-dashboard.test.tsx`
Expected: active-workspace consumers expose at least one mismatched role control.

- [ ] **Step 3: Replace unsafe role reads**

Derive a route membership only when workspace resolution is complete and IDs match. Pass its role to `TaskCommentsSection`; use it for approval controls. Retain safer existing `user.workspaces.find(id === workspaceId)` checks only if they cannot flash before resolution; otherwise align them with the centralized resolved context.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run the Task 4 focused command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/workspaces/[workspaceId]/approvals/page.tsx apps/web/app/workspaces/[workspaceId]/tasks/page.tsx apps/web/app/workspaces/[workspaceId]/manager-dashboard/page.tsx apps/web/test/approval-detail.test.tsx apps/web/test/approvals-list.test.tsx apps/web/test/tasks-page.test.tsx apps/web/test/task-comments.test.tsx apps/web/test/manager-dashboard.test.tsx
git commit -m "fix(web): scope privileged controls to route membership"
```

### Task 5: Regression flows and final verification

**Files:**
- Modify as needed: existing tests for invitation acceptance and join-code redirects.
- Modify: `docs/superpowers/specs/2026-09-22-route-aware-workspace-hydration-design.md` only to incorporate the approved fetch/resolver separation and complete audit scope.

**Interfaces:**
- Verifies all earlier tasks as an integrated behavior.

- [ ] **Step 1: Add redirect-flow regressions**

Assert invitation acceptance and join-code success redirects produce a workspace pathname that the resolver accepts without replacing to another workspace. Assert switcher navigation remains synchronized.

- [ ] **Step 2: Run all web tests**

Run: `pnpm --filter @floz/web test`
Expected: all suites PASS.

- [ ] **Step 3: Run web static/build gates**

Run:

```bash
pnpm --filter @floz/web lint
pnpm --filter @floz/web typecheck
pnpm --filter @floz/web build
```

Expected: all PASS.

- [ ] **Step 4: Run repository gates**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

Expected: all PASS. Use only an isolated disposable test database if repository tests require one; do not touch `floz-postgres:5432`, `floz-redis:6379`, their volumes, or existing manual-test data.

- [ ] **Step 5: Verify repository and runtime safety**

Run:

```bash
git status --short
git diff --check
docker ps --filter "name=^/floz-postgres$" --filter "name=^/floz-redis$" --format "{{.Names}}|{{.Status}}|{{.Ports}}"
```

Expected: only intended changes before commit; no whitespace errors; both manual runtimes remain running on 5432/6379.

- [ ] **Step 6: Commit integrated regressions/spec refinement**

```bash
git add apps/web/test docs/superpowers/specs/2026-09-22-route-aware-workspace-hydration-design.md
git commit -m "test(web): cover workspace route context synchronization"
```

- [ ] **Step 7: Final evidence**

Record branch, final SHA, changed files, focused/full test counts, lint/typecheck/build outcomes, clean status, runtime status, warnings, and confirmation that no merge/deploy occurred.
