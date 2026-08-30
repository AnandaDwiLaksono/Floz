# Phase 6 Recurring Tasks + Worker Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build recurring task creation, PostgreSQL-canonical scheduling, transactional outbox, BullMQ wake-ups, long-running worker processing, and minimal recurring Task UI for Phase 6.

**Architecture:** PostgreSQL is the canonical business and scheduling source of truth. HTTP create/update/stop mutations persist recurrence state, first occurrence, idempotency state, and outbox rows atomically; BullMQ only wakes workers. Workers always re-read PostgreSQL, claim due work with safe locking, generate occurrences through one shared path, and rely on database uniqueness for final deduplication.

**Tech Stack:** NestJS, Drizzle ORM, PostgreSQL, BullMQ, Redis, Vitest, Playwright, Next.js App Router, pnpm workspaces

## Global Constraints

- Do not start Phase 7 scope.
- Fix stale Phase 5 docs before substantial Phase 6 implementation.
- Update `docs/implementation/CURRENT_HANDOFF.md` before expensive/subagent work and keep it current through the phase.
- PostgreSQL is canonical recurrence/business state.
- `recurrence_rules.next_run_at` is canonical scheduling intent.
- BullMQ is wake-up/execution infrastructure only.
- Worker claims due rules from PostgreSQL.
- Database uniqueness is authoritative for occurrence deduplication.
- `UNIQUE(recurrence_rule_id, scheduled_for)` is required.
- API writes recurring work atomically in PostgreSQL.
- Critical asynchronous follow-up uses transactional outbox; no Redis enqueue inside the business transaction.
- Outbox lease handling is short-lived DB coordination only; never hold PostgreSQL transactions open during Redis/BullMQ I/O.
- Outbox status model stays `PENDING`, `DISPATCHED`, `FAILED`; lease ownership uses `claimed_by` / `claimed_until`.
- Expired outbox leases must be atomically reclaimable.
- Same workspace + same `Idempotency-Key` + same logical request payload returns the original result; same key + materially different payload rejects with canonical idempotency conflict behavior.
- Successful recurring-task creation must atomically create the first occurrence and return it as `first_occurrence`.
- After creation, `next_run_at` points to the next eligible occurrence strictly after `first_occurrence`.
- Supported executable grammar in Phase 6: `DAILY`, `WEEKLY`, `MONTHLY` with positive `interval_value`.
- Reserved but unsupported in Phase 6: `CUSTOM`; do not invent its behavior.
- DAILY preserves `start_at` local wall-clock time.
- WEEKLY preserves `start_at` local weekday + wall-clock time; `interval_value` means every N weeks.
- MONTHLY uses canonical `anchor_day` + local wall-clock time.
- Monthly 29/30/31 fallback: if anchor day missing in target month, use that month’s last day; preserve original anchor day; no anchor drift.
- `occurrence_limit` counts all generated occurrences, including `first_occurrence`.
- `scheduled_for == end_at` is valid; `scheduled_for > end_at` generates nothing.
- `end_at` and `occurrence_limit` are mutually exclusive.
- `end_at < first_occurrence.scheduled_for` is invalid.
- `occurrence_limit = 1` or `first_occurrence.scheduled_for == end_at` must set `next_run_at = null` and schedule no future wake-up.
- PATCH is prospective only; never backfill historical occurrences due solely to the edit.
- Generated occurrences remain immutable when rules change.
- Generated Tasks use canonical Task validation; reject generated `due_at < start_at` rather than inventing next-day due semantics.
- Reconciliation catches up missed occurrences in chronological order using the same generation path, with a bounded configurable batch per iteration.
- Local/integration testing uses disposable PostgreSQL + Docker Redis + real BullMQ + real worker processors; never require production Upstash credentials.
- Minimal recurring UI is required by extending existing Task Create UX. Default recurrence timezone to `workspace.timezone`, but keep it editable if the API allows another IANA timezone.
- Final gates: `./scripts/test-clean-db.ps1`, `./scripts/test-e2e.ps1`, dedicated worker/Redis/recurrence integration suite, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

---

## File Structure

### Existing files to modify

- `database/src/schema.ts`
  - Add `recurrence_rules`, `recurrence_occurrences`, `outbox_events`, recurrence/idempotency additions to `tasks` and any idempotency storage table if one already exists.
- `database/drizzle/*.sql`
  - Add one Phase 6 migration for schema changes and indexes.
- `database/src/index.ts`
  - Export new tables/types if needed by API/worker.
- `apps/api/src/app.module.ts`
  - Register new recurrence/outbox providers/controllers.
- `apps/api/src/floz.controller.ts`
  - Add recurrence endpoints or delegate to a focused controller if that matches repo style.
- `apps/api/src/task.service.ts`
  - Reuse canonical Task creation internals or extract shared helpers from here.
- `apps/api/test/api.test.ts`
  - Add PostgreSQL-backed recurrence endpoint coverage.
- `apps/worker/src/main.ts`
  - Replace heartbeat placeholder with real worker bootstrap.
- `apps/worker/test/main.test.ts`
  - Replace placeholder with runtime tests.
- `apps/worker/package.json`
  - Add BullMQ/Redis dependencies and scripts if needed.
- `apps/api/package.json`
  - Add BullMQ/Redis producer-side deps only if the API/outbox dispatcher needs them.
- `apps/web/lib/api-client.ts`
  - Add recurrence API client and types.
- `apps/web/app/workspaces/[workspaceId]/tasks/page.tsx`
  - Extend Task Create form with recurring controls.
- `apps/web/e2e/flow.spec.ts`
  - Add minimal real-stack recurring create flow.
- `docs/implementation/IMPLEMENTATION_STATUS.md`
  - Correct stale Calendar wording, then Phase 6 status updates.
- `docs/implementation/CURRENT_HANDOFF.md`
  - Update before implementation and throughout.
- `docs/implementation/PHASE_5_REPORT.md`
  - Correct stale checklist wording.
- `docs/decisions/OPEN_DECISIONS.md`
  - Record resolved monthly fallback and remaining unresolved edges.

### Likely new files

- `apps/api/src/recurrence.service.ts`
  - HTTP-facing recurrence orchestration and rule CRUD.
- `apps/api/src/recurrence.types.ts`
  - Shared API/service types if `task.service.ts` would otherwise bloat.
