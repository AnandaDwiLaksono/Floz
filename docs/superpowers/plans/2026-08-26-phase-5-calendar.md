# Phase 5 Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 5 workspace Calendar as a bounded read projection of canonical Tasks, using `workspace.timezone` for all Calendar boundaries and reusing the existing task create/detail flows.

**Architecture:** Add one SQL-backed API projection endpoint for Calendar tasks and one thin Next.js Calendar route. Keep timezone math behind a small replaceable utility, fetch only bounded ranges, deep-link into the existing Tasks page for create/detail, and verify behavior with PostgreSQL integration tests plus real-stack Playwright.

**Tech Stack:** NestJS, PostgreSQL, Better Auth, Next.js App Router, React 19, TypeScript, Vitest, Playwright, `Intl.DateTimeFormat`

## Global Constraints

- Calendar remains a read projection of canonical Tasks.
- Do not introduce a separate `calendar_events` table or independent Calendar business model.
- `workspace.timezone` is the canonical workspace Calendar timezone for Month / Week / Day boundaries, grouping, Today, and API `from` / `to` calculations.
- Use consistent half-open range semantics `[from, to)` in backend and frontend.
- Database timestamps remain timezone-aware / UTC semantics; API uses ISO 8601 timestamps.
- Do not manually strip offsets or append `Z`.
- Do not fabricate schedule data for deadline-only tasks.
- Do not invent semantics for `start_at != null && due_at == null`; treat it as unsupported in Phase 5 and document it.
- Do not implement Calendar drag-rescheduling in Phase 5.
- Do not proceed beyond Phase 5.
- Do not add a large custom timezone/date library; keep timezone conversion behind a small replaceable utility/interface.
- Reuse the existing task creation/detail flows rather than creating a second Calendar-specific task editor/detail implementation.
- Final verification must run: `./scripts/test-clean-db.ps1`, `./scripts/test-e2e.ps1`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

---

## File Structure

- Modify `apps/web/app/workspaces/[workspaceId]/tasks/page.tsx`
  - Fix existing React Hook dependency warnings.
  - Add URL-prefill support for create form and preserve canonical task detail deep-link behavior for Calendar handoff.
- Create `apps/web/lib/calendar-time.ts`
  - Small replaceable timezone utility for workspace-local day/week/month boundaries, ISO range conversion, and workspace-local formatting/grouping.
- Create `apps/web/lib/calendar-time.test.ts`
  - Vitest coverage for workspace timezone range math and browser-timezone independence.
- Modify `apps/web/lib/api-client.ts`
  - Add Calendar projection types and client method.
- Create `apps/web/app/workspaces/[workspaceId]/calendar/page.tsx`
  - Thin protected Calendar route with Month/Week/Day, URL-backed view/date/filter state, loading/error/empty states, create/open integration, and responsive layout.
- Modify `apps/web/components/shell.tsx`
  - Add Calendar navigation link.
- Modify `apps/api/src/task.service.ts`
  - Add Calendar query DTO, validation helpers, projection SQL, and workspace filter validation.
- Modify `apps/api/src/floz.controller.ts`
  - Add `GET /workspaces/:workspaceId/calendar/tasks` route using existing membership guard pattern.
- Modify `apps/api/test/api.test.ts`
  - Add PostgreSQL-backed Calendar integration tests.
- Modify `apps/web/e2e/flow.spec.ts`
  - Extend real-stack browser coverage for Calendar.
- Modify `docs/implementation/IMPLEMENTATION_STATUS.md`
  - Record Phase 5 completion and current limitations.
- Create `docs/implementation/CURRENT_HANDOFF.md`
  - Short recovery snapshot.
- Create `docs/implementation/PHASE_5_REPORT.md`
  - Phase 5 report.
- Modify `docs/implementation/OPEN_DECISIONS.md`
  - Record unsupported `start_at != null && due_at == null` Calendar semantics if still unresolved.

### Task 1: Fix existing web hook warnings and support task-create prefill handoff

