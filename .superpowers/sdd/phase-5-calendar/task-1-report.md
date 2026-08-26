# Task 1 Report

Status: DONE_WITH_CONCERNS

Commit message: fix(web): clean hooks and support task create prefill

Scope implemented:
- Added Tasks URL create-prefill handoff for `create=1`, `prefill_start_at`, `prefill_due_at`.
- Preserved `selected_task_id` detail deep-link behavior.
- Stabilized Tasks page callbacks used by effects.
- Fixed the only React hook warning emitted by clean web build, in Kanban `load`, because Task 1 requires clean web build with no hook warnings.
- Added focused Playwright coverage for Calendar-to-Tasks create handoff.

TDD evidence:
- RED attempted after test addition: `pnpm --filter @floz/web exec playwright test e2e/flow.spec.ts -g "calendar create handoff opens task form with prefilled schedule fields"` failed.
- Initial pre-test run before adding the test was blocked by missing built `@floz/database`; fixed by `pnpm --filter @floz/database build`.

Verification:
- `pnpm --filter @floz/web build`: PASS. No React hook warnings. Next.js workspace-root warning remains due multiple lockfiles.
- `pnpm typecheck`: FAIL in pre-existing `apps/worker` package resolution for `@floz/config` and `@floz/observability`.
- Targeted Playwright test after implementation: FAIL in current local E2E stack; output truncated by reporter to failure summary, with Better Auth base URL warnings.

Concerns:
- The requested exact command in the plan used `apps/web/e2e/flow.spec.ts` from repo root, but Playwright resolved only when run with `e2e/flow.spec.ts` under `apps/web`.
- Targeted E2E did not pass in this environment despite implementation; failure details were not printed beyond the summary.
- Clean web build required modifying `apps/web/app/workspaces/[workspaceId]/kanban/page.tsx` to remove the only remaining React hook warning, although Task 1 file list named Tasks page plus flow spec.
- Repo typecheck is blocked by worker package resolution unrelated to Task 1.

## Review Fix Report

Status: BLOCKED

Fixes:
- Added `role="dialog"`, `aria-modal="true"`, and accessible labels to create/detail modal containers in `apps/web/app/workspaces/[workspaceId]/tasks/page.tsx`.
- Replaced broad `searchParams` effect dependencies with scalar `create`, prefill, and `selectedTaskId` dependencies.
- Kept the Kanban `useCallback` change: the clean web build previously emitted its missing `load` dependency warning; the change removes that warning without disabling lint.

Verification:
- `pnpm --filter @floz/web build`: PASS; no React Hook dependency warnings.
- Targeted Playwright: BLOCKED/FAIL in the local stack. The test reaches the browser runner but exits after Better Auth warnings (`Base URL is not set`) without exposing an assertion or server error in the configured line reporter. No `test-results` or `playwright-report` artifacts were produced. The app server/API stack required by `playwright.config.ts` (`http://localhost:3000`) is not started by the config, so a passing result requires the project E2E stack to be running.
- `git diff --check`: PASS.

## API Build Blocker Fix

Root cause:
- `apps/api/package.json` declared workspace dependencies `@floz/config` and `@floz/observability`, but `pnpm --filter @floz/api build` invoked `nest build` directly, so their `dist` outputs were not built first.
- Reproduced with exact command: `pnpm --filter @floz/api build` failed with TS2307 for both imports in `apps/api/src/main.ts`.
- This is repo-wide, not worktree-only: the root checkout has the same package layout and the same missing `dist` outputs before build.

Fix:
- Added `prebuild` to `apps/api/package.json` to build only `@floz/config` and `@floz/observability` before API build:
  - `pnpm --filter @floz/config --filter @floz/observability build`

Verification:
- `pnpm --filter @floz/api build`: PASS.
- `./scripts/test-e2e.ps1`: PASS after the fix; full harness completed with 2/2 Playwright tests passing.
- Evidence from harness: database migrate PASS, API build PASS, web build PASS, Playwright PASS.
- Next.js workspace-root warning remains non-blocking.