- `apps/api/src/recurrence.dto.ts`
  - Request DTOs for create/update/list/stop.
- `apps/api/src/recurrence.scheduler.ts`
  - Shared next-run calculation entry points if helpful.
- `apps/api/src/outbox.service.ts`
  - Transactional outbox row creation/claim/update helpers for API-side writes and maybe dispatcher reuse.
- `packages/domain/src/recurrence.ts`
  - Pure recurrence calculator and anchor helpers shared by API and worker.
- `packages/domain/src/recurrence.test.ts`
  - Pure recurrence semantics tests, especially monthly fallback and PATCH prospective logic.
- `apps/worker/src/queues.ts`
  - Queue names, deterministic jobId helpers, connection factory.
- `apps/worker/src/outbox-dispatcher.ts`
  - Claim/lease/enqueue/mark-dispatched flow.
- `apps/worker/src/recurrence-worker.ts`
  - BullMQ processor that wakes recurrence generation.
- `apps/worker/src/reconciliation.ts`
  - Periodic due-scan and bounded catch-up loop.
- `apps/worker/src/generate-due-occurrence.ts`
  - Canonical worker generation path.
- `apps/worker/test/recurrence.integration.test.ts`
  - Postgres + Redis + BullMQ integration tests.
- `apps/worker/test/outbox.integration.test.ts`
  - Outbox leasing and crash/retry behavior.
- `apps/worker/test/recurrence-runtime.test.ts`
  - Graceful shutdown/runtime bootstrap tests.
- `docs/implementation/PHASE_6_REPORT.md`
  - Phase 6 report.

### Interfaces to preserve or introduce

- `createRecurringTask(...)` returns recurrence rule + `first_occurrence` + persisted `next_run_at`.
- `computeNextOccurrence(input)` returns `{ scheduledFor: Date | null, anchorDay?: number }` using recurrence timezone and approved anchors.
- `generateDueOccurrence(input)` creates at most one new occurrence per call, idempotently.
- `claimOutboxBatch(...)` returns leased outbox rows only.
- `enqueueWakeup(job)` uses deterministic `jobId` but never substitutes for DB deduplication.

## Task 1: Pre-phase housekeeping and handoff baseline

**Files:**
- Modify: `docs/implementation/IMPLEMENTATION_STATUS.md`
- Modify: `docs/implementation/PHASE_5_REPORT.md`
- Modify: `docs/implementation/CURRENT_HANDOFF.md`

**Interfaces:**
- Consumes: approved Phase 6 design in `docs/superpowers/specs/2026-08-27-phase-6-recurring-tasks-worker-design.md`
- Produces: corrected docs and a current handoff baseline for all later tasks

- [ ] **Step 1: Read the current docs before editing**

Read:
- `docs/implementation/IMPLEMENTATION_STATUS.md`
- `docs/implementation/PHASE_5_REPORT.md`
- `docs/implementation/CURRENT_HANDOFF.md`

Expected findings:
- Calendar still listed in known limitations/status in stale form.
- Phase 5 report checklist wording needs to match the already-cleared React Hook warning state.
- Current handoff still says Phase 6 must not start.

- [ ] **Step 2: Update `IMPLEMENTATION_STATUS.md`**

Make these exact intent changes:

```md
Known Limitations
- Queue, recurrence, notifications, approvals, comments, attachments, audit, KPI, and remaining product UI are out of scope.
+ Recurrence, worker activation, queue/outbox, notifications, approvals, comments, attachments, audit, KPI, and remaining product UI beyond Phase 6 are out of scope.
```

Also update `Next` from Phase 6 planning to Phase 6 implementation in progress once implementation starts.

- [ ] **Step 3: Update `PHASE_5_REPORT.md`**

Keep the checklist consistent with cleared warning state:

```md
- [x] IMPLEMENTATION_STATUS no longer claims React Hook warnings remain.
```

Do not reintroduce wording that implies the warning still blocks the build.

- [ ] **Step 4: Update `CURRENT_HANDOFF.md` to Phase 6 baseline**

Use the required five sections and record:

```md
## Current phase
Phase 6 Recurring Tasks + Worker Foundation planning approved; implementation starting.

## Completed work
- Phase 5 Calendar integrated into `master`.
- Phase 6 design approved in `docs/superpowers/specs/2026-08-27-phase-6-recurring-tasks-worker-design.md`.

## Current blocker
None.

## Next actions
- Implement schema, recurrence API, transactional outbox, BullMQ worker, reconciliation, and minimal recurring Task UI.
- Stop after Phase 6.

## Phases/features that must not be started
- Phase 7 and later.
- Notifications, reminders, email delivery, approvals, comments, attachments, KPI, non-task Calendar events.
```

- [ ] **Step 5: Verify doc-only diff**

Run: `git diff -- docs/implementation/IMPLEMENTATION_STATUS.md docs/implementation/PHASE_5_REPORT.md docs/implementation/CURRENT_HANDOFF.md`
Expected: only the intended wording changes above.

