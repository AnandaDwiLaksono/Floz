# Task 11 report

## Status
Implemented canonical due occurrence generation and recurrence wake-up processing; review findings fixed.

## Scope
- PostgreSQL transaction re-reads and locks the canonical rule.
- Shared canonical task helpers now perform workflow/status/team validation, task creation, assignee creation, history, and workspace task-key allocation.
- `due_time` is converted from the rule timezone into the scheduled occurrence due timestamp.
- Ledger insertion occurs in a savepoint after task creation; unique conflicts roll back the candidate task and return `noop`.
- Task-key allocation uses a workspace transaction advisory lock, preventing cross-rule races.
- BullMQ processor trusts only `recurrence_rule_id` and uses an injectable clock.
- No reconciliation, UI, or REST calls added.

## Tests
- Worker lint: passed
- Database lint/typecheck/build: passed
- API lint/typecheck: passed
- Worker lint/typecheck/build: passed
- Worker runtime/outbox unit tests: 7 passed
- PostgreSQL recurrence regression suite: 5 passed using disposable PostgreSQL

## Concerns
- Full workspace gates were not run; verification was limited to affected database/API/worker packages.
- PostgreSQL advisory lock serializes task-key allocation per workspace; this preserves the existing key format without adding schema.
