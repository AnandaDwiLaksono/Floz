# Task 2 Report

Status: DONE_WITH_CONCERNS

Commit message: test(web): add replaceable workspace calendar time utility

Scope implemented:
- Added `apps/web/lib/calendar-time.ts` with a small replaceable timezone utility.
- Added `apps/web/lib/calendar-time.test.ts` covering:
  - Asia/Jakarta month range math
  - DST-aware day range math for America/New_York
  - browser-timezone-independent day grouping
  - calendar navigation shifting
  - timezone label/today helpers

TDD evidence:
- RED: `pnpm --filter @floz/web test -- calendar-time.test.ts` failed with missing module import before implementation.
- GREEN: focused test suite passed after implementation.

Verification:
- `pnpm --filter @floz/web test -- calendar-time.test.ts`: PASS
- `pnpm --filter @floz/web build`: PASS
- `pnpm --filter @floz/web typecheck`: FAIL in pre-existing `.next/types` file resolution under `apps/web/tsconfig.json`
- `pnpm --filter @floz/web lint`: emitted Next.js pages-directory warning, but no repo code errors in this task scope

Concerns:
- `getCalendarRange` and `getCalendarDayKey` rely on `Intl.DateTimeFormat`; this keeps the utility small, but timezone correctness still depends on runtime ICU data.
- The web package typecheck is blocked by missing generated `.next/types` files in this worktree, unrelated to the new utility.
- The lint command prints a Next.js pages-directory warning from the current repo layout.

## Review Fix Report

Status: DONE

Fixes:
- Made week ranges explicitly Monday-start and half-open in workspace timezone.
- Made day/week navigation preserve civil-date semantics.
- Made month navigation preserve the day when possible and clamp at the destination month end.
- Added regression coverage for Monday week anchoring, month rollover in both directions, and timezone-independent navigation.

TDD evidence:
- RED: focused calendar-time suite failed on Tuesday week anchoring and January 31 month rollover.
- GREEN: `pnpm --filter @floz/web test -- calendar-time.test.ts` passed 6/6 tests.

Verification:
- `pnpm --filter @floz/web test -- calendar-time.test.ts`: PASS, 6/6 tests.
- `pnpm --filter @floz/web build`: PASS; existing multiple-lockfile workspace-root warning remains.