## Task 2: Map current task/idempotency/test patterns and decide minimal dependency additions

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/worker/package.json`
- Modify: `package.json` only if root scripts need explicit worker integration target
- Test: `pnpm install` / lockfile changes if dependencies added

**Interfaces:**
- Consumes: existing package manifests and current repo scripts
- Produces: BullMQ/Redis dependencies and any new script names later tasks will use

- [ ] **Step 1: Search current repo for idempotency implementation**

Run: `rg -n "Idempotency-Key|idempotency|fingerprint" apps packages database docs`
Expected: either an existing pattern to reuse or confirmation that Phase 6 must introduce the minimal canonical mechanism.

- [ ] **Step 2: Search current repo for Docker/dev orchestration**

Run: `rg -n "redis|docker|compose|test-clean-db|test-e2e" infra scripts README.md apps`
Expected: identify where local Redis/startup scripts should be extended without inventing a new dev flow.

- [ ] **Step 3: Add the smallest needed dependencies**

If missing, add only:

```json
{
  "dependencies": {
    "bullmq": "^5",
    "ioredis": "^5"
  }
}
```

Apply to:
- `apps/worker/package.json`
- `apps/api/package.json` only if API-side code directly needs BullMQ/Redis types; otherwise keep queue dependencies worker-only.

- [ ] **Step 4: Add a dedicated worker integration test script**

In `apps/worker/package.json`, add:

```json
{
  "scripts": {
    "test:integration": "vitest run test/*.integration.test.ts"
  }
}
```

Only add a root alias if it avoids repetition in the final gate.

- [ ] **Step 5: Install and verify manifests**

Run: `pnpm install`
Expected: lockfile updates only for the chosen deps; no unrelated package drift.

## Task 3: Add recurrence, occurrence, outbox, and idempotency schema

**Files:**
- Modify: `database/src/schema.ts`
- Create: `database/drizzle/0004_phase6_recurrence_worker.sql` (or next sequence number actually generated)
- Modify: `database/src/index.ts`
- Test: schema migration applies on clean DB

**Interfaces:**
- Consumes: current task/workspace/user/team schema
- Produces:
  - `recurrenceRules`
  - `recurrenceOccurrences`
  - `outboxEvents`
  - `tasks.recurrenceRuleId`
  - idempotency persistence table or columns, depending on existing pattern

- [ ] **Step 1: Write schema-level failing tests or migration assertions**

Add migration/apply verification in an integration test or script assertion that checks these tables and constraints exist:

```sql
SELECT to_regclass('public.recurrence_rules');
SELECT to_regclass('public.recurrence_occurrences');
SELECT to_regclass('public.outbox_events');
```

And uniqueness:

```sql
INSERT INTO recurrence_occurrences (...) VALUES (...);
INSERT INTO recurrence_occurrences (...) VALUES (...);
-- expect unique violation on recurrence_rule_id + scheduled_for
```

- [ ] **Step 2: Add tables to `database/src/schema.ts`**

Use focused definitions like:

```ts
export const recurrenceRules = pgTable('recurrence_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  name: varchar('name', { length: 255 }).notNull(),
  frequency: varchar('frequency', { length: 16 }).notNull(),
  intervalValue: integer('interval_value').notNull(),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }),
  occurrenceLimit: integer('occurrence_limit'),
  timezone: varchar('timezone', { length: 64 }).notNull(),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  isActive: boolean('is_active').notNull().default(true),
  anchorDay: integer('anchor_day'),
  generatedCount: integer('generated_count').notNull().default(0),
  ruleConfig: jsonb('rule_config').notNull().default(sql`'{}'::jsonb`),
  templateSnapshot: jsonb('template_snapshot').notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: now(),
  updatedAt: updated()
});
```

```ts
export const recurrenceOccurrences = pgTable('recurrence_occurrences', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  recurrenceRuleId: uuid('recurrence_rule_id').notNull().references(() => recurrenceRules.id),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
  taskId: uuid('task_id').notNull().references(() => tasks.id),
  createdAt: now()
}, (table) => ({
  uniqueOccurrence: unique().on(table.recurrenceRuleId, table.scheduledFor),
  taskUnique: unique().on(table.taskId)
}));
```

```ts
export const outboxEvents = pgTable('outbox_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id),
  aggregateType: varchar('aggregate_type', { length: 64 }).notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  eventType: varchar('event_type', { length: 64 }).notNull(),
  payload: jsonb('payload').notNull(),
  status: varchar('status', { length: 16 }).notNull().default('PENDING'),
  attemptCount: integer('attempt_count').notNull().default(0),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  claimedBy: varchar('claimed_by', { length: 128 }),
  claimedUntil: timestamp('claimed_until', { withTimezone: true }),
  createdAt: now(),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true })
});
```

And extend `tasks` minimally:

```ts
recurrenceRuleId: uuid('recurrence_rule_id').references(() => recurrenceRules.id)
```

For idempotency, reuse existing pattern if found; otherwise add a focused workspace-scoped create-mutation table with key, fingerprint, response reference IDs, and timestamps.

- [ ] **Step 3: Write the SQL migration**

Ensure migration contains:

```sql
ALTER TABLE tasks ADD COLUMN recurrence_rule_id uuid REFERENCES recurrence_rules(id);
CREATE UNIQUE INDEX recurrence_occurrences_rule_scheduled_idx ON recurrence_occurrences(recurrence_rule_id, scheduled_for);
CREATE INDEX recurrence_rules_workspace_next_run_idx ON recurrence_rules(workspace_id, next_run_at) WHERE is_active = true;
CREATE INDEX outbox_events_status_available_idx ON outbox_events(status, available_at);
```

Also add CHECK constraints for:
- positive `interval_value`
- positive `occurrence_limit` if non-null
- mutual exclusion of `end_at` and `occurrence_limit`
- valid `anchor_day` range if non-null

- [ ] **Step 4: Export new schema symbols**

Update `database/src/index.ts` so API and worker can import the new tables and types from one place.

- [ ] **Step 5: Apply migration on clean DB**

Run: `pnpm --filter @floz/database migrate`
Expected: migration succeeds on a clean database.

## Task 4: Build pure recurrence calculation helpers in `packages/domain`

**Files:**
- Create: `packages/domain/src/recurrence.ts`
- Create: `packages/domain/src/recurrence.test.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/package.json` if test/build exports need updates

**Interfaces:**
- Consumes: plain recurrence rule inputs only
- Produces:
  - `type ExecutableFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY'`
  - `resolveFirstOccurrence(input): Date`
  - `resolveNextOccurrence(input): Date | null`
  - `resolveNextOccurrenceAfterUpdate(input): Date | null`
  - `validateExecutableRecurrence(input): void`

- [ ] **Step 1: Write failing pure tests for supported grammar**

Use exact cases like:

```ts
test('monthly 31 falls back to feb 28 and returns to mar 31', () => {
  expect(sequence('2027-01-31T09:00:00', 'Asia/Jakarta', 'MONTHLY', 1, 3)).toEqual([
    '2027-01-31T02:00:00.000Z',
    '2027-02-28T02:00:00.000Z',
    '2027-03-31T02:00:00.000Z'
  ]);
});

test('occurrence_limit counts first occurrence', () => {
  const { first, nextRunAt } = createBoundary('DAILY', 1, { occurrenceLimit: 1 });
  expect(first).not.toBeNull();
  expect(nextRunAt).toBeNull();
});

test('patch is prospective and does not backfill', () => {
  const next = resolveNextOccurrenceAfterUpdate({
    effectiveChangeTime: new Date('2027-03-10T10:00:00Z'),
    latestGeneratedScheduledFor: new Date('2027-03-01T09:00:00Z'),
    frequency: 'WEEKLY',
    intervalValue: 1,
    timezone: 'Asia/Jakarta',
    startAt: new Date('2027-01-06T02:00:00Z')
  });
  expect(next?.toISOString()).toBe('2027-03-17T02:00:00.000Z');
});
```