**Files:**
- Modify: `apps/web/app/workspaces/[workspaceId]/tasks/page.tsx`
- Test: `apps/web/e2e/flow.spec.ts`

**Interfaces:**
- Consumes: existing `api.tasks.*`, `useSearchParams`, `useRouter`
- Produces:
  - stable task-page callbacks with no React Hook dependency warnings
  - URL prefill contract on Tasks page: `create=1`, `prefill_start_at`, `prefill_due_at`

- [ ] **Step 1: Write the failing test**

Add a focused browser test block in `apps/web/e2e/flow.spec.ts`:

```ts
test('calendar create handoff opens task form with prefilled schedule fields', async ({ page }) => {
  await page.goto(`/workspaces/${workspaceId}/tasks?create=1&prefill_start_at=2026-08-18T09:00&prefill_due_at=2026-08-18T10:00`);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('input#start_at')).toHaveValue('2026-08-18T09:00');
  await expect(page.locator('input#due_at')).toHaveValue('2026-08-18T10:00');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @floz/web exec playwright test apps/web/e2e/flow.spec.ts -g "calendar create handoff opens task form with prefilled schedule fields"`

Expected: FAIL because the Tasks page does not open create mode or populate fields from URL params.

- [ ] **Step 3: Write minimal implementation**

Refactor `apps/web/app/workspaces/[workspaceId]/tasks/page.tsx`:

```ts
const handleOpenDetail = useCallback(async (task: Task) => {
  // existing body
}, [workspaceId]);

const fetchTasks = useCallback(async (cursor?: string) => {
  // existing body
}, [workspaceId, q, status_id, priority, assignee_id, team_id, sort]);

useEffect(() => {
  const create = searchParams.get('create');
  const prefillStart = searchParams.get('prefill_start_at') || '';
  const prefillDue = searchParams.get('prefill_due_at') || '';
  if (create === '1') {
    setIsCreateOpen(true);
    setCreateStartAt(prefillStart);
    setCreateDueAt(prefillDue);
  }
}, [searchParams]);
```

Keep the rest minimal:
- add `useCallback` where needed for hook dependency correctness
- do not disable lint rule unless one remaining warning is truly intentional and narrowly suppressed with explanation
- preserve existing deep-link behavior for `selected_task_id`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @floz/web exec playwright test apps/web/e2e/flow.spec.ts -g "calendar create handoff opens task form with prefilled schedule fields"`

Expected: PASS.

Then run: `pnpm --filter @floz/web build`

Expected: PASS with no React Hook dependency warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/workspaces/[workspaceId]/tasks/page.tsx apps/web/e2e/flow.spec.ts
git commit -m "fix(web): clean hooks and support task create prefill"
```

### Task 2: Add replaceable workspace-timezone calendar utility

**Files:**
- Create: `apps/web/lib/calendar-time.ts`
- Create: `apps/web/lib/calendar-time.test.ts`

**Interfaces:**
- Consumes: `Intl.DateTimeFormat`
- Produces:
  - `export type CalendarView = 'month' | 'week' | 'day';`
  - `export function getCalendarRange(view: CalendarView, date: string, timezone: string): { from: string; to: string }`
  - `export function formatCalendarLabel(iso: string, timezone: string, options?: Intl.DateTimeFormatOptions): string`
  - `export function getCalendarDayKey(iso: string, timezone: string): string`
  - `export function shiftCalendarDate(view: CalendarView, date: string, direction: -1 | 1, timezone: string): string`
  - `export function getTodayInTimezone(timezone: string): string`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/calendar-time.test.ts` with real assertions:

```ts
import { describe, expect, it, vi } from 'vitest';
import { getCalendarDayKey, getCalendarRange, shiftCalendarDate } from './calendar-time';

