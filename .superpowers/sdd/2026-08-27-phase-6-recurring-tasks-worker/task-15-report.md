# Task 15 report

## Scope

Added one real-stack Playwright scenario for recurring task creation.

## Coverage

- Logs in, opens task creation, enables recurrence.
- Selects weekly frequency, interval, timezone, occurrence count.
- Verifies CUSTOM is unavailable and end date becomes disabled.
- Submits through the UI client, which supplies an Idempotency-Key.
- Verifies persisted recurrence rule, first occurrence, task list visibility, refresh persistence.

## Verification

- `./scripts/test-e2e.ps1` — 6 passed
- `pnpm lint` — passed
- `pnpm typecheck` — passed

## Concern

The existing E2E harness starts PostgreSQL, API, and web only. Creation atomically produces the first occurrence, so Redis/worker are not required for this flow. Future wake-up processing remains worker integration coverage.
