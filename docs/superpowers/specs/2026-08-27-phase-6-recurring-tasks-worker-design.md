# Phase 6 Recurring Tasks + Worker Foundation Design

## Status

Approved design for Phase 6 implementation planning. Do not start Phase 7 scope.

## Current state reconstructed

- `master` contains Phase 5 Calendar integration at `1e1687c feat: integrate Phase 5 Calendar`.
- Phase 5 Calendar is accepted and verified.
- `IMPLEMENTATION_STATUS.md` still has stale wording that lists Calendar as out-of-scope and must be corrected before substantial Phase 6 work.
- `PHASE_5_REPORT.md` documentation checklist must remain consistent with the cleared React Hook warning state.
- `CURRENT_HANDOFF.md` must be updated before substantial Phase 6 implementation or expensive review/subagent work.
- Source documentation leaves recurrence storage, recurrence timezone semantics, occurrence generation, queue/outbox, and worker execution details open. This design resolves the Phase 6 subset only.

## Scope

Phase 6 implements recurring task creation and the long-running worker foundation.

Included:

- Recurrence schema and persistence.
- Persistent task template snapshot.
- Recurrence occurrence/idempotency ledger.
- Recurring task API endpoints.
- PostgreSQL-first recurrence scheduler.
- Transactional outbox.
- BullMQ/Redis execution infrastructure.
- Long-running `apps/worker` runtime.
- Reconciliation recovery.
- PostgreSQL + Redis integration tests.
- Minimal recurring UI extending the existing Task creation UX.
- Documentation updates and Phase 6 report.

Excluded:

- Phase 7 and later work.
- Due reminders, overdue reminders, notification center, email, Resend, comments, mentions, attachments, approvals, KPI/dashboard, non-task Calendar events, advanced automation.
- BullMQ repeatable jobs as canonical recurrence schedule.
- Pure database polling as primary architecture.
- Redis as canonical recurrence state.
- Worker calls to public REST API for business logic reuse.

## Architecture

Use the approved PostgreSQL-first hybrid architecture.

Invariants:

- PostgreSQL is canonical recurrence/business state.
- `recurrence_rules.next_run_at` is canonical scheduling intent.
- BullMQ is wake-up/execution infrastructure only.
- Worker claims due rules from PostgreSQL.
- Database uniqueness is authoritative for occurrence deduplication.
- API writes recurring work atomically in PostgreSQL.
- Critical asynchronous follow-up uses transactional outbox.
- Worker always re-reads PostgreSQL and treats stale queue payloads as no-ops.
- Reconciliation recovers lost/delayed wake-ups, Redis outages, dispatcher failures, and worker downtime.

High-level flow:

```text
Create Recurring Task
  -> persist recurrence_rules + template_snapshot
  -> create first Task occurrence
  -> persist recurrence_occurrences identity
  -> update next_run_at
  -> write task history
  -> write outbox event
  -> commit
  -> dispatcher claims outbox
  -> BullMQ wake-up job
  -> worker reloads due rules from PostgreSQL
  -> generate due future occurrence transactionally
  -> advance next_run_at
  -> write next outbox event
```

## Data model

### `recurrence_rules`

Canonical recurrence rule state.

Fields/concepts:

- `id`
- `workspace_id`
- `name`
- `frequency`
- `interval_value`
- `start_at`
- `end_at`
- `occurrence_limit`
- `timezone`
- `next_run_at`
- `is_active`
- `created_by`
- `created_at`
- `updated_at`
- rule configuration JSON where needed
- `template_snapshot` JSONB
- monthly `anchor_day` for MONTHLY recurrence
- generated occurrence count, or equivalent canonical count derived from the occurrence ledger

`template_snapshot` is persistent and contains only the Task creation inputs needed to generate future occurrences:

- title
- description
- workflow/default behavior
- priority
- team
- assignees and primary marker
- schedule/due context needed for generated Task dates, including any due-time input used to resolve canonical `due_at`

Do not duplicate unrelated Task data.

### `recurrence_occurrences`

Lightweight occurrence/idempotency ledger, not a duplicate Task store.

Fields/concepts:

- `id`
- `workspace_id`
- `recurrence_rule_id`
- `scheduled_for`
- `task_id`
- `created_at`

Constraints:

- `UNIQUE(recurrence_rule_id, scheduled_for)`
- `recurrence_occurrences.task_id -> tasks.id`
- `recurrence_occurrences.recurrence_rule_id -> recurrence_rules.id`

`scheduled_for` is the actual resolved occurrence instant after applying timezone rules and monthly fallback. This is the deduplication identity.

### `tasks`

Add canonical relationship:

- `tasks.recurrence_rule_id -> recurrence_rules.id`

Generated Tasks remain normal canonical Tasks and use existing Task rules for task key generation, workflow/status, team, assignees, primary assignee, scheduling fields, history, workspace validation, and soft-delete semantics.

### `outbox_events`

Transactional async delivery intent.

Fields/concepts:

- `id`
- `workspace_id`
- `aggregate_type`
- `aggregate_id`
- `event_type`
- `payload` JSONB
- `status`
- `attempt_count`
- `available_at`
- `claimed_by`
- `claimed_until`
- `created_at`
- `dispatched_at`

Outbox status model is `PENDING`, `DISPATCHED`, and `FAILED`. `claimed_by` and `claimed_until` are lease ownership, not a separate long-lived business status. Recoverable PENDING/FAILED work uses `available_at`, `attempt_count`, and atomically reclaimable expired leases.

## Recurrence grammar

Executable in Phase 6:

- DAILY
- WEEKLY
- MONTHLY

Reserved but not executable:

- CUSTOM

`CUSTOM` remains a domain/API enum because the API baseline reserves it. Phase 6 must not invent CUSTOM behavior, cron syntax, multi-weekday weekly behavior, or other grammar. Requests that attempt unsupported CUSTOM semantics return the canonical validation/unsupported-rule response.

All executable frequencies require positive `interval_value`.

Recurrence calculations use the recurrence rule's configured timezone. Local occurrence date/time is resolved in that timezone, then converted to the canonical timezone-aware instant for persistence.

Base anchors:

- DAILY preserves the recurrence `start_at` local wall-clock time.
- WEEKLY preserves the local weekday + wall-clock time of `start_at`; `interval_value` means every N weeks.
- MONTHLY uses the canonical monthly `anchor_day` + local wall-clock time and retains the approved last-valid-day fallback.
- `anchor_day` has one canonical persistence source; if a contract-facing `rule_config.day_of_month` exists, it must be normalized into `anchor_day` and not diverge as a second truth.

## Monthly fallback rule

MONTHLY recurrence with anchor day 29, 30, or 31 uses last-valid-day fallback.

Rules:

- If the anchor day exists in the target month, use the original anchor day.
- If it does not exist, generate on the last calendar day of that target month.
- Preserve the original monthly anchor separately.
- February fallback never causes anchor drift.
- `scheduled_for` uses the actual resolved occurrence instant after fallback.

Examples:

- Anchor 31: Jan 31 -> Feb 28/29 -> Mar 31 -> Apr 30 -> May 31
- Anchor 30: Jan 30 -> Feb 28/29 -> Mar 30 -> Apr 30
- Anchor 29: Jan 29 -> Feb 28 in non-leap year -> Mar 29

Tests must cover:

- Jan 31 -> Feb 28 -> Mar 31 non-leap year
- Jan 31 -> Feb 29 -> Mar 31 leap year
- Mar 31 -> Apr 30 -> May 31
- Jan 30 -> Feb 28/29 -> Mar 30
- `interval_value > 1` with deterministic anchor/fallback behavior

## Generated Task scheduling

Generated Tasks use the same canonical Task validation as normal Task creation.

Do not silently interpret a due time earlier than the occurrence local start time as next day. Phase 6 uses same-day due-time semantics. If generated `due_at < start_at`, reject the template/rule through canonical validation rather than inventing next-day behavior.

## API behavior

