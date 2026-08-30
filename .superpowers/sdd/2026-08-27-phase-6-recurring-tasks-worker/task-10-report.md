# Task 10 Report

## Status

Implemented the lease-safe transactional outbox dispatcher only. Recurrence generation, reconciliation, and UI remain untouched.

## Implementation

- Shared PostgreSQL claim, retry, and dispatched primitives through `@floz/database` so API and worker use the same ownership-checked SQL.
- Claims commit before BullMQ enqueue. Redis network I/O occurs after `claimOutboxBatch` returns.
- Marks `DISPATCHED` only after successful enqueue and current lease ownership.
- Marks `FAILED` with a future `available_at` only after enqueue failure and current lease ownership.
- Existing `FOR UPDATE SKIP LOCKED` claim query provides multi-dispatcher safety and expired lease reclaim.
- Worker runtime starts a bounded dispatcher interval and stops it during shutdown.

## BullMQ Job ID Evidence

BullMQ 5.81.3 against disposable `redis:7-alpine` rejected the prior colon-containing ID:

```text
recurrence:rule-1:2026-08-30T12:00:00.000Z
Custom Id cannot contain :
```

The deterministic safe encoding is:

```text
recurrence-rule-1-2026-08-30T12_00_00.000Z
```

A real queue accepted this ID. `queue.getJob(jobId)` returned the same ID and payload. Adding the same logical job twice left exactly one waiting BullMQ job.

## Verification

- `pnpm --filter @floz/worker test -- test/outbox-dispatcher.test.ts test/recurrence-runtime.test.ts`: 6 passed.
- `pnpm --filter @floz/worker test:integration` with disposable PostgreSQL 16 and Redis 7: 2 passed.
- Real integration claimed a persisted outbox row, enqueued it, retrieved the job, marked the row `DISPATCHED`, reset the row to model the crash window, redispatched it, and retained one logical BullMQ job.
- `pnpm --filter @floz/worker lint`: passed.
- `pnpm --filter @floz/worker typecheck`: passed.
- `pnpm --filter @floz/worker build`: passed.

## Concerns

Database uniqueness remains authoritative business deduplication. BullMQ deterministic job IDs only make the enqueue/update crash window harmless while the prior job remains retained; later recurrence processing must continue to enforce database occurrence uniqueness.