- [ ] **Step 2: Implement the smallest pure calculator surface**

Create signatures like:

```ts
export interface RecurrenceScheduleInput {
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';
  intervalValue: number;
  timezone: string;
  startAt: Date;
  endAt?: Date | null;
  occurrenceLimit?: number | null;
  generatedCount?: number;
  anchorDay?: number | null;
}
```

Implement helpers that:
- reject unsupported `CUSTOM`
- preserve approved anchors
- enforce end conditions
- keep anchor-day source canonical
- never drift after fallback months

- [ ] **Step 3: Add due-time validation helper**

Add a small pure helper:

```ts
export function validateGeneratedSchedule(startAt: Date | null, dueAt: Date | null): void {
  if (startAt && dueAt && dueAt < startAt) throw new Error('VALIDATION_ERROR');
}
```

- [ ] **Step 4: Export helpers**

Update `packages/domain/src/index.ts`:

```ts
export * from './recurrence';
```

- [ ] **Step 5: Run pure tests**

Run: `pnpm --filter @floz/domain test`
Expected: monthly fallback, update semantics, boundary cases pass.

## Task 5: Extract canonical task creation primitives from API service

**Files:**
- Modify: `apps/api/src/task.service.ts`
- Create: `apps/api/src/task-core.ts` if extraction keeps `task.service.ts` smaller
- Test: `apps/api/test/api.test.ts` existing task tests still pass

**Interfaces:**
- Consumes: existing `CreateTaskDto` path in `task.service.ts`
- Produces:
  - `validateTaskTemplateReferences(...)`
  - `createTaskRecordTx(...)`
  - `createTaskAssigneesTx(...)`
  - `writeTaskHistoryTx(...)`

- [ ] **Step 1: Identify exact reusable logic inside `task.service.ts:create()`**

Read `apps/api/src/task.service.ts` around `create()` and note logic for:
- workflow/status validation
- team validation
- assignee validation
- primary assignee enforcement
- task key generation
- history row creation

- [ ] **Step 2: Write or adjust a focused API test proving behavior is preserved**

Add or keep a test like:

```ts
it('creates a normal task with expected task key, assignees, and history', async () => {
  const response = await request(app.getHttpServer())
    .post(`/api/v1/workspaces/${workspaceId}/tasks`)
    .send({...});

  expect(response.status).toBe(201);
  expect(response.body.data.task_key).toMatch(/^OPS-/);
});
```

- [ ] **Step 3: Extract minimal transactional helpers**

Introduce helpers with exact intent:

```ts
export async function createTaskRecordTx(tx, input): Promise<{ taskId: string; taskKey: string; statusId: string }> {}
export async function createTaskAssigneesTx(tx, input): Promise<void> {}
export async function writeTaskHistoryTx(tx, input): Promise<void> {}
```

Keep them boring. No new abstraction layer beyond what recurrence generation needs.

- [ ] **Step 4: Make `task.service.ts:create()` use the helpers**

Refactor only enough so recurrence code can call the same primitives inside its own transaction.

- [ ] **Step 5: Run API task tests**

Run: `pnpm --filter @floz/api test -- --runInBand`
Expected: existing task tests still pass after extraction.

## Task 6: Add recurrence DTOs, types, and API surface

**Files:**
- Create: `apps/api/src/recurrence.dto.ts`
- Create: `apps/api/src/recurrence.types.ts`
- Modify: `apps/api/src/floz.controller.ts` or create `apps/api/src/recurrence.controller.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: DTO validation through API tests

**Interfaces:**
- Consumes: recurrence domain helpers from `@floz/domain`
- Produces:
  - `CreateRecurringTaskDto`
  - `UpdateRecurrenceRuleDto`
  - `RecurrenceRuleQueryDto`
  - route handlers for create/list/get/update/stop

- [ ] **Step 1: Write failing API tests for endpoint presence and validation**

Add cases like:

```ts
it('rejects CUSTOM recurrence creation as unsupported in phase 6', async () => {
  const response = await request(server)
    .post(`/api/v1/workspaces/${workspaceId}/recurring-tasks`)
    .set('Idempotency-Key', 'rec-1')
    .send({ frequency: 'CUSTOM', interval_value: 1, ...baseBody });

  expect(response.status).toBe(400);
});