`POST /api/v1/workspaces/{workspace_id}/recurring-tasks` accepts the existing Floz `Idempotency-Key` strategy. The implementation persists enough idempotency state to distinguish a legitimate retry from accidental key reuse. Same workspace + same `Idempotency-Key` + same logical request payload returns/recovers the original recurring-task creation result. Same workspace + same `Idempotency-Key` + materially different payload rejects with canonical idempotency/conflict behavior. Use a stable request fingerprint/hash or equivalent established Floz idempotency mechanism. Idempotency state references the originally created recurrence rule and `first_occurrence`. API idempotency is separate from BullMQ `jobId`.

Implement existing Phase 6 contracts:

- `POST /api/v1/workspaces/{workspace_id}/recurring-tasks`
- `GET /api/v1/workspaces/{workspace_id}/recurrence-rules`
- `GET /api/v1/workspaces/{workspace_id}/recurrence-rules/{id}`
- `PATCH /api/v1/workspaces/{workspace_id}/recurrence-rules/{id}`
- `POST /api/v1/workspaces/{workspace_id}/recurrence-rules/{id}/stop`

All endpoints remain workspace-scoped and use existing authentication, membership, and policy architecture.

`GET /recurrence-rules` supports contract filters `active`, `team_id`, and `assignee_id`, validates each workspace-scoped reference, and uses the standard collection pagination contract where applicable.

Recurring task creation is atomic:

```text
BEGIN
  validate workspace/member/policy
  validate recurrence grammar
  validate task template
  validate workflow/team/assignees/primary assignee
  persist recurrence rule + template_snapshot
  create first occurrence
  persist recurrence occurrence identity
  update next_run_at
  write task history
  write outbox event if needed
COMMIT
```

No Redis enqueue occurs inside the business transaction.

Successful creation atomically creates the first occurrence and returns it as `first_occurrence`. A future-dated first occurrence may be persisted immediately as a future scheduled Task; it does not wait until its calendar date to exist. After creation, `next_run_at` points to the next eligible occurrence strictly after `first_occurrence`; it never points at the already-created occurrence.

End-condition baseline:

- `occurrence_limit` counts all generated occurrences, including `first_occurrence`.
- `scheduled_for == end_at` is permitted.
- `scheduled_for > end_at` generates nothing.
- `end_at` and `occurrence_limit` are mutually exclusive end-condition alternatives.
- both `end_at` and `occurrence_limit` null means the rule may continue indefinitely until stopped.
- `occurrence_limit` must be positive.
- when an end boundary or limit is reached, set `next_run_at = null` and do not enqueue another wake-up.
- `occurrence_limit = 1` creates `first_occurrence`, sets `next_run_at = null`, and creates no future wake-up.
- `first_occurrence.scheduled_for == end_at` creates `first_occurrence`, sets `next_run_at = null`, and creates no future wake-up.
- `end_at < first_occurrence.scheduled_for` rejects the recurrence request as invalid.

Updates apply to future generation only. Already-created occurrences must not be silently rewritten.

PATCH is prospective, never retroactive. At update time, calculate the first valid candidate under the new grammar/anchor strictly after `max(effective_change_time, latest_generated_occurrence.scheduled_for)`. Preserve DAILY local wall-clock, WEEKLY weekday + local wall-clock, and MONTHLY canonical `anchor_day` + local wall-clock anchors. Do not calculate merely from `last occurrence + interval` when that would drift from canonical anchors. Do not backfill occurrences between the old schedule and update time. If no future candidate satisfies the new rule/end condition, set `next_run_at = null` and enqueue no wake-up. Any old queued wake-up becomes a harmless stale no-op after PostgreSQL re-read.

Stopping recurrence:

- sets `is_active = false`
- clears/neutralizes `next_run_at`
- preserves previously generated Tasks
- prevents future occurrence generation

## Transactional outbox

Business transactions write outbox events before commit.

Dispatcher flow:

```text
claim pending outbox rows using short DB transaction
  -> obtain ownership lease
  -> commit claim
  -> enqueue BullMQ job with deterministic jobId outside DB transaction
  -> on success, mark DISPATCHED only if current claim still matches
  -> on failure, update retry state only if current claim still matches
```

Requirements:

- Do not hold a PostgreSQL transaction open during Redis/BullMQ I/O.
- Expired outbox leases are reclaimable atomically.
- Claiming supports multiple dispatchers using row locking / `SKIP LOCKED` or equivalent.
- Stale dispatchers must not overwrite newer dispatcher state.
- `DISPATCHED` is recorded only after successful enqueue.
- Crash after successful enqueue but before marking dispatched is tolerated through deterministic BullMQ `jobId` and idempotent downstream handlers.
- Outbox events remain safe to retry.

## BullMQ / Redis

Use BullMQ in `apps/worker` with environment-driven Redis configuration.

Requirements:

- Compatible with Upstash Redis for production.
- Local/integration tests use disposable Docker Redis, not production credentials.
- Delayed/scheduled wake-up jobs supported.
- Retries/backoff configured.
- Deterministic job IDs where useful.
- Graceful shutdown supported.
- Redis is not used as cache or canonical recurrence storage in Phase 6.

## Worker runtime

`apps/worker` becomes a real long-running runtime.

Capabilities:

- startup
- Redis connection
- BullMQ queue and worker registration
- bounded concurrency
- structured logging
- graceful shutdown
- retries/backoff
- idempotent handlers

Initial processors:

- outbox dispatcher / delivery
- recurrence wake-up generation
- reconciliation recovery

No notification/email/reminder processors except empty infrastructure registration only if strictly needed.

## Recurrence generation transaction

Due recurrence processing uses a single canonical generation path, shared by BullMQ wake-ups and reconciliation.

Conceptual transaction:

```text
BEGIN
  safely claim/load recurrence rule
  verify rule is active
  verify next_run_at <= now
  resolve scheduled_for from canonical rule state
  attempt recurrence occurrence identity
  create canonical Task if not already generated
  create Task assignees/history
  calculate next_run_at
  update recurrence rule
  add required outbox event
COMMIT
```

Concurrency requirements:

- Multiple worker executions must not duplicate occurrences.
- Database uniqueness on `(recurrence_rule_id, scheduled_for)` is final duplicate guard.
- PostgreSQL locking/claiming is used for due rules.
- BullMQ job uniqueness is not sufficient business deduplication.
- BullMQ retries, worker restarts, process crashes, and reconciliation reruns are safe.

Stale wake-ups:

- Worker re-reads PostgreSQL every time.
- Stopped rule: no-op.
- Rule no longer due: no-op.
- Occurrence already generated: no duplicate Task.
- Future schedule changed: no-op or generate according to current DB state only.

## Reconciliation

Reconciliation periodically scans PostgreSQL for active rules where `next_run_at <= now`.

It exists to recover from:

- lost/delayed BullMQ wake-up jobs
- Redis outages
- dispatcher failures
- worker downtime

Reconciliation uses the same `generateDueOccurrence()` path as normal wake-up processing. It must not implement a second generation algorithm.

When multiple occurrences were missed during downtime, reconciliation catches them up in chronological order rather than silently dropping them. Each reconciliation iteration uses a bounded, configurable catch-up batch. After the batch, a still-due `next_run_at` remains recoverable by the next iteration.

## Authorization and validation

HTTP operations use existing workspace membership/policy checks.

Worker jobs are trusted system jobs but must still validate canonical DB references and workspace relationships before generating Tasks.

Queue payloads are hints only. They are never trusted as authoritative business state.

Cross-workspace workflow, team, assignee, recurrence, and task references are rejected.

## Local development

Provide reproducible local development for:

- PostgreSQL
- Redis
- API
- Worker
- Web

Extend Docker/dev scripts only where necessary. Do not require an Upstash account for tests.

## UI scope

Backend/worker correctness is the Phase 6 priority.

A minimal recurring-create UI is required for the Phase 6 MVP by extending/reusing the existing Task creation UX:

```text
Create Task -> Enable Recurring -> DAILY/WEEKLY/MONTHLY -> interval -> timezone -> start -> optional end date OR occurrence count -> save
```

Supported fields for Phase 6 UI:

- DAILY / WEEKLY / MONTHLY
- `interval_value`
- recurrence timezone, defaulting to `workspace.timezone` while remaining explicitly editable to another allowed IANA timezone
- supported start/end/count fields