describe('calendar-time', () => {
  it('builds a month range in workspace timezone using half-open boundaries', () => {
    expect(getCalendarRange('month', '2026-08-18', 'Asia/Jakarta')).toEqual({
      from: '2026-07-31T17:00:00.000Z',
      to: '2026-08-31T17:00:00.000Z',
    });
  });

  it('keeps task day grouping stable across browser timezone differences', () => {
    expect(getCalendarDayKey('2026-08-01T00:30:00.000Z', 'Asia/Jakarta')).toBe('2026-08-01');
    expect(getCalendarDayKey('2026-08-01T00:30:00.000Z', 'America/New_York')).toBe('2026-07-31');
  });

  it('shifts week navigation by workspace calendar weeks', () => {
    expect(shiftCalendarDate('week', '2026-08-18', 1, 'Asia/Jakarta')).toBe('2026-08-25');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @floz/web test -- calendar-time.test.ts`

Expected: FAIL because the utility file does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/lib/calendar-time.ts` with a narrow utility surface:

```ts
export type CalendarView = 'month' | 'week' | 'day';

export function getCalendarRange(view: CalendarView, date: string, timezone: string) {
  // derive workspace-local civil boundaries, convert to ISO instants, return { from, to }
}
```

Implementation rules:
- use `Intl.DateTimeFormat(..., { timeZone })` to read zoned parts
- keep offset conversion private to this module
- return ISO strings via `Date.toISOString()` after computing the correct instant
- use Monday-start week only if current docs/codebase already imply it; otherwise use the simplest explicit convention and keep it consistent in tests/UI
- no external dependency

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @floz/web test -- calendar-time.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/calendar-time.ts apps/web/lib/calendar-time.test.ts
git commit -m "test(web): add workspace calendar time utility"
```

### Task 3: Add backend Calendar projection endpoint

**Files:**
- Modify: `apps/api/src/task.service.ts`
- Modify: `apps/api/src/floz.controller.ts`
- Test: `apps/api/test/api.test.ts`

**Interfaces:**
- Consumes: existing workspace membership guard in `FlozController.member`, existing `AuthService` SQL access in `TaskService`
- Produces:
  - `export interface CalendarQueryDto { from?: string; to?: string; team_id?: string; assignee_id?: string; }`
  - `async calendar(workspaceId: string, query: CalendarQueryDto): Promise<{ data: CalendarTaskSummary[]; meta: { from: string; to: string } }>`

- [ ] **Step 1: Write the failing test**

Append Calendar coverage to `apps/api/test/api.test.ts`:

```ts
it('projects scheduled and deadline-only tasks for a bounded calendar range', async () => {
  const f = await fixture(app!);
  const path = `/api/v1/workspaces/${f.workspaceId}/tasks`;
  const scheduled = await request(app!.getHttpServer()).post(path).set('Cookie', f.memberCookie).send({
    title: 'Scheduled',
    start_at: '2026-08-10T01:00:00.000Z',
    due_at: '2026-08-10T03:00:00.000Z',
    assignees: [{ user_id: f.memberId, is_primary: true }],
  }).expect(201);
  await request(app!.getHttpServer()).post(path).set('Cookie', f.memberCookie).send({
    title: 'Deadline only',
    due_at: '2026-08-10T04:00:00.000Z',
  }).expect(201);

  const res = await request(app!.getHttpServer())
    .get(`/api/v1/workspaces/${f.workspaceId}/calendar/tasks`)
    .set('Cookie', f.memberCookie)
    .query({ from: '2026-08-10T00:00:00.000Z', to: '2026-08-11T00:00:00.000Z' })
    .expect(200);

  expect(res.body.meta).toEqual({ from: '2026-08-10T00:00:00.000Z', to: '2026-08-11T00:00:00.000Z' });
  expect(res.body.data).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: scheduled.body.data.id, title: 'Scheduled', is_deadline_only: false }),
    expect.objectContaining({ title: 'Deadline only', is_deadline_only: true }),
  ]));
});
```

Add separate tests for:
- outside-range exclusion
- soft-delete exclusion
- workspace isolation
- invalid timestamps / missing params => `400`
- `from > to` => `400`
- team filter
- assignee filter
- timezone boundary case
- unsupported `start_at != null && due_at == null` excluded from projection and documented

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @floz/api test -- api.test.ts`

