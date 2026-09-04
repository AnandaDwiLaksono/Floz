# Phase 9 Operator Usability & Administration Implementation Plan

**Status:** FINAL IMPLEMENTATION PLAN / APPROVED FOR EXECUTION

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Floz operable by real admins, managers, members, and field workers without manual database intervention.

**Architecture:** Keep PostgreSQL canonical, reuse current Better Auth and existing task/reporting services, and add thin server endpoints plus focused web surfaces. Push invariant checks into server transactions, keep React as a presentation layer, and preserve Phase 0–8 behavior.

**Tech Stack:** NestJS API, Better Auth 1.7.1, postgres.js/Drizzle schema, Next.js App Router, React, Tailwind, Vitest, Playwright, Windows PowerShell scripts.

## Global Constraints

- PostgreSQL remains canonical.
- Zero database schema migrations.
- Preserve workspace isolation.
- Server-side authorization only.
- No duplicate business logic in React.
- No new tables for UI state.
- Preserve optimistic concurrency.
- Preserve Phase 0–8 behavior.
- No Phase 10+ scope.
- Public self-registration is out of scope.
- ADMIN-only account provisioning only.
- Better Auth core `auth.api.signUpEmail` is the approved provisioning primitive with global `emailAndPassword: { enabled: true, autoSignIn: false }`.
- Do not mount a generic Better Auth public signup handler; public signup HTTP routes remain unavailable.
- `PATCH /api/v1/me/password` is required.
- `bucket=active` and `bucket=completed` are canonical existing task semantics.
- `status_id` remains the task status filter contract.
- `overdue=true` is required for the approved Overdue Only UX; `overdue=false` is not implemented.

## Execution Worktree Gate

Before Task 1:

- [ ] Verify canonical master is clean: `git status --short --branch`.
- [ ] Fetch and verify `master...origin/main` divergence is `0 0`: `git fetch origin` then `git rev-list --left-right --count master...origin/main`.
- [ ] Create isolated branch/worktree `phase9-operator-usability-admin` using the `using-git-worktrees` skill.
- [ ] Run all Phase 9 implementation, tests, reviews, and commits inside that worktree.
- [ ] Do not develop directly on `master`.
- [ ] Do not amend, rebase, squash, or rewrite accepted Phase 0–8 history.

---

### Task 1: Account provisioning, profile update, password change

