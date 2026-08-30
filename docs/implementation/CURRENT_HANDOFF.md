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
- Task 9 completed: BullMQ worker runtime foundation, Redis configuration, deterministic job ID builder, bounded concurrency, and graceful shutdown added.
- Task 10 completed: lease-safe outbox dispatcher, collision-safe hashed BullMQ job IDs, retry/reclaim/concurrency handling, and real PostgreSQL + Redis/BullMQ integration passed. BullMQ rejects colon-containing custom IDs; SHA-256-safe IDs are now used.
- Task 11 completed: canonical due occurrence generation, wake-up processor, shared Task rules, occurrence deduplication, and recurrence history added and review-clean.
- Task 12 completed: stale-safe PostgreSQL-concurrent reconciliation and bounded chronological catch-up added and review-clean.

## Current blocker
None.

## Next actions
- Complete recurrence list/get/update/stop API behavior and PostgreSQL coverage.
- Continue sequentially through Phase 6 plan. Stop after Phase 6.

## Phases/features that must not be started
- Phase 7 and later.
- Notifications, reminders, email delivery, approvals, comments, attachments, KPI, non-task Calendar events.