Expected: FAIL because `/calendar/tasks` is missing.

- [ ] **Step 3: Write minimal implementation**

In `apps/api/src/task.service.ts` add the DTO/type and method:

```ts
export interface CalendarQueryDto {
  from?: string;
  to?: string;
  team_id?: string;
  assignee_id?: string;
}
```

Implement `calendar(workspaceId, query)` to:
- require `from` and `to`
- reject invalid timestamps and `from > to` with `BadRequestException('VALIDATION_ERROR')`
- verify `team_id` belongs to workspace or throw `BadRequestException('TEAM_SCOPE_MISMATCH')`
- verify `assignee_id` is a workspace member or throw `BadRequestException('CROSS_WORKSPACE_REFERENCE')`
- query only `deleted_at IS NULL`
- include scheduled overlap using `t.start_at IS NOT NULL AND t.due_at IS NOT NULL AND t.start_at < $to AND t.due_at >= $from`
- include deadline-only using `t.start_at IS NULL AND t.due_at IS NOT NULL AND t.due_at >= $from AND t.due_at < $to`
- exclude `t.start_at IS NOT NULL AND t.due_at IS NULL`
- include primary assignee via left join/subquery
- order by `COALESCE(t.start_at, t.due_at) ASC, t.task_key ASC`
- return `{ data, meta: { from, to } }`

In `apps/api/src/floz.controller.ts` add:

```ts
@Get('workspaces/:workspaceId/calendar/tasks')
async calendar(@Req() req: Request, @Param('workspaceId') wid: string) {
  await this.member(req, wid);
  return await this.tasks.calendar(wid, req.query as CalendarQueryDto);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @floz/api test -- api.test.ts`

Expected: PASS for new and existing API tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/task.service.ts apps/api/src/floz.controller.ts apps/api/test/api.test.ts
git commit -m "feat(api): add calendar task projection"
```

### Task 4: Add Calendar API client types

**Files:**
- Modify: `apps/web/lib/api-client.ts`
- Test: `apps/web/lib/calendar-time.test.ts`

**Interfaces:**
- Consumes: `apiFetch`
- Produces:
  - `export interface CalendarTaskSummary { ... }`
  - `export interface CalendarTaskList { data: CalendarTaskSummary[]; meta: { from: string; to: string } }`
  - `api.tasks.calendar(workspaceId: string, params: { from: string; to: string; team_id?: string; assignee_id?: string }): Promise<CalendarTaskList>`

- [ ] **Step 1: Write the failing test**

Add a simple client-shape test to `apps/web/lib/calendar-time.test.ts` or a neighboring web test file:

```ts
it('builds a calendar endpoint query with bounded range and filters', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ data: [], meta: { from: 'a', to: 'b' } });
  global.fetch = fetchMock as never;
  await api.tasks.calendar('ws-1', { from: 'a', to: 'b', team_id: 'team-1', assignee_id: 'user-1' });
  expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/workspaces/ws-1/calendar/tasks?from=a&to=b&team_id=team-1&assignee_id=user-1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @floz/web test -- api-client`

Expected: FAIL because `api.tasks.calendar` does not exist.

- [ ] **Step 3: Write minimal implementation**

Extend `apps/web/lib/api-client.ts`:

```ts
export interface CalendarTaskSummary {
  id: string;
  task_key: string;
  title: string;
  status: { id: string; name: string; code?: string; category?: string };
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  start_at: string | null;
  due_at: string | null;
  is_deadline_only: boolean;
  primary_assignee: { id: string; full_name: string } | null;
}
```

Add `api.tasks.calendar(...)` using `URLSearchParams` like existing list/kanban methods.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @floz/web test -- api-client`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/api-client.ts apps/web/lib/calendar-time.test.ts
git commit -m "feat(web): add calendar api client"
```

### Task 5: Build thin Calendar page

**Files:**
- Create: `apps/web/app/workspaces/[workspaceId]/calendar/page.tsx`
- Modify: `apps/web/components/shell.tsx`
- Modify: `apps/web/lib/calendar-time.ts`
- Test: `apps/web/e2e/flow.spec.ts`

**Interfaces:**
- Consumes:
  - `api.tasks.calendar(...)`
  - `getCalendarRange(view, date, timezone)`
  - `shiftCalendarDate(view, date, direction, timezone)`
  - workspace data from `api.workspaces.get(...)`
- Produces:
  - protected Calendar route with URL params `view`, `date`, `team_id`, `assignee_id`
  - Month/Week/Day UI
  - responsive create/open controls

- [ ] **Step 1: Write the failing test**

Extend `apps/web/e2e/flow.spec.ts` with one end-to-end Calendar scenario:

```ts
test('login, open calendar, navigate ranges, filter, create from context, and open task detail', async ({ page }) => {
  await page.goto('/login');
  // login + seed tasks first
  await page.goto(`/workspaces/${workspaceId}/calendar?view=month&date=2026-08-18`);
  await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
  await expect(page.getByText('Deadline only')).toBeVisible();
  await page.getByRole('button', { name: 'Week view' }).click();
  await expect(page).toHaveURL(/view=week/);
  await page.getByRole('button', { name: 'Next period' }).click();
  await expect(page).toHaveURL(/date=/);
  await page.getByLabel('Team').selectOption(teamId);
  await page.getByRole('button', { name: /Create task on/ }).click();
  await expect(page).toHaveURL(/\/tasks\?/);
  await expect(page.locator('input#start_at')).not.toHaveValue('');
  await page.goto(`/workspaces/${workspaceId}/calendar?view=day&date=2026-08-10`);
  await page.getByRole('button', { name: /Scheduled/ }).click();
  await expect(page).toHaveURL(/selected_task_id=/);
  await expect(page.getByText('Change Status')).toBeVisible();
});
```

Also add one mobile smoke using Playwright device sizing in the same file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @floz/web exec playwright test apps/web/e2e/flow.spec.ts -g "login, open calendar, navigate ranges, filter, create from context, and open task detail"`