it('lists recurrence rules with active/team_id/assignee_id filters', async () => {
  const response = await request(server)
    .get(`/api/v1/workspaces/${workspaceId}/recurrence-rules?active=true&team_id=${teamId}&assignee_id=${userId}`);

  expect(response.status).toBe(200);
});
```

- [ ] **Step 2: Define DTOs with explicit supported fields**

Create DTOs matching Phase 6 UI/API only:

```ts
export class CreateRecurringTaskDto {
  name!: string;
  frequency!: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';
  interval_value!: number;
  timezone!: string;
  start_at!: string;
  end_at?: string;
  occurrence_limit?: number;
  title!: string;
  description?: string;
  workflow_id!: string;
  priority?: string;
  team_id?: string;
  assignee_ids?: string[];
  primary_assignee_id?: string;
  due_time?: string;
}
```

And query DTO:

```ts
export class RecurrenceRuleQueryDto {
  active?: string;
  team_id?: string;
  assignee_id?: string;
  cursor?: string;
  limit?: number;
}
```

- [ ] **Step 3: Add route handlers**

Expose exactly:

```ts
@Post('workspaces/:workspaceId/recurring-tasks')
@Get('workspaces/:workspaceId/recurrence-rules')
@Get('workspaces/:workspaceId/recurrence-rules/:id')
@Patch('workspaces/:workspaceId/recurrence-rules/:id')
@Post('workspaces/:workspaceId/recurrence-rules/:id/stop')
```

- [ ] **Step 4: Register providers/controllers**

Update `app.module.ts` to include the recurrence service/controller.

- [ ] **Step 5: Run focused API validation tests**

Run: `pnpm --filter @floz/api test -- test/api.test.ts -t recurrence`
Expected: routes exist; unsupported grammar and bad boundaries fail correctly.

## Task 7: Implement recurring create, idempotent POST replay, and rule CRUD in API

**Files:**
- Create: `apps/api/src/recurrence.service.ts`
- Modify: `apps/api/src/task.service.ts` or `apps/api/src/task-core.ts`
- Modify: `apps/api/test/api.test.ts`
- Possibly create: `apps/api/src/idempotency.service.ts` only if existing repo has no reusable location

**Interfaces:**
- Consumes:
  - recurrence domain helpers
  - task transactional helpers
  - DB schema tables
- Produces:
  - `createRecurringTask(...)`
  - `listRecurrenceRules(...)`
  - `getRecurrenceRule(...)`
  - `updateRecurrenceRule(...)`
  - `stopRecurrenceRule(...)`

- [ ] **Step 1: Write failing API tests for create success and replay**

Add cases like:

```ts
it('creates recurrence, first_occurrence, and next_run_at in one transaction', async () => {
  const response = await request(server)
    .post(`/api/v1/workspaces/${workspaceId}/recurring-tasks`)
    .set('Idempotency-Key', 'create-rec-1')
    .send(validBody);

  expect(response.status).toBe(201);
  expect(response.body.data.first_occurrence).toBeTruthy();
  expect(response.body.data.next_run_at).not.toEqual(response.body.data.first_occurrence.scheduled_for);
});

it('replays identical Idempotency-Key request without duplicating recurrence rule', async () => {
  await request(server).post(url).set('Idempotency-Key', 'same-key').send(validBody);
  const replay = await request(server).post(url).set('Idempotency-Key', 'same-key').send(validBody);
  expect(replay.status).toBe(201);
  expect(await countRows('recurrence_rules')).toBe(1);
});

it('rejects reused Idempotency-Key with different payload', async () => {
  await request(server).post(url).set('Idempotency-Key', 'same-key').send(validBody);
  const conflict = await request(server).post(url).set('Idempotency-Key', 'same-key').send({ ...validBody, title: 'changed' });
  expect(conflict.status).toBeGreaterThanOrEqual(400);
});
```

- [ ] **Step 2: Implement recurring create transaction**

Inside one DB transaction:

```ts
const idempotency = await getOrCreateIdempotencyTx(tx, workspaceId, key, fingerprint);
if (idempotency.existingMatch) return idempotency.recoverResult();
if (idempotency.conflict) throw new BadRequestException('IDEMPOTENCY_KEY_REUSED');

const firstOccurrence = resolveFirstOccurrence(...);
validateFirstBoundary(...);
const task = await createTaskRecordTx(tx, taskInputFromTemplate(...));
await createTaskAssigneesTx(tx, ...);
await writeTaskHistoryTx(tx, { eventType: 'RECURRING_GENERATED', ... });
const rule = await insert recurrence_rules(... nextRunAtAfterFirst ... generatedCount = 1 ...);
await insert recurrence_occurrences(... taskId, scheduledFor: firstOccurrence ...);
await insert outbox_events(... next wake-up if nextRunAtAfterFirst non-null ...);
await finalizeIdempotencyTx(tx, { recurrenceRuleId: rule.id, firstOccurrenceTaskId: task.id, responsePayloadRef... });
```

Implementation rule: if `occurrence_limit = 1` or `first_occurrence == end_at`, set `next_run_at = null` and write no wake-up outbox row.

- [ ] **Step 3: Implement list/get/update/stop**

Behavior:
- list supports `active`, `team_id`, `assignee_id`, pagination
- get enforces workspace scope
- patch validates supported grammar only, recomputes `next_run_at` prospectively after `max(update_time, latest_generated_scheduled_for)`
- stop sets `is_active = false`, `next_run_at = null`

- [ ] **Step 4: Re-read canonical DB state on updates and enforce boundary semantics**

Cover exact cases:
- `end_at < first_occurrence` invalid on create
- update to no future valid occurrence => `next_run_at = null`
- existing generated occurrences untouched
- no historical backfill due to edit

- [ ] **Step 5: Run focused recurrence API tests**

Run: `pnpm --filter @floz/api test -- test/api.test.ts -t "recurrence|idempotency"`
Expected: POST replay, POST conflict, create boundary cases, PATCH prospective behavior pass.

## Task 8: Add transactional outbox helpers and API-side outbox writes

**Files:**
- Create: `apps/api/src/outbox.service.ts`
- Modify: `apps/api/src/recurrence.service.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: outbox row persistence tests in API and worker integration

**Interfaces:**
- Consumes: DB transaction from recurrence service
- Produces:
  - `enqueueWakeupIntentTx(tx, input): Promise<void>`
  - `claimOutboxBatch(...)`
  - `markOutboxDispatched(...)`
  - `markOutboxRetry(...)`

- [ ] **Step 1: Write failing tests that prove DB commit survives before Redis delivery**

Add a test pattern like:

```ts
it('persists outbox event even when redis delivery is not attempted yet', async () => {
  await createRecurringTaskThroughApi();
  const row = await db.select().from(outboxEvents).limit(1);
  expect(row[0].status).toBe('PENDING');
});
```

- [ ] **Step 2: Implement minimal transactional insert helper**

```ts
export async function enqueueWakeupIntentTx(tx, input: {
  workspaceId: string;
  aggregateType: 'recurrence_rule';
  aggregateId: string;
  eventType: 'RECURRENCE_WAKEUP';
  payload: Record<string, unknown>;
}): Promise<void> {
  await tx.insert(outboxEvents).values({
    workspaceId: input.workspaceId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    eventType: input.eventType,
    payload: input.payload,
    status: 'PENDING'
  });
}
```

- [ ] **Step 3: Add short-lease claim/update helpers**

```ts
export async function claimOutboxBatch(db, input): Promise<OutboxEvent[]> {}
export async function markOutboxDispatched(db, input): Promise<boolean> {}
export async function markOutboxRetry(db, input): Promise<boolean> {}
```

Each update must verify `claimed_by` and `claimed_until`/ownership so stale dispatchers cannot overwrite newer state.