**Files:**
- Modify: `apps/api/src/floz.controller.ts`
- Modify: `apps/api/src/floz.service.ts`
- Modify: `apps/api/src/auth.ts`
- Modify: `apps/api/src/error.filter.ts`
- Modify: `apps/web/lib/api-client.ts`
- Modify: `apps/web/lib/auth-context.tsx`
- Modify: `apps/web/app/login/page.tsx`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/components/shell.tsx`
- Test: `apps/api/test/auth.test.ts`
- Test: `apps/api/test/api.test.ts`
- Test: `apps/web/test/api-client.test.ts`
- Test: `apps/web/test/shell-navigation.test.tsx`

**Interfaces:**
- Consumes: Better Auth password/session primitives already used by login/logout.
- Produces: `POST /api/v1/workspaces/:workspaceId/accounts`, `PATCH /api/v1/me`, `PATCH /api/v1/me/password`, no-workspace UX, admin session-preserving provisioning flow.

- [ ] **Step 1: Apply the approved Better Auth feasibility resolution before product code**
  - Configure Better Auth core email/password as `emailAndPassword: { enabled: true, autoSignIn: false }`.
  - Use documented server-side `auth.api.signUpEmail` for provisioning after ACTIVE ADMIN authorization.
  - Verify it creates provider-owned user/account records with password hashing, no session/token/cookie, no workspace/membership, and no ADMIN-session replacement.
  - Verify `POST /api/v1/auth/sign-up/email` and equivalent public signup routes remain unavailable because no generic Better Auth handler is mounted.
  - Do not add the Admin plugin, schema migration, direct auth-table writes, or direct password hashing.
  - Audit all repository `signUpEmail` fixture calls; none may assume signup produces a token/session. Authenticated fixture flows must use canonical `POST /api/v1/auth/login` explicitly.

- [ ] **Step 2: Write the failing API tests**

```ts
it('provisions identity only and preserves ADMIN identity and session', async () => {
  const login = await request(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
  const adminCookie = login.headers['set-cookie'][0].split(';')[0];
  const before = await request(app).get('/api/v1/me').set('Cookie', adminCookie).expect(200);
  const provisioned = await request(app)
    .post(`/api/v1/workspaces/${workspaceId}/accounts`)
    .set('Cookie', adminCookie)
    .send({ email: 'worker@example.com', full_name: 'Worker' })
    .expect(200);
  expect(provisioned.headers['set-cookie']).toBeUndefined();
  const after = await request(app).get('/api/v1/me').set('Cookie', adminCookie).expect(200);
  expect(after.body.data.id).toBe(before.body.data.id);
});
```

Add failing tests for non-admin/public rejection, duplicate email conflict, no membership/workspace creation, zero `sessions` rows for the provisioned user, non-cacheable credential response, no credential logging, wrong current password, successful password change, old password failure, new password login, current session retention, and revocation of another prior session.

Add regression tests for `autoSignIn=false`: direct `auth.api.signUpEmail` fixture identity creates user/account and zero sessions; fixture login through `POST /api/v1/auth/login` creates the expected session; unauthenticated `POST /api/v1/auth/sign-up/email` remains unavailable/not routed.

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `pnpm --filter @floz/api test -- auth.test.ts api.test.ts`

Expected: fail because the new endpoints and password-change behavior are not implemented yet.

- [ ] **Step 4: Implement minimal backend support**
  - Set global `emailAndPassword.autoSignIn=false` and use `auth.api.signUpEmail` only after ACTIVE ADMIN authorization.
  - Add ADMIN-only provisioning endpoint that creates identity/account only and reveals a high-entropy temporary password exactly once.
  - Return `Cache-Control: no-store` on the provisioning response; never log the credential, cookie, or request body.
  - Ensure provisioning does not emit a created-user `Set-Cookie`, forward it to the ADMIN client, replace the ADMIN session, or create workspace/membership.
  - Add `PATCH /api/v1/me/password` using supported Better Auth/provider-owned password behavior only.
  - Lock password-change semantics: retain current authenticated session and revoke all other sessions.
  - Add `PATCH /api/v1/me` mapping `full_name -> users.name`, `avatar_url -> users.image` metadata-only.

```ts
await auth.api.changePassword({ body: { currentPassword, newPassword }, headers });
```

- [ ] **Step 5: Re-run focused API tests**

Run: `pnpm --filter @floz/api test -- auth.test.ts api.test.ts`

Expected: pass for provisioning, password change, profile patch, session preservation.

- [ ] **Step 6: Update web client/auth flow**
  - Add API client methods for account provisioning, profile patch, and password change.
  - Keep `/login` and `/` behavior aligned with no-workspace state.
  - Show `No workspace access yet` for provisioned authenticated users with no active workspace.
  - Do not persist a temporary credential in URL, localStorage, sessionStorage, console, analytics, or any persistent client store.

- [ ] **Step 7: Add web unit tests**

Run: `pnpm --filter @floz/web test -- api-client.test.ts shell-navigation.test.tsx`

Expected: pass after client and shell updates.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/floz.controller.ts apps/api/src/floz.service.ts apps/api/src/auth.ts apps/api/src/error.filter.ts apps/api/test/auth.test.ts apps/api/test/api.test.ts apps/web/lib/api-client.ts apps/web/lib/auth-context.tsx apps/web/app/login/page.tsx apps/web/app/page.tsx apps/web/components/shell.tsx apps/web/test/api-client.test.ts apps/web/test/shell-navigation.test.tsx
git commit -m "feat(api): add profile and account provisioning"
```

**Requirements review:** ADMIN-only provisioning, no public registration, no generic workspace-admin password reset, password-change API required, no-workspace UX included.

**Code-quality review:** Keep controller thin, centralize auth/provider interaction in service helpers, avoid leaking temp credentials in logs or response history.

**Accessibility review:** No-workspace state and password-change forms need keyboard focus, clear errors, and accessible labels.

---

### Task 2: Workspace and membership lifecycle transactions

**Files:**
- Modify: `apps/api/src/floz.controller.ts`
- Modify: `apps/api/src/floz.service.ts`
- Modify: `apps/api/src/error.filter.ts`
- Test: `apps/api/test/api.test.ts`
- Test: `apps/api/test/membership-concurrency.test.ts` (new)

**Interfaces:**
- Consumes: current workspace/member read methods and postgres transaction patterns.
- Produces: `PATCH /api/v1/workspaces/:workspaceId`, `GET /api/v1/workspaces/:workspaceId/members`, `POST /api/v1/workspaces/:workspaceId/members`, `PATCH /api/v1/workspaces/:workspaceId/members/:userId`, atomic last-active-admin validation, managed-team manager invariant protection.

- [ ] **Step 1: Write failing lifecycle tests**

```ts
it('rejects removing the last active admin', async () => {
  await request(app)
    .patch(`/api/v1/workspaces/${workspaceId}/members/${adminId}`)
    .send({ status: 'REMOVED' })
    .expect(409);
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm --filter @floz/api test -- api.test.ts membership-concurrency.test.ts`

- [ ] **Step 3: Implement transactional service methods**
  - Add workspace patch method.
  - Extend member projection to include `user_id`, `full_name`, `email`, `role`, `status`.
  - Add member add/update lifecycle methods using one transactional mutation path.
  - Lock the canonical workspace row first in every membership lifecycle mutation path:

```sql
SELECT id
FROM workspaces
WHERE id = $workspaceId
FOR UPDATE
```

  - After the workspace lock, perform membership validation, active-admin invariant evaluation, active-team-manager invariant evaluation, and the mutation inside the same transaction.
  - Enforce `>= 1 ACTIVE ADMIN` after every mutation.
  - Reject role/status changes that would invalidate active team managers.
  - Define effective team member as `team_memberships.left_at IS NULL AND workspace_memberships.status = 'ACTIVE'` for operational lists/selectors.
  - Preserve historical team-membership rows and canonical `INVITED`, `ACTIVE`, `SUSPENDED`, `REMOVED` vocabulary.
  - On reactivation to `ACTIVE`, operational team membership becomes visible again if `left_at IS NULL`; if `left_at IS NOT NULL`, user remains absent until re-added to the team.

- [ ] **Step 4: Add concurrency coverage**
  - Two simultaneous admin demotions using the same workspace-row-first locking discipline.
  - Manager demotion while active teams exist.
  - Verify racing membership mutations cannot leave zero `ACTIVE ADMIN` users.
  - Verify no committed state leaves an active team managed by an invalid manager.

- [ ] **Step 5: Re-run API tests**

Run: `pnpm --filter @floz/api test -- api.test.ts membership-concurrency.test.ts`

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/floz.controller.ts apps/api/src/floz.service.ts apps/api/src/error.filter.ts apps/api/test/api.test.ts apps/api/test/membership-concurrency.test.ts
git commit -m "feat(api): add workspace membership transactions"
```

**Requirements review:** keep PATCH-based removal, canonical role/status fields, no DELETE member endpoint, preserve manager invariants, preserve historical membership records.

**Code-quality review:** one transaction path, no controller-side invariant logic, explicit 409/422 mapping.

**Accessibility review:** surface conflict and validation messages clearly in later UI tasks.

---

### Task 3: Team administration hardening

**Files:**
- Modify: `apps/api/src/floz.controller.ts`
- Modify: `apps/api/src/floz.service.ts`
- Modify: `apps/api/src/error.filter.ts`
- Test: `apps/api/test/api.test.ts`
- Test: `apps/api/test/team-concurrency.test.ts` (new)

**Interfaces:**
- Consumes: team list/update/member helpers.
- Produces: `is_active` archive/restore support, active-team validation, manager revalidation on restore, reject archived-team membership additions.

- [ ] **Step 1: Write failing team archive tests**

```ts
it('allows demotion for an archived team but rejects restore with its invalid historical manager', async () => {
  await request(app).patch(`/api/v1/workspaces/${wid}/teams/${teamId}`).send({ is_active: false }).expect(200);
  await request(app).patch(`/api/v1/workspaces/${wid}/members/${managerId}`).send({ role: 'MEMBER' }).expect(200);
  const archived = await request(app).get(`/api/v1/workspaces/${wid}/teams/${teamId}`).expect(200);
  expect(archived.body.data.manager_user_id).toBe(managerId);
  await request(app).patch(`/api/v1/workspaces/${wid}/teams/${teamId}`).send({ is_active: true }).expect(409);
});

it('restores an archived team when the manager remains valid', async () => {
  await request(app).patch(`/api/v1/workspaces/${wid}/teams/${teamId}`).send({ is_active: false }).expect(200);
  await request(app).patch(`/api/v1/workspaces/${wid}/teams/${teamId}`).send({ is_active: true }).expect(200);
});

it('restores an archived team after its invalid manager is cleared', async () => {
  await request(app).patch(`/api/v1/workspaces/${wid}/teams/${teamId}`).send({ is_active: false }).expect(200);
  await request(app).patch(`/api/v1/workspaces/${wid}/members/${managerId}`).send({ role: 'MEMBER' }).expect(200);
  await request(app).patch(`/api/v1/workspaces/${wid}/teams/${teamId}`).send({ manager_user_id: null }).expect(200);
  await request(app).patch(`/api/v1/workspaces/${wid}/teams/${teamId}`).send({ is_active: true }).expect(200);
});

it('restores an archived team after its invalid manager is reassigned to a valid manager', async () => {
  await request(app).patch(`/api/v1/workspaces/${wid}/teams/${teamId}`).send({ is_active: false }).expect(200);
  await request(app).patch(`/api/v1/workspaces/${wid}/members/${managerId}`).send({ status: 'SUSPENDED' }).expect(200);
  await request(app).patch(`/api/v1/workspaces/${wid}/teams/${teamId}`).send({ manager_user_id: replacementManagerId }).expect(200);
  await request(app).patch(`/api/v1/workspaces/${wid}/teams/${teamId}`).send({ is_active: true }).expect(200);
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm --filter @floz/api test -- api.test.ts team-concurrency.test.ts`

Expected: invalid-manager restore path fails; valid-manager restore path passes once implemented.

- [ ] **Step 3: Implement team lifecycle updates**
  - Extend team patch to accept `is_active`.
  - Validate manager on archive restore.
  - Reject member additions to archived teams.
  - Preserve existing `manager_user_id` contract.
  - Keep current reads showing archived teams so historical task references remain visible.

- [ ] **Step 4: Re-run tests**

Run: `pnpm --filter @floz/api test -- api.test.ts team-concurrency.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/floz.controller.ts apps/api/src/floz.service.ts apps/api/src/error.filter.ts apps/api/test/api.test.ts apps/api/test/team-concurrency.test.ts
git commit -m "feat(api): harden team administration"
```

**Requirements review:** archived teams remain historical, manager assignment revalidated on restore, no silent invalid manager reference.

**Code-quality review:** preserve current API consumers, no separate archive endpoint.

---

### Task 4: Task filter semantics and schedule validation

**Files:**
- Modify: `apps/api/src/task.service.ts`
- Modify: `apps/api/src/floz.controller.ts`
- Modify: `apps/api/src/reporting-clock.ts`
- Test: `apps/api/test/api.test.ts`
- Test: `database/test/my-work.integration.test.ts`
- Test: `database/test/reporting-core.test.ts`

**Interfaces:**
- Consumes: task list query parsing and reporting clock.
- Produces: required `overdue=true`, one captured `evaluationAt`, schedule validation for `start_at <= due_at`, preserved `bucket/status_id` behavior.

- [ ] **Step 1: Write failing overdue and schedule tests**

```ts
it('filters overdue tasks at a fixed evaluation instant', async () => {
  process.env.FLOZ_TEST_REPORTING_NOW = '2026-09-03T00:00:00.000Z';
  await request(app).get(`/api/v1/workspaces/${wid}/tasks?overdue=true`).expect(200);
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm --filter @floz/api test -- api.test.ts`

- [ ] **Step 3: Implement only the needed backend changes**
  - Keep `bucket=active|completed` and `status_id` untouched.
  - Add `overdue=true` as the canonical Task List convenience filter for the approved Overdue Only UX.
  - Do not implement `overdue=false`.
  - Resolve `evaluationAt = ReportingClock.now()` exactly once per request.
  - Enforce `start_at <= due_at` on create/update.
  - Do not introduce a second wall-clock source.

- [ ] **Step 4: Re-run API and database tests**

Run: `pnpm --filter @floz/api test -- api.test.ts` and `pnpm --filter @floz/database test`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/task.service.ts apps/api/src/floz.controller.ts apps/api/src/reporting-clock.ts apps/api/test/api.test.ts database/test/my-work.integration.test.ts database/test/reporting-core.test.ts
git commit -m "feat(api): complete task filter semantics"
```

**Requirements review:** preserve canonical bucket/status filters, implement `overdue=true` only, deterministic `ReportingClock` testing, schedule validation.

**Code-quality review:** keep date logic centralized, prefer injected clock, avoid React date truth.

---

### Task 5: Settings shell and profile/workspace UI

**Files:**
- Create: `apps/web/app/workspaces/[workspaceId]/settings/page.tsx`
- Create: `apps/web/app/workspaces/[workspaceId]/settings/profile/page.tsx`
- Create: `apps/web/app/workspaces/[workspaceId]/settings/workspace/page.tsx`
- Modify: `apps/web/components/shell.tsx`
- Modify: `apps/web/lib/api-client.ts`
- Modify: `apps/web/lib/auth-context.tsx`
- Test: `apps/web/test/settings-pages.test.tsx` (new)

**Interfaces:**
- Consumes: profile/workspace API methods and auth context.
- Produces: Settings route hierarchy, profile form, workspace form, role-gated tabs, no-workspace UX.

- [ ] **Step 1: Write failing UI tests**

```tsx
it('shows profile tab to all users and workspace tab only to admin', () => {
  render(<SettingsPage role="MANAGER" />);
  expect(screen.getByRole('tab', { name: /profile/i })).toBeVisible();
  expect(screen.queryByRole('tab', { name: /workspace/i })).toBeNull();
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm --filter @floz/web test -- settings-pages.test.tsx shell-navigation.test.tsx`

- [ ] **Step 3: Implement minimal settings routes**
  - Add settings shell and redirect to profile.
  - Add profile form with `full_name`, `timezone`, `locale`, read-only email, avatar display/placeholder.
  - Add authenticated Change Password form using `current_password` and `new_password`; show wrong-current-password and success states.
  - Add workspace form for name/timezone.
  - Hide admin tabs from non-admins and keep forbidden handling for direct access.
  - Keep `No workspace access yet` state for provisioned authenticated users with no active workspace; provide Change Password and Logout actions.

- [ ] **Step 4: Re-run web tests**

Run: `pnpm --filter @floz/web test -- settings-pages.test.tsx shell-navigation.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/workspaces/[workspaceId]/settings/page.tsx apps/web/app/workspaces/[workspaceId]/settings/profile/page.tsx apps/web/app/workspaces/[workspaceId]/settings/workspace/page.tsx apps/web/components/shell.tsx apps/web/lib/api-client.ts apps/web/lib/auth-context.tsx apps/web/test/settings-pages.test.tsx
git commit -m "feat(web): add settings profile and workspace pages"
```

**Requirements review:** route hierarchy exact, read-only email, locale as metadata, no upload/storage.

**Code-quality review:** avoid new shared abstractions, keep forms local and small.

**Accessibility review:** tab order, labels, error banners, focus on direct access forbidden state.

---

### Task 6: Member and team administration UI

**Files:**
- Create: `apps/web/app/workspaces/[workspaceId]/settings/members/page.tsx`
- Create: `apps/web/app/workspaces/[workspaceId]/settings/teams/page.tsx`
- Modify: `apps/web/lib/api-client.ts`
- Modify: `apps/web/components/shell.tsx`
- Test: `apps/web/test/settings-pages.test.tsx`
- Test: `apps/web/test/members-teams.test.tsx` (new)

**Interfaces:**
- Consumes: member projection, workspace patch, team archive/restore, manager assignment, account provisioning.
- Produces: member list/search, lifecycle controls, team list/filter/archive, manager controls.

- [ ] **Step 1: Write failing UI tests**

```tsx
it('renders member email and role', () => {
  render(<MembersPage />);
  expect(screen.getByText('worker@example.com')).toBeVisible();
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm --filter @floz/web test -- settings-pages.test.tsx members-teams.test.tsx`

- [ ] **Step 3: Implement member/team admin pages**
  - Member list/search by name/email.
  - `Provision Account` flow: email + full name; ADMIN creates identity only; display high-entropy temporary password exactly once; provide copy action and explicit warning/acknowledgement.
  - Keep temporary credential ephemeral: never place it in URL, localStorage, sessionStorage, logs, console, analytics, or persistent client stores.
  - Keep provisioning separate from adding workspace membership.
  - Add existing account by email.
  - Role/status mutation with conflict/error states.
  - Team list with active/archived views.
  - Archive/restore teams and manager assignment.
  - Reject adding members to archived teams.
  - Keep current archived team/task references visible.

- [ ] **Step 4: Re-run tests**

Run: `pnpm --filter @floz/web test -- settings-pages.test.tsx members-teams.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/workspaces/[workspaceId]/settings/members/page.tsx apps/web/app/workspaces/[workspaceId]/settings/teams/page.tsx apps/web/lib/api-client.ts apps/web/components/shell.tsx apps/web/test/settings-pages.test.tsx apps/web/test/members-teams.test.tsx
git commit -m "feat(web): add member and team administration"
```

**Requirements review:** canonical member statuses preserved, patch-based removal, manager invariant preserved, archived-team behavior preserved.

**Code-quality review:** keep table/card rendering accessible, no hidden network logic in row components.

**Accessibility review:** searchable lists, row actions, and modals need keyboard support and clear state messages.

---

### Task 7: Multi-assignee task creation

**Files:**
- Modify: `apps/web/app/workspaces/[workspaceId]/tasks/page.tsx`
- Modify: `apps/web/lib/api-client.ts`
- Test: `apps/api/test/api.test.ts`
- Test: `apps/web/test/tasks-page.test.tsx` (new)

**Interfaces:**
- Consumes: task create payload already accepts assignees.
- Produces: multi-assignee create picker with zero assignees allowed, unique users, max one primary, active same-workspace members only.

- [ ] **Step 1: Write failing create tests**

```tsx
it('submits multiple assignees with one primary', async () => {
  await user.click(screen.getByRole('button', { name: /create task/i }));
  // select two members, mark one primary
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm --filter @floz/web test -- tasks-page.test.tsx`

- [ ] **Step 3: Implement create picker**
  - Replace single-assignee select with accessible multi-assignee picker.
  - Reuse detail assignment semantics for unique users and primary selection.
  - Keep zero assignees valid.
  - Keep recurring create aligned only if the recurring path is actively used in the task page.

- [ ] **Step 4: Re-run tests**

Run: `pnpm --filter @floz/web test -- tasks-page.test.tsx` and `pnpm --filter @floz/api test -- api.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/workspaces/[workspaceId]/tasks/page.tsx apps/web/lib/api-client.ts apps/web/test/tasks-page.test.tsx apps/api/test/api.test.ts
git commit -m "feat(web): support multi-assignee task creation"
```

**Requirements review:** no schema cardinality changes, active members only, max one primary, preserve existing edit semantics.

**Code-quality review:** keep payload construction localized, no new state machine.

**Accessibility review:** checkbox/radio semantics, keyboard navigation, and clear labels.

---

### Task 8: Calendar reschedule flow

**Files:**
- Modify: `apps/web/app/workspaces/[workspaceId]/calendar/page.tsx`
- Modify: `apps/web/lib/task-route.ts`
- Modify: `apps/web/app/workspaces/[workspaceId]/tasks/page.tsx`
- Test: `apps/web/test/calendar-page.test.tsx` (new)
- Test: `apps/web/e2e/flow.spec.ts`

**Interfaces:**
- Consumes: task route helper and task edit API.
- Produces: click-only reschedule flow, structured calendar return context, explicit refetch after mutation.

- [ ] **Step 1: Write failing calendar tests**

```tsx
it('preserves calendar context and refetches after reschedule', async () => {
  // open task from calendar, edit schedule, return to same calendar context
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm --filter @floz/web test -- calendar-page.test.tsx`

- [ ] **Step 3: Implement reschedule UX**
  - Keep `selected_task_id` canonical.
  - Keep `edit_schedule=1` ephemeral only.
  - Reconstruct same-workspace calendar URL from `view`, `date`, `team_id`, `assignee_id`.
  - Explicitly refetch/revalidate calendar after successful mutation.
  - Do not add drag-to-reschedule or arbitrary return URLs.

- [ ] **Step 4: Re-run tests and e2e**

Run: `pnpm --filter @floz/web test -- calendar-page.test.tsx` and `pnpm --filter @floz/web exec playwright test`

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/workspaces/[workspaceId]/calendar/page.tsx apps/web/lib/task-route.ts apps/web/app/workspaces/[workspaceId]/tasks/page.tsx apps/web/test/calendar-page.test.tsx apps/web/e2e/flow.spec.ts
git commit -m "feat(web): add calendar reschedule flow"
```

**Requirements review:** preserve timezone, optimistic concurrency, start/due validation, start-only limitation, no drag.

**Code-quality review:** no routing abstraction creep, keep refetch explicit.

**Accessibility review:** accessible reschedule action and dialog focus.

---

### Task 9: Field Worker quick status actions

**Files:**
- Modify: `apps/web/app/workspaces/[workspaceId]/my-work/page.tsx`
- Modify: `apps/web/app/workspaces/[workspaceId]/tasks/page.tsx`
- Modify: `apps/web/lib/api-client.ts`
- Test: `apps/web/test/member-pages.test.tsx`
- Test: `apps/web/test/tasks-page.test.tsx`
- Test: `apps/web/e2e/flow.spec.ts`

**Interfaces:**
- Consumes: existing task detail and available transitions.
- Produces: lazy quick-status path with server-authoritative transition choice and version conflict handling.

- [ ] **Step 1: Write failing quick-status tests**

```tsx
it('loads available transitions on demand', async () => {
  // open quick action, fetch transitions, transition task
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm --filter @floz/web test -- member-pages.test.tsx tasks-page.test.tsx`

- [ ] **Step 3: Implement on-demand transition UI**
  - Do not hardcode workflow rules in React.
  - Fetch detail + available transitions only when user invokes quick action.
  - Use server-provided `to_status_id` and task `version`.
  - Preserve `VERSION_CONFLICT` handling.

- [ ] **Step 4: Re-run tests and e2e**

Run: `pnpm --filter @floz/web test -- member-pages.test.tsx tasks-page.test.tsx` and `pnpm --filter @floz/web exec playwright test`

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/workspaces/[workspaceId]/my-work/page.tsx apps/web/app/workspaces/[workspaceId]/tasks/page.tsx apps/web/lib/api-client.ts apps/web/test/member-pages.test.tsx apps/web/test/tasks-page.test.tsx apps/web/e2e/flow.spec.ts
git commit -m "feat(web): add field worker quick status actions"
```

**Requirements review:** server-authoritative transitions, lazy on-demand fetch, no workflow rules in React.

**Code-quality review:** avoid N+1 by loading on user action only.

**Accessibility review:** visible text labels, focusable action controls, `aria-busy` during transitions.

---

### Task 10: Task filter UI completion

**Files:**
- Modify: `apps/web/app/workspaces/[workspaceId]/tasks/page.tsx`
- Modify: `apps/web/lib/api-client.ts`
- Test: `apps/web/test/tasks-page.test.tsx`
- Test: `apps/web/e2e/flow.spec.ts`

**Interfaces:**
- Consumes: existing task list query parameters.
- Produces: preserved search/filter URL state with task-key/title search, status_id, priority, team, assignee, due range, bucket tabs, sort, `overdue=true`, cursor reset.

- [ ] **Step 1: Write failing filter tests**

```tsx
it('resets cursor when filters change', async () => {
  // set cursor, change filter, expect cursor removed from URL
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm --filter @floz/web test -- tasks-page.test.tsx`

- [ ] **Step 3: Implement filter controls**
  - Expose canonical existing filters.
  - Keep `bucket=active|completed` unchanged.
  - Keep `status_id` unchanged.
  - Add `due_from` / `due_to` if supported by UX.
  - Add Overdue Only control that sends `overdue=true`; never emit `overdue=false`.
  - Remove `cursor` on filter changes.

- [ ] **Step 4: Re-run tests and e2e**

Run: `pnpm --filter @floz/web test -- tasks-page.test.tsx` and `pnpm --filter @floz/web exec playwright test`

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/workspaces/[workspaceId]/tasks/page.tsx apps/web/lib/api-client.ts apps/web/test/tasks-page.test.tsx apps/web/e2e/flow.spec.ts
git commit -m "feat(web): complete task filter controls"
```

**Requirements review:** no bucket redesign, preserve canonical filters, URL state source of truth.

**Code-quality review:** keep filter updates local and predictable, no speculative saved views.

**Accessibility review:** visible labels for all filter inputs, keyboard-operable chips and tabs.

---

### Task 11: Real-stack E2E and accessibility regression

**Files:**
- Modify: `apps/web/e2e/flow.spec.ts`
- Modify: `apps/web/playwright.config.ts` if needed only for test support
- Test: `scripts/test-clean-db.ps1`
- Test: `scripts/test-e2e.ps1`

**Interfaces:**
- Consumes: all completed API/web behavior.
- Produces: Phase 9 end-to-end proof for admin, member, manager, field worker, calendar, filters, and accessibility.

- [ ] **Step 1: Add failing E2E coverage**
  - Admin provisioning and no-workspace state.
  - Member/team admin.
  - Multi-assignee create.
  - Calendar reschedule.
  - Field Worker quick status.
  - Task filter URL persistence.

- [ ] **Step 2: Run e2e and confirm failure**

Run: `pwsh scripts/test-e2e.ps1`

- [ ] **Step 3: Fix any stability/accessibility issues surfaced by E2E**
  - Keyboard navigation.
  - Focus management.
  - Mobile viewport rendering.
  - Permission states.

- [ ] **Step 4: Re-run the full gate set**

Run:
- `pwsh scripts/test-clean-db.ps1`
- `pwsh scripts/test-e2e.ps1`
- `pnpm --filter @floz/worker test:integration`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- second consecutive `pnpm test`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/flow.spec.ts apps/web/playwright.config.ts scripts/test-clean-db.ps1 scripts/test-e2e.ps1
git commit -m "test(e2e): cover phase 9 operator workflows"
```

**Requirements review:** preserve Phase 0–8 regressions, role/isolation coverage, deterministic test behavior.

**Code-quality review:** avoid brittle selectors, prefer accessible roles.

**Accessibility review:** explicit keyboard flow assertions in at least one E2E path.

---

### Task 12: Documentation, status, and final verification

**Files:**
- Create: `docs/implementation/PHASE_9_REPORT.md`
- Modify: `docs/implementation/IMPLEMENTATION_STATUS.md`
- Modify: `docs/implementation/CURRENT_HANDOFF.md`
- Modify: `docs/decisions/OPEN_DECISIONS.md`
- Update separately, only if actual canonical contracts change: `D:\Portofolio\Floz\Documentation\Technical\Floz_API_Specification.md`, `D:\Portofolio\Floz\Documentation\Technical\Floz_ERD_Database_Design.md`, `D:\Portofolio\Floz\Documentation\Product\Floz_PRD_Product_Requirements_Document.md`, `D:\Portofolio\Floz\Documentation\Design\Floz_Wireframe_UI_Specification.md`

**Interfaces:**
- Consumes: completed feature set and verification evidence.
- Produces: phase report, updated status/handoff, updated open decisions, final regression proof.

- [ ] **Step 1: Write the phase report draft**
  - Summarize delivered operator/admin usability, account provisioning, membership/team lifecycle, task filters, calendar reschedule, field worker UX, verification results, and remaining deliberate exclusions.

- [ ] **Step 2: Update status/handoff/decisions**
  - Mark Phase 9 complete only after all gates pass.
  - Keep Phase 10+ excluded.
  - Record any newly verified open decisions only if implementation exposed genuine contradictions.

- [ ] **Step 3: Run final verification**

Run:
- `pwsh scripts/test-clean-db.ps1`
- `pwsh scripts/test-e2e.ps1`
- `pnpm --filter @floz/worker test:integration`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- second consecutive `pnpm test`

- [ ] **Step 4: Commit docs**

```bash
git add docs/implementation/PHASE_9_REPORT.md docs/implementation/IMPLEMENTATION_STATUS.md docs/implementation/CURRENT_HANDOFF.md docs/decisions/OPEN_DECISIONS.md
git commit -m "docs: finalize phase 9 report and status"
```

External canonical documentation lives outside the application repository. Update it separately only if actual contracts changed; do not run `git add Documentation/...` from the application worktree.

**Requirements review:** documentation must reflect the approved final design and implemented behavior, not planned behavior.

**Code-quality review:** keep docs factual, short, and aligned to verified output.

**Accessibility review:** preserve documented keyboard/mobile accessibility commitments in the report.

---

## Checkpoints

- **Checkpoint A:** Task 1 complete; approved account/profile/password baseline verified. STOP. Present evidence. Wait for explicit user approval before Task 2.
- **Checkpoint B:** Tasks 2–3 complete; membership and team invariants verified with concurrency coverage. STOP. Present evidence. Wait for explicit user approval before Task 4.
- **Checkpoint C:** Tasks 4–7 complete; task filters, settings/admin UI, and multi-assignee create verified. STOP. Present evidence. Wait for explicit user approval before Task 8.
- **Checkpoint D:** Tasks 8–10 complete; calendar, field worker, and task filter UX verified. STOP. Present evidence. Wait for explicit user approval before Task 11.
- **Checkpoint E:** Task 11 complete; full-stack e2e and accessibility pass. STOP. Present evidence. Wait for explicit user approval before Task 12.
- **Checkpoint F:** Task 12 complete; docs and final verification pass. STOP. Present evidence. Wait for explicit user approval before final closure.

## Final stop rule

Do not start the next task until the current task passes its focused tests and review checkpoints.