Expected: FAIL because the Calendar route and shell link do not exist.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/app/workspaces/[workspaceId]/calendar/page.tsx`.

Minimum behavior:

```ts
const view = (searchParams.get('view') as CalendarView) || 'month';
const date = searchParams.get('date') || getTodayInTimezone(workspace.timezone);
const range = getCalendarRange(view, date, workspace.timezone);
const result = await api.tasks.calendar(workspaceId, { ...range, team_id, assignee_id });
```

Implement:
- workspace fetch for timezone
- URL-backed controls: `Today`, `Previous period`, `Next period`, `Month view`, `Week view`, `Day view`
- filter selects for Team and Assignee from existing APIs
- unobtrusive timezone label, e.g. `Timezone: Asia/Jakarta`
- accessible task buttons with visible text for title and status/priority context
- deadline-only visual label such as `Deadline`
- loading, range-loading, empty range, no-results-after-filter, permission failure, invalid range, generic API failure
- Month: simple grid grouped by workspace-local day
- Week: 7-column or stacked readable layout
- Day/mobile: agenda-style list
- create buttons deep-link to `/workspaces/${workspaceId}/tasks?create=1&prefill_start_at=...&prefill_due_at=...`
- open task buttons deep-link to `/workspaces/${workspaceId}/tasks?selected_task_id=${task.id}`
- after returning from Tasks, Calendar re-fetches canonical API state because data comes from URL-derived fetches

Modify `apps/web/components/shell.tsx` to add Calendar nav item.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @floz/web exec playwright test apps/web/e2e/flow.spec.ts -g "login, open calendar, navigate ranges, filter, create from context, and open task detail"`

Expected: PASS.

Then run: `pnpm --filter @floz/web test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/workspaces/[workspaceId]/calendar/page.tsx apps/web/components/shell.tsx apps/web/lib/calendar-time.ts apps/web/e2e/flow.spec.ts
git commit -m "feat(web): add workspace calendar"
```