`CUSTOM` must appear unsupported/reserved if visible. Do not build a separate recurrence management application. This remains a Phase 6 P0 product gap/follow-up; Phase 6 must not claim the full documented recurrence grammar is complete while `CUSTOM` remains unsupported.

## Deferred edge cases

Record, do not silently solve:

- exact `CUSTOM` grammar
- inactive/removed future assignee behavior if still unresolved
- any DST ambiguous/nonexistent-local-time behavior not already covered by an approved timezone rule

## Testing

Use real PostgreSQL + disposable Docker Redis integration infrastructure where appropriate.

Minimum worker/recurrence coverage:

1. recurring task creation persists rule/template
2. first occurrence is created according to API contract
3. occurrence links to recurrence rule
4. `next_run_at` is persisted
5. inactive/stopped rule generates nothing
6. future rule generates nothing early
7. due rule generates exactly one occurrence
8. repeated execution does not duplicate occurrence
9. retry does not duplicate occurrence
10. concurrent worker attempts do not duplicate occurrence
11. `next_run_at` advances correctly for DAILY/WEEKLY/MONTHLY
12. monthly fallback tests listed above
13. existing generated occurrence is not rewritten when rule updates
14. stopping rule preserves existing Tasks
15. cross-workspace references are rejected
16. outbox event survives DB commit before Redis delivery
17. failed Redis enqueue leaves recoverable outbox state
18. dispatcher retry eventually dispatches without duplicate business work
19. expired outbox lease can be atomically reclaimed
20. stale dispatcher cannot overwrite newer claim state
21. worker shutdown is graceful

API tests:

- authentication
- authorization
- workspace isolation
- validation
- response/error envelopes
- create/list/get/update/stop
- unsupported CUSTOM response
- cross-workspace rejection

E2E:

- login
- create recurring Task if UI exposed
- recurrence persists
- first occurrence appears as Task

Time-sensitive worker tests should use controlled timestamps/direct processor invocation instead of sleeping for real time.

Final gates before completion:

- `./scripts/test-clean-db.ps1`
- `./scripts/test-e2e.ps1`
- dedicated worker/Redis/recurrence integration suite
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

## Documentation updates

Pre-phase housekeeping:

- Fix `docs/implementation/IMPLEMENTATION_STATUS.md` so Calendar is no longer listed as out-of-scope/unfinished.
- Fix `docs/implementation/PHASE_5_REPORT.md` checklist consistency with cleared React Hook warning state.
- Update `docs/implementation/CURRENT_HANDOFF.md` before substantial Phase 6 work.

Phase 6 documentation:

- Create `docs/implementation/PHASE_6_REPORT.md`.
- Update `docs/implementation/IMPLEMENTATION_STATUS.md`.
- Update `docs/implementation/CURRENT_HANDOFF.md` throughout.
- Update `docs/decisions/OPEN_DECISIONS.md`.
- Record the `recurrence_occurrences` deduplication schema decision in Phase 6 design/report or ADR because it intentionally extends schema for idempotent generation.
- Record monthly fallback as resolved Phase 6 recurrence semantic.

## Git isolation

Use an isolated Phase 6 branch/worktree if practical:

- branch/worktree for Phase 6 implementation
- keep `.worktrees/` ignored
- implement/test in the worktree
- commit verified Phase 6 changes only when explicitly requested/approved by workflow
- integrate cleanly back to `master`
- remove worktree after safe integration

Suggested eventual milestone message:

`feat: implement Floz recurring tasks and worker foundation`

## Completion report requirements

When Phase 6 is complete, report:

1. recurrence schema/template persistence
2. supported recurrence grammar
3. occurrence deduplication strategy
4. recurring API behavior
5. outbox architecture
6. BullMQ/Redis configuration
7. worker architecture
8. scheduler/reconciliation behavior
9. concurrency/idempotency behavior
10. PostgreSQL/Redis/worker test results
11. API/E2E results
12. lint/typecheck/test/build results
13. final Git commit hash
14. remaining open decisions/limitations

Stop after Phase 6. Do not proceed to Phase 7 automatically.
