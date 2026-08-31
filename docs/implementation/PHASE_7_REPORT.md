# Phase 7 Notifications & Reminders Report

## Scope delivered

- P0 in-app notifications: `TASK_ASSIGNED`, `TASK_DUE_SOON`, `TASK_OVERDUE`.
- PostgreSQL notification inbox, schedule-aware durable deduplication ledger, dormant notification preferences schema, and Task `due_version`.
- Transactional Task assignment/due-date outbox intents.
- Existing worker application extended with assignment fan-out, due-soon delayed wake-ups, overdue processing, and reconciliation recovery.
- Workspace/user-isolated notification list, unread count, mark-read, and mark-all-read APIs.
- Accessible authenticated-shell notification bell and Notification Center with unread/all views, relative timestamps, load-more action, optimistic read behavior, polling/focus refresh, and canonical Task deep links.
- Real-stack notification browser coverage.

## Approved reminder policy

- One `TASK_DUE_SOON` notification per recipient and due schedule revision.
- Default eligibility begins at `due_at - 24 hours`.
- Tasks created/rescheduled inside the 24-hour window become immediately eligible while `now < due_at`.
- `TASK_OVERDUE` begins only when `now > due_at`.
- Workers re-read canonical PostgreSQL Task state and reject stale, terminal, soft-deleted, or rescheduled work.

## Idempotency and recovery

- Assignment identity: assignment event + Task + recipient.
- Due-soon and overdue identity: Task + recipient + `due_version`.
- Dedup acquisition gates notification insertion atomically in PostgreSQL.
- BullMQ deterministic IDs use SHA-256-safe encoding.
- Delayed wake-ups and periodic reconciliation invoke the same notification creation primitives.
- PostgreSQL remains sufficient for recovery after worker/API restart, Redis outage, delayed/lost jobs, duplicate jobs, and stale schedules.

## Final verification blockers resolved

### Cross-suite reconciliation pollution

Worker integration fixtures shared PostgreSQL state while reconciliation scanned all eligible recurrence and notification work. Stale recurrence fixtures, including an intentional cross-workspace team reference, could be consumed by the notification reconciliation suite and raise `TEAM_SCOPE_MISMATCH`. Notification fixture due dates also mixed wall-clock construction with a fixed reconciliation clock.

Fix:

- notification reconciliation fixtures now reset Phase 7 and related workflow/recurrence tables in FK-safe order;
- fixture due dates derive from one controlled reconciliation clock;
- due-soon worker and shared notification primitives accept an injected test clock while production defaults remain real time;
- worker integration files run serially against the shared integration database;
- recurrence fixture role codes are unique.

### Shared database/environment lifecycle

Root `pnpm -r test` ran database-backed workspace suites concurrently against the same PostgreSQL database while API suites performed destructive resets. Database Vitest files also ran concurrently. A brittle notification fixture used a generated role ID after `ON CONFLICT DO NOTHING`, even though the persisted canonical role could have another ID. Web tests also hardcoded an API base URL despite inherited E2E configuration.

Fix:

- root workspace tests run deterministically with `--workspace-concurrency=1`;
- database integration test files run in one fork;
- notification fixture re-reads and uses the persisted canonical ADMIN role ID;
- fixture teardown is FK-safe and tolerant of incomplete setup;
- API URL assertions use the configured base URL;
- disposable test URLs remain scoped to their owning PowerShell process; stable full-suite verification uses the explicitly migrated test database.

## Verification evidence

- `./scripts/test-clean-db.ps1`: PASS
- `./scripts/test-e2e.ps1`: PASS, 7/7 Playwright tests
- `pnpm --filter @floz/worker test:integration`: PASS, 16/16 tests
- `pnpm lint`: PASS
- `pnpm typecheck`: PASS
- `pnpm test`: PASS twice consecutively
- `pnpm build`: PASS

## Completion

- Phase 7 complete.
- Phase 8 not started.
- Email/Resend, push, notification preferences UI/API behavior, approval notifications, and mention notifications remain out of scope.
