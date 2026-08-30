# Task 11 report

## Status
Implemented canonical due occurrence generation and recurrence wake-up processing; scoped review fixes applied.

## Scope
- PostgreSQL transaction re-reads and locks the canonical rule.
- Shared canonical task helpers validate workflow, template `status_id`, team, task creation, assignees, history, and workspace task-key allocation.
- `due_time` is converted from the rule timezone into the scheduled occurrence due timestamp.
- Ledger insertion occurs in a savepoint after task creation; only `recurrence_occurrences(recurrence_rule_id, scheduled_for)` unique conflicts roll back the candidate task and return `noop`.
- Other unique conflicts, including task-key conflicts, rethrow.
- BullMQ processor trusts only `recurrence_rule_id` and uses an injectable clock.
- No reconciliation, UI, or REST calls added.

## Tests
- Database/API/worker lint/typecheck/build: passed
- Worker runtime/outbox unit tests: 7 passed
- PostgreSQL recurrence regression suite: 7 passed using disposable PostgreSQL

## Concerns
- Full workspace gates were not run; verification was limited to affected database/API/worker packages.
- PostgreSQL advisory lock serializes task-key allocation per workspace; this preserves the existing key format without adding schema.
