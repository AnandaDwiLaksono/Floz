## Current phase
Phase 6 Recurring Tasks + Worker Foundation implementation in progress.

## Completed work
- Phase 5 Calendar integrated into `master`.
- Phase 6 design approved in `docs/superpowers/specs/2026-08-27-phase-6-recurring-tasks-worker-design.md`.
- Task 1 completed: stale Phase 5/Phase 6 docs aligned.
- Task 2 completed: worker BullMQ/Redis manifest dependencies and exact `test:integration` script added.
- Task 3 completed: recurrence rules, occurrence ledger, outbox, task relationship, and API idempotency schema/migration added; database validation passed.
- Task 4 completed: pure recurrence calculator, anchor semantics, end-condition handling, monthly fallback, DST-safe local interval math, and domain tests added.
- Task 5 completed: canonical Task validation, creation, assignee, and history transaction helpers extracted and review-clean.
- Task 6 completed: recurrence routes, DTO contracts, runtime validation, auth wiring, and unsupported CUSTOM validation added and review-clean.
- Task 7 completed: recurrence create/idempotency/CRUD, first occurrence, prospective updates, stop semantics, and wake-up intents added and review-clean.
- Task 8 completed: transactional outbox enqueue, atomic lease claim/reclaim, ownership-safe dispatch/retry state transitions, and PostgreSQL tests added and review-clean.
- Task 9 completed: BullMQ worker runtime foundation, Redis configuration, deterministic job ID builder, bounded concurrency, and graceful shutdown added; real BullMQ job-ID enqueue verification deferred to Task 10.
- Task 10 completed: unique claim tokens, collision-safe hashed BullMQ job IDs, lease ownership/retry/reclaim tests, non-overlapping dispatcher loop, and awaited dispatcher/SQL shutdown added. Worker Redis integration requires Redis at `REDIS_URL`.

## Current blocker
None.

## Next actions
- Implement outbox dispatcher with real PostgreSQL/Redis/BullMQ integration and verify deterministic BullMQ job-ID compatibility.
- Continue sequentially through Phase 6 plan. Stop after Phase 6.

## Phases/features that must not be started
- Phase 7 and later.
- Notifications, reminders, email delivery, approvals, comments, attachments, KPI, non-task Calendar events.
