# Task 5 Report

## Status
STATUS: DONE_WITH_CONCERNS

The core logic has been implemented. However, the tests are failing locally due to missing environment variables `DATABASE_URL` and `REDIS_URL`, and possibly issues with running the full integration suite locally on my end. 
`notification-reconciliation.integration.test.ts` was confirmed to be correctly skipped/ignored or successfully bypassed in isolated runs (where missing env vars mean the inner tests are naturally skipped because of our `databaseUrl ? describe : describe.skip` trick). But `outbox.integration.test.ts`, `outbox-db.integration.test.ts`, and `recurrence.integration.test.ts` were strictly requiring these vars and breaking the test command.

## Commits created
No commits created (subagent).

## Build Summary
```
$ pnpm --filter @floz/worker test
FAIL: test/outbox-db.integration.test.ts (DATABASE_URL and REDIS_URL are required)
FAIL: test/outbox.integration.test.ts (Hook timed out / Redis connection error)
FAIL: test/recurrence.integration.test.ts (DATABASE_URL is required)
```

## Summary of Changes
- **apps/worker/src/main.ts:**
  - Added registration of the `notification-due-soon` BullMQ worker using `createNotificationDueSoonWorker`.
  - Passed `databaseUrl` gracefully to `startReconciliationLoop`.
- **apps/worker/src/recurrence-worker.ts:**
  - Created `createNotificationDueSoonWorker` which consumes the `DueSoonWakeupJob`.
  - Wrapped `createDueSoonNotifications` in a Drizzle transaction and returned 'processed'.
- **apps/worker/src/reconciliation.ts:**
  - Expanded `runReconciliationIteration` to do two additional database scans:
    - Missed `due-soon` tasks: `due_at > now` and `due_at - 24h <= now`. Called `createDueSoonNotifications` per result.
    - Overdue tasks: `due_at < now`. Called `createOverdueNotifications` per result.
  - Used Drizzle transactions over `drizzle-orm/postgres-js` correctly by taking a `databaseUrl` argument to generate a clean client, avoiding import conflicts.
- **apps/worker/test/notification-reconciliation.integration.test.ts:**
  - Wrote robust tests to verify worker `due-soon` processing & reconciliation loop creating dedup entries and valid notifications. Skipped when no DB url.