### Task 6: Document unsupported edge case and handoff files

**Files:**
- Modify: `docs/implementation/IMPLEMENTATION_STATUS.md`
- Create: `docs/implementation/CURRENT_HANDOFF.md`
- Create: `docs/implementation/PHASE_5_REPORT.md`
- Modify: `docs/implementation/OPEN_DECISIONS.md`

**Interfaces:**
- Consumes: completed implementation/test results
- Produces: updated recovery and status docs

- [ ] **Step 1: Write the failing test**

Create a short manual verification checklist in the report draft itself:

```md
- [ ] CURRENT_HANDOFF contains only the approved five sections.
- [ ] Phase 5 report mentions unsupported `start_at != null && due_at == null` semantics.
- [ ] IMPLEMENTATION_STATUS no longer claims React Hook warnings remain.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build`

Expected: PASS or FAIL independently; this step exists to confirm documentation has not yet been updated and the checklist is incomplete.

- [ ] **Step 3: Write minimal implementation**

Update docs:
- `IMPLEMENTATION_STATUS.md`: add Phase 5 completion, remove stale hook-warning limitation, update next/blocked/known limitations.
- `CURRENT_HANDOFF.md`: only
  - current phase
  - completed work
  - current blocker
  - next actions
  - phases/features that must not be started
- `PHASE_5_REPORT.md`: summarize backend projection, range semantics `[from, to)`, timezone policy, UI views, create/open integration, responsive/accessibility notes, test results, limitations.
- `OPEN_DECISIONS.md`: add the unsupported start-only task case if still unresolved after implementation.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm lint && pnpm typecheck`

Expected: PASS with docs unchanged by code checks and status text aligned with implementation.

- [ ] **Step 5: Commit**

```bash
git add docs/implementation/IMPLEMENTATION_STATUS.md docs/implementation/CURRENT_HANDOFF.md docs/implementation/PHASE_5_REPORT.md docs/implementation/OPEN_DECISIONS.md
git commit -m "docs: record phase 5 calendar state"
```

### Task 7: Final verification and Phase 5 checkpoint

**Files:**
- Modify: only if verification reveals real failures

**Interfaces:**
- Consumes: all prior tasks
- Produces: validated Phase 5 branch and final git checkpoint

- [ ] **Step 1: Write the failing test**

No new code test. Define the required gate explicitly:

```text
./scripts/test-clean-db.ps1
./scripts/test-e2e.ps1
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

- [ ] **Step 2: Run test to verify it fails**

Run each command once before final fixes if any verification issue remains.

Expected: any real failure becomes the next fix target. If all pass first time, this step is satisfied by observed green output.

- [ ] **Step 3: Write minimal implementation**

Fix only actual failures surfaced by the commands above. Do not weaken tests, skip suites, or broaden scope beyond Phase 5.

- [ ] **Step 4: Run test to verify it passes**

Run, in order:

```bash
powershell -ExecutionPolicy Bypass -File .\scripts\test-clean-db.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\test-e2e.ps1
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: all PASS.

Then inspect git hygiene:

```bash
git status --short
git diff --stat
git diff
```

Ensure no generated artifacts, Playwright output, secrets, local DB state, screenshots, videos, traces, or temp files are staged.

Create the final checkpoint:

```bash
git add <intended files>
git commit -m "feat: implement Floz Calendar"
git status --short
git log --oneline -5
```

Expected: clean status and final commit visible.

- [ ] **Step 5: Commit**

No extra commit beyond `feat: implement Floz Calendar` unless a verification-only fix is required afterward.

## Self-Review

- Spec coverage: tasks cover hook-warning cleanup, backend projection, timezone utility, month/week/day UI, URL state, filters, create/open reuse, responsive/accessibility behavior, docs, and final gates.
- Placeholder scan: removed TBD/TODO language; each task names files, interfaces, tests, and commands.
- Type consistency: `CalendarView`, `CalendarQueryDto`, `CalendarTaskSummary`, and `api.tasks.calendar` names are consistent across tasks.