- [ ] **Step 4: Use outbox helper from recurring create/update generation**

Ensure outbox rows are inserted only when `next_run_at` exists.

- [ ] **Step 5: Run focused outbox persistence test**

Run: `pnpm --filter @floz/api test -- test/api.test.ts -t outbox`
Expected: rows persist in DB transaction, no Redis dependency needed.

## Task 9: Build worker queue wiring and deterministic job IDs

**Files:**
- Create: `apps/worker/src/queues.ts`
- Modify: `apps/worker/src/main.ts`
- Create: `apps/worker/src/config.ts` if env parsing needs separation
- Test: `apps/worker/test/recurrence-runtime.test.ts`

**Interfaces:**
- Consumes: Redis env, observability logger
- Produces:
  - `createRedisConnection()`
  - `createQueueNames()` constants
  - `buildWakeupJobId(outboxEventId | recurrenceRuleId + scheduledFor)`

- [ ] **Step 1: Write failing runtime/bootstrap test**

```ts
test('worker boots queues and shuts down cleanly', async () => {
  const runtime = await startWorkerForTest();
  await runtime.stop();
  expect(runtime.stopped).toBe(true);
});
```

- [ ] **Step 2: Implement queue constants and jobId helpers**

```ts
export const QUEUES = {
  recurrenceWakeup: 'recurrence-wakeup'
} as const;

export function buildWakeupJobId(input: { recurrenceRuleId: string; scheduledFor: string }): string {
  return `recurrence:${input.recurrenceRuleId}:${input.scheduledFor}`;
}
```

- [ ] **Step 3: Replace heartbeat `main.ts` with real bootstrap**

Bootstrap should:
- parse Redis env
- connect BullMQ
- start dispatcher loop
- start wake-up worker
- start reconciliation loop
- register `SIGINT`/`SIGTERM`

- [ ] **Step 4: Add bounded concurrency and graceful shutdown**

Keep it simple:

```ts
const concurrency = Number(process.env.WORKER_CONCURRENCY ?? '5');
```

On shutdown:
- stop accepting new jobs
- await current tasks with timeout
- close BullMQ and Redis connections

- [ ] **Step 5: Run worker runtime test**

Run: `pnpm --filter @floz/worker test -- test/recurrence-runtime.test.ts`
Expected: startup and shutdown pass without hanging.

## Task 10: Implement outbox dispatcher with lease-safe multi-dispatcher behavior

**Files:**
- Create: `apps/worker/src/outbox-dispatcher.ts`
- Create: `apps/worker/test/outbox.integration.test.ts`
- Modify: `apps/worker/src/main.ts`

**Interfaces:**
- Consumes: `claimOutboxBatch`, `markOutboxDispatched`, `markOutboxRetry`, BullMQ queue, deterministic `jobId`
- Produces:
  - `dispatchOutboxBatch(): Promise<number>`
  - background loop registration in worker runtime

- [ ] **Step 1: Write failing integration tests for lease/retry behavior**

Cover:

```ts
it('marks DISPATCHED only after successful enqueue', async () => {});
it('retries FAILED/PENDING rows after redis enqueue error', async () => {});
it('atomically reclaims expired lease', async () => {});
it('stale dispatcher cannot overwrite newer dispatcher state', async () => {});
it('crash-after-enqueue redispatch is harmless with deterministic jobId', async () => {});
```

- [ ] **Step 2: Implement claim flow with short DB transaction**

Pseudo-shape:

```ts
const rows = await claimOutboxBatch(db, {
  dispatcherId,
  now,
  leaseMs: 30000,
  limit: 50
});
for (const row of rows) {
  try {
    await queue.add('wake', row.payload, { jobId: buildWakeupJobId(...) });
    await markOutboxDispatched(db, { id: row.id, dispatcherId, now: new Date() });
  } catch (error) {
    await markOutboxRetry(db, { id: row.id, dispatcherId, availableAt: backoffDate, error });
  }
}
```

- [ ] **Step 3: Verify updates are ownership-checked**

`markOutboxDispatched` and `markOutboxRetry` must update zero rows if ownership no longer matches.

- [ ] **Step 4: Hook dispatcher loop into worker runtime**

Use a short interval loop or self-rescheduling async loop; keep it configurable.

- [ ] **Step 5: Run outbox integration suite**

Run: `pnpm --filter @floz/worker test -- test/outbox.integration.test.ts`
Expected: multi-dispatcher safety, retry, reclaim, and crash-window semantics pass.

## Task 11: Implement canonical `generateDueOccurrence()` path

**Files:**
- Create: `apps/worker/src/generate-due-occurrence.ts`
- Create: `apps/worker/src/recurrence-worker.ts`
- Modify: `apps/api/src/recurrence.service.ts` only if shared logic belongs in a shared package instead
- Test: `apps/worker/test/recurrence.integration.test.ts`

**Interfaces:**
- Consumes:
  - recurrence tables
  - task transactional helpers or a shared task-core package
  - recurrence domain helpers
  - outbox insert helper
- Produces:
  - `generateDueOccurrence(input: { recurrenceRuleId: string; now: Date }): Promise<'generated' | 'noop'>`

- [ ] **Step 1: Write failing integration tests for one-due-occurrence behavior**

Cover:

```ts
it('generates exactly one occurrence for a due rule', async () => {});
it('does not generate early for future next_run_at', async () => {});
it('stopped rule generates nothing', async () => {});
it('repeated execution does not duplicate occurrence', async () => {});
it('retry does not duplicate occurrence', async () => {});
```

- [ ] **Step 2: Implement due-rule claim + DB re-read**

Inside transaction:

```ts
const rule = await claimRecurrenceRuleTx(tx, recurrenceRuleId, now);
if (!rule || !rule.isActive || !rule.nextRunAt || rule.nextRunAt > now) return 'noop';
```

Use `FOR UPDATE` / `SKIP LOCKED`-style semantics via SQL where needed.

- [ ] **Step 3: Implement occurrence identity and canonical Task creation**

Flow:
- resolve `scheduled_for` from current DB rule
- insert into `recurrence_occurrences` first or atomically with task creation depending on transaction shape
- if unique violation indicates already generated, return `'noop'`
- otherwise create Task, assignees, history with event type like `RECURRING_GENERATED`
- set `tasks.recurrence_rule_id`

