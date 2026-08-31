## Current phase
Phase 7 Notifications & Reminders complete.

## Completed work
- Phase 6 Recurring Tasks + Worker Foundation accepted complete.
- Phase 7 delivered P0 in-app `TASK_ASSIGNED`, `TASK_DUE_SOON`, and `TASK_OVERDUE` notifications.
- Added `notifications`, durable notification deduplication ledger, dormant notification preferences schema, and Task `due_version` schedule revision.
- Added transactional assignment/due-date outbox intents, SHA-256-safe BullMQ due wake-ups, canonical worker re-reads, and advisory-locked reconciliation.
- Added notification list/unread count/read/mark-all-read API endpoints with workspace and user isolation.
- Added global Bell, accessible Notification Center, polling/focus refresh, relative timestamps, deep links, and real-stack browser coverage.
- Resolved shared-DB fixture pollution and deterministic root test orchestration. See `PHASE_7_REPORT.md`.
- Final gates passed: clean DB, E2E 7/7, worker integration 16/16, lint, typecheck, root tests twice, and build.

## Current blocker
None.

## Next actions
- Stop after Phase 7. Await explicit Phase 8 direction.

## Phases/features that must not be started
- Phase 8 and later.
- Approval notifications, comments, mentions, attachments, KPI, notification preferences UI, push, email delivery, non-task Calendar events.
