# Phase 6 Recurring Tasks + Worker Foundation Report

## Implementation

- Added recurring Task creation with persistent `recurrence_rules`, `recurrence_occurrences`, transactional outbox, and API idempotency storage.
- Added executable recurrence grammar for `DAILY`, `WEEKLY`, and `MONTHLY` with positive `interval_value`.
- Kept `CUSTOM` reserved/unsupported in Phase 6 and exposed that gap explicitly in API and UI.
- Added long-running worker foundation, Redis/BullMQ queue wiring, outbox dispatcher, due occurrence generation, and PostgreSQL-backed reconciliation.
- Extended the existing Task Create experience with minimal recurring controls and real-stack recurring E2E coverage.

## Schema

- `recurrence_rules` stores canonical recurrence state, timezone, `template_snapshot`, `anchor_day`, `generated_count`, `next_run_at`, end conditions, and creator/timestamps.
- `recurrence_occurrences` is a lightweight occurrence/idempotency ledger.
- `tasks.recurrence_rule_id` links generated Tasks back to their recurrence rule.
- `outbox_events` stores `PENDING` / `FAILED` / `DISPATCHED` delivery intent with `claimed_by`, `claimed_until`, `available_at`, and `attempt_count`.
- `recurrence_idempotency_keys` stores workspace-scoped `Idempotency-Key` fingerprint and references to the original recurrence rule / first occurrence.

## Recurrence semantics

- Executable Phase 6 grammar: `DAILY`, `WEEKLY`, `MONTHLY`.
- `CUSTOM` remains reserved and unsupported in Phase 6.
- `DAILY` preserves local wall-clock time of `start_at`.
- `WEEKLY` preserves local weekday + wall-clock time of `start_at`.
- `MONTHLY` preserves canonical `anchor_day` + local wall-clock time.
- Monthly anchors `29/30/31` fall back to the target month’s last valid day without anchor drift.
- `occurrence_limit` counts all generated occurrences, including `first_occurrence`.
- `scheduled_for == end_at` is allowed; `scheduled_for > end_at` is not.
- `end_at` and `occurrence_limit` are mutually exclusive.
- Generated due time stays same-day; invalid `due_at < start_at` is rejected rather than interpreted as next-day.
- PATCH is prospective only and never retroactively backfills historical occurrences.

## Deduplication and idempotency

- Database occurrence uniqueness is authoritative: `UNIQUE(recurrence_rule_id, scheduled_for)`.
- Worker retries, duplicate wake-ups, and reconciliation reruns use that uniqueness guard and return safe no-op on the occurrence-ledger conflict only.
- HTTP create uses workspace-scoped `Idempotency-Key` + request fingerprint.
- Same key + same payload replays the original recurrence rule / first occurrence.
- Same key + different payload returns conflict.

## API

- Implemented:
  - `POST /api/v1/workspaces/{workspace_id}/recurring-tasks`
  - `GET /api/v1/workspaces/{workspace_id}/recurrence-rules`
  - `GET /api/v1/workspaces/{workspace_id}/recurrence-rules/{id}`
  - `PATCH /api/v1/workspaces/{workspace_id}/recurrence-rules/{id}`
  - `POST /api/v1/workspaces/{workspace_id}/recurrence-rules/{id}/stop`
- Create is atomic: recurrence rule, first occurrence, occurrence ledger, history, idempotency record, and future wake-up intent persist in one PostgreSQL transaction.
- `first_occurrence` is returned immediately, including future-dated first occurrences.
- After create, `next_run_at` always points strictly after `first_occurrence` or is `null` when complete.
- List/get/update/stop enforce workspace auth, validation, response/error envelopes, filters, and pagination.

## Outbox and BullMQ

- Outbox writes happen inside business transactions; Redis/BullMQ enqueue happens after claim-transaction commit.
- Claiming uses short-lived leases via `claimed_by` + `claimed_until`.
- Expired leases are atomically reclaimable.
- Stale claimants cannot mark rows `DISPATCHED` or `FAILED` after ownership changes or lease expiry.
- BullMQ is transport/execution only; PostgreSQL remains canonical.
- BullMQ rejected colon-containing custom IDs (`Custom Id cannot contain :`).
- Phase 6 switched to deterministic SHA-256-safe BullMQ job IDs.

## Worker architecture

- Worker runtime supports startup, Redis connection, BullMQ queue registration, bounded concurrency, structured logging, and graceful shutdown.
- Outbox dispatcher claims DB intent rows, enqueues to BullMQ outside DB transactions, then marks `DISPATCHED` / `FAILED` only if lease ownership still matches.
- `generateDueOccurrence()` is the single shared generation path used by wake-up processing and reconciliation.
- Generated occurrences use canonical Task validation/creation, canonical status/team/assignee scope checks, history semantics, and outbox follow-up.

## Reconciliation and concurrency

- Reconciliation scans active rules with `next_run_at <= now`.
- Reconciliation is a recovery path only; BullMQ wake-ups remain execution hints.
- Catch-up runs chronologically and is bounded by configurable batch size per iteration.
- If more missed work remains after one batch, `next_run_at` stays due and recoverable on the next iteration.
- PostgreSQL locking / advisory lock session pinning / row-level checks prevent concurrent reconcilers from multiplying bounded work.
- Concurrent workers processing the same due rule create exactly one occurrence.

## Verification evidence

Focused verification completed:

- `pnpm --filter @floz/domain test`
- `pnpm --filter @floz/domain build`
- `pnpm --filter @floz/api test -- test/api.test.ts`
- `pnpm --filter @floz/api lint`
- `pnpm --filter @floz/api typecheck`
- `pnpm --filter @floz/api build`
- `pnpm --filter @floz/worker test -- test/outbox-dispatcher.test.ts test/recurrence-runtime.test.ts`
- `pnpm --filter @floz/worker test -- test/recurrence.integration.test.ts`
- `pnpm --filter @floz/worker test:integration` with disposable PostgreSQL + Redis
- `pnpm --filter @floz/worker lint`
- `pnpm --filter @floz/worker typecheck`
- `pnpm --filter @floz/worker build`
- `./scripts/test-e2e.ps1`
- `pnpm lint`
- `pnpm typecheck`

Real integration evidence:

- PostgreSQL + Redis/BullMQ integration: 2/2 passed for dispatcher/job ID behavior.
- Worker recurrence integration: concurrent worker safety, stale wake-up no-op, bounded chronological catch-up, and duplicate reconciliation safety verified.
- Real-stack Playwright recurring Task create, persistence, first occurrence, and refresh flow passed.

## Completion status

- Phase 6 implementation is functionally complete.
- Full final branch gates are not yet all recorded in this report: `./scripts/test-clean-db.ps1`, full `pnpm test`, and full `pnpm build` should be re-run in final verification task before declaring branch ready to merge.
- Phase 7 has not started.

## Remaining open decisions / limitations

- Exact `CUSTOM` grammar remains open; Phase 6 intentionally leaves it unsupported.
- Inactive/removed future assignee behavior remains open if recurrence template references change after creation.
- DST ambiguous/nonexistent local-time behavior remains limited to current timezone helper behavior and should be explicitly expanded later if product semantics require more.
- Calendar start-only task semantics remain unsupported from Phase 5.