- [ ] **Step 4: Advance `next_run_at` and write future wake-up outbox**

Use pure calculator with:
- generated count incremented
- end-condition checks
- `next_run_at = null` when complete
- outbox row only when non-null

- [ ] **Step 5: Run focused generation integration tests**

Run: `pnpm --filter @floz/worker test -- test/recurrence.integration.test.ts -t "due rule|repeated execution|retry"`
Expected: one task per occurrence, no duplicates.

## Task 12: Add concurrency, stale wake-up, and chronological catch-up behavior

**Files:**
- Modify: `apps/worker/src/generate-due-occurrence.ts`
- Create: `apps/worker/src/reconciliation.ts`
- Modify: `apps/worker/src/recurrence-worker.ts`
- Modify: `apps/worker/test/recurrence.integration.test.ts`

**Interfaces:**
- Consumes: canonical generation path
- Produces:
  - `runReconciliationIteration(now): Promise<number>`
  - stale BullMQ wake-up no-op behavior

- [ ] **Step 1: Write failing tests for concurrency and stale wake-ups**

Add exact cases:

```ts
it('concurrent worker attempts do not duplicate occurrence', async () => {});
it('stale wake-up no-ops after rule stop', async () => {});
it('stale wake-up no-ops when next_run_at moved to future', async () => {});
it('reconciliation catches up missed occurrences in chronological order using bounded batch', async () => {});
```

- [ ] **Step 2: Implement stale wake-up behavior in `recurrence-worker.ts`**

Worker processor should only trust payload enough to find a rule, then call:

```ts
await generateDueOccurrence({ recurrenceRuleId, now: clock.now() });
```

No direct generation from queue payload timestamps.

- [ ] **Step 3: Implement reconciliation iteration**

Pseudo-shape:

```ts
export async function runReconciliationIteration({ now, batchSize }: { now: Date; batchSize: number }) {
  const dueRules = await selectActiveDueRules(now, batchSize);
  for (const rule of dueRules) {
    await generateDueOccurrence({ recurrenceRuleId: rule.id, now });
  }
}
```

If a rule remains due after one generated occurrence, leave it recoverable for the next iteration instead of doing an unbounded loop.

- [ ] **Step 4: Enforce chronological catch-up**

Ensure each pass generates the current canonical `next_run_at`, commits, then a later pass handles the next missed one.

- [ ] **Step 5: Run concurrency/catch-up tests**

Run: `pnpm --filter @floz/worker test -- test/recurrence.integration.test.ts -t "concurrent|stale|reconciliation"`
Expected: no duplicates, no stale misfires, bounded catch-up passes.

## Task 13: Finish recurrence API list/get/update/stop coverage and query filters

**Files:**
- Modify: `apps/api/src/recurrence.service.ts`
- Modify: `apps/api/test/api.test.ts`

**Interfaces:**
- Consumes: recurrence tables and canonical validation helpers
- Produces: complete API behavior for list/get/update/stop

- [ ] **Step 1: Write failing API tests for list filters and pagination**

```ts
it('filters recurrence rules by active flag, team_id, and assignee_id', async () => {});
it('paginates recurrence rules with standard collection contract', async () => {});
it('rejects cross-workspace team_id and assignee_id filters', async () => {});
```

- [ ] **Step 2: Write failing PATCH/stop boundary tests**

```ts
it('patch recomputes next_run_at prospectively without rewriting existing occurrences', async () => {});
it('patch to no future valid occurrence sets next_run_at null', async () => {});
it('stop preserves existing tasks and clears next_run_at', async () => {});
```

- [ ] **Step 3: Implement filtering and pagination**

Re-use list-query conventions from existing task list endpoints for cursor + limit semantics.

- [ ] **Step 4: Implement prospective PATCH recomputation**

Use exact rule:

```ts
const floor = maxDate(updatedAt, latestGeneratedScheduledFor);
const nextRunAt = resolveNextOccurrenceAfterUpdate({ floor, ...newRuleState });
```

No backfill between old schedule and update time.

- [ ] **Step 5: Run recurrence endpoint suite**

Run: `pnpm --filter @floz/api test -- test/api.test.ts -t "recurrence rules|stop|patch|pagination"`
Expected: list/get/update/stop behavior passes.

## Task 14: Extend web API client and Task Create UI for recurring creation

**Files:**
- Modify: `apps/web/lib/api-client.ts`
- Modify: `apps/web/app/workspaces/[workspaceId]/tasks/page.tsx`
- Possibly create: `apps/web/app/workspaces/[workspaceId]/tasks/recurrence-form.tsx` only if page file becomes unwieldy
- Test: web unit tests if present; otherwise rely on Playwright + typecheck

**Interfaces:**
- Consumes: recurrence POST API contract
- Produces:
  - `api.tasks.createRecurring(...)`
  - minimal recurring controls in Task Create modal

- [ ] **Step 1: Write failing E2E expectation for recurring create flow**

Add to Playwright scenario:

```ts
await page.getByRole('checkbox', { name: /enable recurring/i }).check();
await page.getByLabel(/frequency/i).selectOption('MONTHLY');
await page.getByLabel(/interval/i).fill('1');
await page.getByLabel(/timezone/i).selectOption('Asia/Jakarta');
await page.getByRole('button', { name: /save/i }).click();
await expect(page.getByText(/recurring/i)).toBeVisible();
```

- [ ] **Step 2: Add recurrence client types and POST method**

In `api-client.ts` add types like:

```ts
export interface CreateRecurringTaskRequest { /* mirror DTO */ }
export interface RecurringTaskResponse { id: string; next_run_at: string | null; first_occurrence: Task; }
```

And method:

```ts
createRecurring(workspaceId: string, input: CreateRecurringTaskRequest, idempotencyKey: string): Promise<RecurringTaskResponse>
```

Send `Idempotency-Key` header.

- [ ] **Step 3: Extend Task Create UX minimally**

Add fields:
- Enable Recurring checkbox
- DAILY/WEEKLY/MONTHLY select
- interval
- timezone defaulted from workspace timezone state
- start
- optional end date OR occurrence count

Keep existing task fields and submission path.

- [ ] **Step 4: Submit to recurring API when enabled**

Pseudo-shape:

