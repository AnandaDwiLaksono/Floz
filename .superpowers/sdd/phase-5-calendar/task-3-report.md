# Task 3 report

Status: complete

Implemented backend Calendar projection only:
- `GET /api/v1/workspaces/:workspaceId/calendar/tasks`
- PostgreSQL-backed projection from canonical `tasks`
- Scheduled overlap and deadline-only selection
- Deleted, start-only, out-of-range exclusion
- Workspace membership guard
- Team and assignee scope validation
- Timestamp and range validation
- ISO 8601 projection timestamps
- Documented `{ data, meta: { from, to } }` response

Tests:
- `pnpm --filter @floz/api test -- api.test.ts` — 13 passed
- `pnpm --filter @floz/api lint` — passed
- `pnpm --filter @floz/api typecheck` — passed
- `pnpm --filter @floz/api build` — passed

Concerns:
- PostgreSQL driver returns `timestamptz` strings in this stack; projection normalizes them through `Date` before returning ISO timestamps.
- Full phase verification intentionally not run; Task 3 backend scope only.