```ts
if (isRecurring) {
  await api.tasks.createRecurring(workspaceId, payload, crypto.randomUUID());
} else {
  await api.tasks.create(workspaceId, payload);
}
```

Reuse existing success refresh path so first occurrence appears in the Task list immediately.

- [ ] **Step 5: Typecheck web app**

Run: `pnpm --filter @floz/web typecheck`
Expected: UI changes compile without introducing new lint/type errors.

## Task 15: Add real-stack E2E for recurring create and first occurrence visibility

**Files:**
- Modify: `apps/web/e2e/flow.spec.ts`
- Possibly modify: test seed/helpers if E2E setup needs deterministic users/workspace timezone

**Interfaces:**
- Consumes: running API + web + DB + worker stack in existing E2E harness
- Produces: one minimal browser proof of recurring create flow

- [ ] **Step 1: Write Playwright flow for recurring create**

Add exact high-level scenario:

```ts
test('create recurring task from task form and see first occurrence', async ({ page }) => {
  await login(page);
  await openCreateTask(page);
  await fillBaseTaskFields(page, 'Recurring inspection');
  await page.getByRole('checkbox', { name: /enable recurring/i }).check();
  await page.getByLabel(/frequency/i).selectOption('WEEKLY');
  await page.getByLabel(/interval/i).fill('1');
  await page.getByRole('button', { name: /create task/i }).click();
  await expect(page.getByText('Recurring inspection')).toBeVisible();
});
```

- [ ] **Step 2: Keep the test minimal**

Do not wait for future scheduled generation in real time. Only verify persisted rule path indirectly through first occurrence visibility plus any recurrence chip/label the UI exposes.

- [ ] **Step 3: Ensure timezone default is visible/editable**

Assert the recurrence timezone defaults to workspace timezone value.

- [ ] **Step 4: Run only the new E2E**

Run: `pnpm --filter @floz/web exec playwright test apps/web/e2e/flow.spec.ts --grep "recurring"`
Expected: new flow passes.

- [ ] **Step 5: Re-run existing E2E flow file**

Run: `./scripts/test-e2e.ps1`
Expected: old task/kanban/calendar coverage still passes with the new form controls.

## Task 16: Keep CURRENT_HANDOFF live during implementation and record resolved decisions

**Files:**
- Modify: `docs/implementation/CURRENT_HANDOFF.md`
- Modify: `docs/decisions/OPEN_DECISIONS.md`
- Modify: `docs/implementation/IMPLEMENTATION_STATUS.md`
- Create: `docs/implementation/PHASE_6_REPORT.md`

**Interfaces:**
- Consumes: actual implementation/test results from Tasks 1-15
- Produces: resumable handoff, updated open decisions, final Phase 6 report

- [ ] **Step 1: Update handoff before any expensive review/subagent stage**

Record current task completed/current/next/do-not-start after major milestones:
- schema complete
- API complete
- worker complete
- UI/E2E complete
- final verification running

- [ ] **Step 2: Record resolved and unresolved decisions**

In `docs/decisions/OPEN_DECISIONS.md`, add resolved notes for:
- monthly last-valid-day fallback
- `recurrence_occurrences` deduplication ledger

Keep open only:
- exact CUSTOM grammar
- inactive/removed future assignee behavior if unresolved
- DST ambiguous/nonexistent local time semantics if unresolved

- [ ] **Step 3: Write `PHASE_6_REPORT.md`**

Include sections:

```md
## Implementation
## Schema
## API
## Worker/Outbox
## Recurrence Semantics
## Verification Evidence
## Limitations / Open Decisions
```

- [ ] **Step 4: Update implementation status**

Move Phase 6 from in-progress to completed only after all gates pass.

- [ ] **Step 5: Verify docs mention stop-at-Phase-6 boundary**

Read all updated docs and confirm none claim Phase 7 started.

## Task 17: Full verification gates and cleanup

**Files:**
- No intentional source changes unless a gate fails

**Interfaces:**
- Consumes: all prior implementation
- Produces: verified Phase 6 completion evidence

- [ ] **Step 1: Run dedicated worker/Redis/recurrence integration suite**

Run: `pnpm --filter @floz/worker test:integration`
Expected: outbox, concurrency, retry, catch-up, shutdown tests pass.

- [ ] **Step 2: Run clean DB integration tests**

Run: `./scripts/test-clean-db.ps1`
Expected: PostgreSQL-backed API/integration coverage passes on disposable DB.

- [ ] **Step 3: Run E2E**

Run: `./scripts/test-e2e.ps1`
Expected: real-stack Playwright passes, including recurring create flow.

- [ ] **Step 4: Run workspace-wide quality gates**

Run:
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

Expected: all pass.

- [ ] **Step 5: Inspect diff and prepare integration stop point**

Run:
- `git status --short`
- `git diff --stat`
- `git diff`

Confirm:
- no secrets
- no Redis/PostgreSQL runtime data
- no generated traces/videos/screenshots unless intentionally needed
- no Phase 7 changes

Stop after Phase 6. If commit/integration is requested later, use the verified milestone message:

```bash
git commit -m "feat: implement Floz recurring tasks and worker foundation"
```

## Self-review checklist

- Spec coverage mapped:
  - Phase 5 doc cleanup: Task 1
  - schema/template persistence: Task 3
  - recurrence grammar/monthly fallback/anchors/due validation: Task 4
  - canonical task reuse: Task 5
  - recurrence API/create/list/get/update/stop: Tasks 6, 7, 13
  - idempotency-key replay/conflict: Task 7
  - outbox architecture/lease ownership: Tasks 8, 10
  - BullMQ/Redis runtime: Tasks 9, 10
  - scheduler/reconciliation/catch-up: Tasks 11, 12
  - concurrency/idempotency tests: Tasks 10, 11, 12
  - minimal recurring UI + timezone default: Tasks 14, 15
  - docs/report/handoff/open decisions: Task 16
  - final gates: Task 17
- Placeholder scan: no TBD/TODO placeholders intentionally left.
- Type consistency: `generateDueOccurrence`, `resolveNextOccurrenceAfterUpdate`, `createRecurringTask`, `claimOutboxBatch`, `markOutboxDispatched`, and `markOutboxRetry` are defined before downstream usage.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-27-phase-6-recurring-tasks-worker.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
