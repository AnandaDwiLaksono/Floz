# Phase 12: Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** FINAL IMPLEMENTATION PLAN / APPROVED FOR EXECUTION ONLY
**Revision:** IMPLEMENTATION PLAN REVISION #2; 24 tasks across checkpoints A–I. Consistency-reviewed plan-only revision; no implementation, runtime gates, baseline publication, external edits, commits, pushes, branches, or worktrees are authorized by this status.
**Frozen baseline:** `d2b1a62001b2e038a73abf67df28c9b2fc37653d` on `master`; design remains FINAL and byte-unchanged. Historical initial status before finalization: this plan was the sole untracked draft.
**Design Reference:** `docs/superpowers/specs/2026-09-11-phase-12-production-hardening-design.md` (FINAL DESIGN / APPROVED FOR IMPLEMENTATION PLANNING)
**Goal:** Implement deterministic Gate A production hardening without changing accepted auth, business, Phase 9, migration, Next output, or deployment contracts.
**Architecture:** Preserve current owner boundaries. Centralize configuration/TLS, ingress guards, bounded shutdown, worker lifecycle/health, compiled migration, and fixture backup verification around the existing Nest, worker, Postgres.js, BullMQ, Next, Docker, and Caddy artifacts.
**Tech Stack:** Node 22, TypeScript, NestJS, Express, Better Auth, Postgres.js/Drizzle, BullMQ/ioredis, Pino, Next.js, pnpm, Docker/Caddy, PostgreSQL, age, S3-compatible fixture.

## Global Constraints

- Use `ALLOWED_ORIGINS`; accept `ALLOWED_ORIGIN` only as an agreeing one-origin compatibility alias.
- Production TLS is verified and fail-closed; `DB_SSL` and `REDIS_TLS` are tri-state; no plaintext or `rejectUnauthorized: false` fallback.
- API persistent PostgreSQL max is 1; every worker owner max is 1; each BullMQ worker concurrency is 1; totals are normal 7, readiness 8, maintenance 10.
- No schema migration, runtime auto-migration, seed/down migration, standalone Next output, script CSP/nonce, DLQ/re-drive, global limiter, public signup route, Oracle/R2 production deployment, or new API pool owner.
- Cookie-origin protection covers every unsafe cookie mutation and login; read-only probes are exempt. Missing, `null`, malformed, or unapproved Origin is `403 FORBIDDEN` before work.
- No mutation retry on uncertain transport outcomes. No false rollback/cancellation claims.
- Every checkpoint is a hard stop: implementation and review complete, evidence recorded, explicit human acceptance required before the next checkpoint.
- Future implementation uses a dedicated Phase 12 worktree/branch from finalized, published, exactly synchronized master; master remains untouched during implementation; commits are forward-only and separately reviewable. Follow the Future Git Workflow before creating it; nothing here authorizes Git writes in this revision.
- Checkpoint B changes application ingress/auth and fixture tests only: no Caddy, Compose, Dockerfile, production network or image edits. Checkpoint D changes worker runtime/CLI/tests only: no Dockerfile. Production ingress and image health wiring belong exclusively to Task 17/F.
- External documentation is read-only now and throughout A–H and Tasks 22–23. Future Task 24 is the sole scoped exception, after successful Task 22 Gate A ledger and Task 23 cross-check: inspect each listed external document and either update it when applicable or record `INSPECTED — NO UPDATE REQUIRED`; never put external documents in Git or copy them into the repository. Accepted design is never edited.
- Strict credentialed CORS is independent of CookieOriginGuard CSRF enforcement. CORS, Better Auth trustedOrigins and the guard consume the same normalized origins. No wildcard or arbitrary reflection.

## Repository Map

- `packages/config/src/index.ts`: service environment parsing and validation.
- `packages/observability/src/index.ts`: Pino creation/redaction/sanitization.
- `database/src/index.ts`: shared Postgres.js factory; current max 10 must become configurable max 1 without adding owners.
- `apps/api/src/main.ts`, `app.module.ts`, `floz.controller.ts`, `auth.ts`, `health.controller.ts`, `error.filter.ts`: API bootstrap, direct Better Auth calls, all routes, health, errors, and sole API pool ownership.
- `apps/worker/src/main.ts`, `queues.ts`, `recurrence-worker.ts`, `reconciliation.ts`, `outbox-dispatcher.ts`: current worker owners, loops, BullMQ workers, and shutdown.
- `apps/web/next.config.ts`, `apps/web/app/**`, `apps/web/lib/api-client.ts`, `apps/web/lib/auth-context.tsx`: default Next output, boundaries, headers, credentialed auth, logout UX.
- `infra/docker/*.Dockerfile`, `infra/docker-compose.yml`, `infra/Caddyfile`: production artifact, healthcheck, private ingress, and optional Web artifact.
- `database/drizzle/**`, `database/package.json`, `scripts/test-clean-db.ps1`: immutable existing migrations, production dependencies, clean DB verification.
- Existing route inventory is the methods in `apps/api/src/floz.controller.ts` plus `HealthController` and `NotificationController`; implementation must inventory every `POST`, `PUT`, `PATCH`, `DELETE`, including auth, profile, membership/admin, task, recurrence, approval, comment, workflow, and notification paths, then test each category.

## Exhaustive Unsafe Ingress Inventory

`CookieOriginGuard` is global. It admits GET/HEAD/OPTIONS without Origin; it requires one syntactically valid, exact configured Origin for every route below, regardless of cookie presence, because login is pre-session and nonbrowser clients receive no missing-Origin exception. Missing header, duplicate header, empty value, literal `null`, malformed value, wildcard, path-bearing value, credential-bearing value, or unapproved origin returns canonical `403 FORBIDDEN` before controller/auth/service calls. CORS denial alone is never credited as CSRF enforcement.

| Actual method/path | Controller method | Required assignments |
|---|---|---|
| POST `/api/v1/auth/login` | `FlozController.login` | Origin guard + auth limiter |
| POST `/api/v1/auth/logout` | `FlozController.logout` | Origin guard + auth limiter |
| PATCH `/api/v1/me` | `FlozController.updateMe` | Origin guard |
| PATCH `/api/v1/me/password` | `FlozController.changePassword` | Origin guard + auth limiter |
| POST `/api/v1/workspaces/:workspaceId/accounts` | `provisionAccount` | Origin guard + auth limiter |
| PATCH `/api/v1/workspaces/:workspaceId` | `patchWorkspace` | Origin guard |
| POST `/api/v1/workspaces/:workspaceId/members` | `addMember` | Origin guard |
| PATCH `/api/v1/workspaces/:workspaceId/members/:userId` | `patchMember` | Origin guard |
| POST `/api/v1/workspaces/:workspaceId/teams` | `createTeam` | Origin guard |
| PATCH `/api/v1/workspaces/:workspaceId/teams/:teamId` | `updateTeam` | Origin guard |
| POST `/api/v1/workspaces/:workspaceId/teams/:teamId/members` | `addTeamMember` | Origin guard |
| DELETE `/api/v1/workspaces/:workspaceId/teams/:teamId/members/:userId` | `removeTeamMember` | Origin guard |
| POST `/api/v1/workspaces/:workspaceId/workflows` | `createWorkflow` | Origin guard |
| PATCH `/api/v1/workspaces/:workspaceId/workflows/:workflowId` | `updateWorkflow` | Origin guard |
| POST `/api/v1/workspaces/:workspaceId/workflows/:workflowId/set-default` | `setDefaultWorkflow` | Origin guard |
| POST `/api/v1/workspaces/:workspaceId/workflows/:workflowId/archive` | `archiveWorkflow` | Origin guard |
| POST `/api/v1/workspaces/:workspaceId/workflows/:workflowId/restore` | `restoreWorkflow` | Origin guard |
| POST `/api/v1/workspaces/:workspaceId/workflows/:workflowId/statuses` | `addWorkflowStatus` | Origin guard |
| PATCH `/api/v1/workspaces/:workspaceId/workflows/:workflowId/statuses/:statusId` | `updateWorkflowStatus` | Origin guard |
| POST `/api/v1/workspaces/:workspaceId/workflows/:workflowId/statuses/:statusId/set-initial` | `setInitialWorkflowStatus` | Origin guard |
| POST `/api/v1/workspaces/:workspaceId/workflows/:workflowId/statuses/:statusId/archive` | `archiveWorkflowStatus` | Origin guard |
| POST `/api/v1/workspaces/:workspaceId/workflows/:workflowId/statuses/:statusId/restore` | `restoreWorkflowStatus` | Origin guard |
| PUT `/api/v1/workspaces/:workspaceId/workflows/:workflowId/statuses/reorder` | `reorderWorkflowStatuses` | Origin guard |
| PUT `/api/v1/workspaces/:workspaceId/workflows/:workflowId/transitions` | `replaceWorkflowTransitions` | Origin guard |
| POST `/api/v1/workspaces/:workspaceId/tasks` | `createTask` | Origin guard |
| PATCH `/api/v1/workspaces/:workspaceId/tasks/:taskId` | `updateTask` | Origin guard |
| POST `/api/v1/workspaces/:workspaceId/tasks/:taskId/assignments` | `assignTask` | Origin guard |
| DELETE `/api/v1/workspaces/:workspaceId/tasks/:taskId` | `deleteTask` | Origin guard |
| POST `/api/v1/workspaces/:workspaceId/tasks/:taskId/transitions` | `transitionTask` | Origin guard |
| POST `/api/v1/workspaces/:workspaceId/recurring-tasks` | `createRecurringTask` | Origin guard |
| PATCH `/api/v1/workspaces/:workspaceId/recurrence-rules/:id` | `updateRecurrenceRule` | Origin guard |
| POST `/api/v1/workspaces/:workspaceId/recurrence-rules/:id/stop` | `stopRecurrenceRule` | Origin guard |
| POST `/api/v1/workspaces/:workspaceId/approval-requests` | `createApprovalRequest` | Origin guard |
| POST `/api/v1/workspaces/:workspaceId/approval-requests/:approvalRequestId/steps/:stepId/approve` | `approveApprovalStep` | Origin guard |
| POST `/api/v1/workspaces/:workspaceId/approval-requests/:approvalRequestId/steps/:stepId/reject` | `rejectApprovalStep` | Origin guard |
| POST `/api/v1/workspaces/:workspaceId/approval-requests/:approvalRequestId/cancel` | `cancelApprovalRequest` | Origin guard |
| POST `/api/v1/workspaces/:workspaceId/tasks/:taskId/comments` | `createComment` | Origin guard |
| DELETE `/api/v1/workspaces/:workspaceId/tasks/:taskId/comments/:commentId` | `deleteComment` | Origin guard |
| PATCH `/api/v1/workspaces/:workspaceId/notifications/:notificationId` | `NotificationController.markRead` | Origin guard |
| POST `/api/v1/workspaces/:workspaceId/notifications/mark-all-read` | `NotificationController.markAllRead` | Origin guard |

Public `/api/v1/auth/sign-up/email` remains unmounted and must stay 404. All actual GET routes, `/api/v1/health`, `/api/v1/health/live`, `/api/v1/health/ready`, HEAD, and OPTIONS are Origin-guard exempt; authentication/authorization remains independent.

## Canonical TLS Matrix and Current Owner Map

| Production input | Exact expected assertion |
|---|---|
| `DB_SSL=false`, any URL/host | parse/start fails naming `DB_SSL`, no client constructed |
| URL `sslmode=disable`, `allow`, or `prefer`, DB_SSL unset/true | fails before client construction |
| URL `sslmode=require`, DB_SSL unset/true | normalized to explicit CA/hostname verification; certificate and hostname-negative fixtures fail |
| URL no TLS mode or `verify-full`, DB_SSL unset/true | verified TLS with system roots or supplied CA |
| duplicate/contradictory PostgreSQL TLS modes or insecure flags | fails; no precedence fallback |
| `rediss://`, REDIS_TLS unset/true | verified Redis TLS |
| `rediss://`, REDIS_TLS=false | contradiction failure |
| `redis://`, REDIS_TLS=true | explicit verified TLS upgrade |
| `redis://`, REDIS_TLS unset/false in production, including localhost | failure |
| explicitly scoped dev/test localhost plaintext | admitted only in dev/test |

| Owner | Lifetime/cap | Task assertion |
|---|---|---|
| API AuthService and borrowers/readiness | persistent max1; AuthService sole closer | Tasks 2,3,8,9 |
| worker shared recurrence jobs SQL | persistent max1 | Tasks 2,3,11 |
| worker notification due-soon job DB | transient max1, one at concurrency1, job `finally` | Tasks 2,3,11 |
| outbox dispatcher SQL | persistent max1 | Tasks 2,3,11 |
| reconciliation generation SQL | persistent max1 | Tasks 2,3,11 |
| reconciliation notification DB | transient max1, nonoverlapping iteration `finally` | Tasks 2,3,11 |
| reserved claim SQL | persistent max1, reserved session released/unlocked first | Tasks 2,3,11 |
| explicit worker readiness PG | transient max1, single-flight | Tasks 2,3,13 |
| production migration session | transient max1, serialized | Tasks 2,16 |
| serial backup `pg_dump` | one source connection, serialized | Tasks 18,19 |

Totals asserted from instrumented constructors: API persistent 1; worker persistent 4; transient runtime 2; normal 7; plus readiness 8; plus migration and backup 10. API readiness adds zero, Docker health adds zero. Restore's one connection targets a different isolated database.

## Command Legend

**Existing now:** `pnpm --filter @floz/config test`, `pnpm --filter @floz/database test`, `pnpm --filter @floz/api test`, `pnpm --filter @floz/worker test`, `pnpm --filter @floz/worker test:integration`, `pnpm --filter @floz/web test`, `pwsh scripts/test-clean-db.ps1`, `pwsh scripts/test-e2e.ps1`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

Every command naming a Phase 12-only file or script below is **proposed future**, runnable only after that task creates it. RED expectation means the named assertions fail before implementation; GREEN means they pass afterward. No command in this plan is claimed executed.

## Checkpoint A — Configuration, TLS, Database Ownership

### Task 1: Configuration contract and origin normalization

**Files:** Modify `packages/config/src/index.ts`; test `packages/config/test/index.test.ts`; inspect service package scripts.

- [ ] Add strict normalized `ALLOWED_ORIGINS` parsing, agreeing legacy alias handling, exact HTTPS production validation, wildcard/null/path/credential rejection, weak secret rejection, explicit production NODE_ENV, public URL checks, and nonpositive/contradictory timeout rejection.
- [ ] Add tri-state `DB_SSL` and `REDIS_TLS` parsing without converting unset to false; preserve explicitly scoped localhost-only dev/test plaintext.
- [ ] Add failing matrix tests for all Section 13 PostgreSQL/Redis combinations, CA/hostname failures, conflicting origins, missing secrets, weak example values, and production localhost rejection; run `pnpm --filter @floz/config test`.
- [ ] Commit: `feat(config): enforce Phase 12 origins TLS and production configuration`.

### Task 2: Verified TLS normalization across actual clients

**Files:** Modify `database/src/index.ts`, `apps/worker/src/queues.ts`, API/worker config consumers; tests in database/config/worker existing test locations.

- [ ] Implement one shared normalization path consumed by API AuthService, worker persistent/transient clients, readiness clients, migration, and backup clients; preserve verified CA and hostname validation.
- [ ] Reject contradictory URL flags, insecure modes, `DB_SSL=false`, `REDIS_TLS=false` with `rediss://`, plaintext remote production Redis, and all insecure fallback flags.
- [ ] Assert every actual pool owner from the design inventory uses max 1; reject cap/concurrency overrides that exceed the approved budget.
- [ ] Run focused config/database/worker tests. Commit: `feat(database): apply verified TLS and bounded connection ownership`.

### Task 3: Database timeout and owner-budget tests

**Files:** Modify `database/src/index.ts`; add/update database tests and worker/API construction tests.

- [ ] Configure 5-second connect, server-side 10-second statement timeout, 3-second lock timeout, and max 1 without Promise-race-only cancellation.
- [ ] Test API sole AuthService pool, four persistent worker owners, two transient runtime owners, readiness +1, maintenance ceiling 10, and no borrowed-service closure.
- [ ] Run focused database and worker tests; record exact owner counts. Commit: `test(database): prove Phase 12 connection owner budgets and timeouts`.

### CHECKPOINT A — STOP

- [ ] Review configuration/TLS, owner count, security, and compatibility findings; adapt existing approved-origin tests without weakening assertions.
- [ ] Report focused tests, failures, deviations, and clean `git diff --check`/status. Await explicit human acceptance. Later small corrections are separate commits/reports.

## Checkpoint B — API Ingress and Authentication Protection

### Task 4: CookieOriginGuard and route coverage

**Files:** Create `apps/api/src/cookie-origin.guard.ts`; modify `apps/api/src/app.module.ts`, `apps/api/src/floz.controller.ts`; tests `apps/api/test/auth.test.ts` and new ingress coverage.

- [ ] Register one global guard through AppModule. Exempt only GET/HEAD/OPTIONS and explicit safe probes; require exact approved Origin for login, logout, password, provisioning, profile, membership/admin, tasks, recurrence, approvals, comments, workflow, and notification mutations.
- [ ] Return the existing sanitized `403 FORBIDDEN` envelope before Better Auth or business mutation. Preserve Better Auth direct calls and absence of a generic router/public signup.
- [ ] Build an explicit verb/path inventory from controller metadata/source and test missing, `null`, malformed, unapproved, approved, and nonbrowser cookie-client Origins for every unsafe category.
- [ ] Commit: `feat(api): enforce exact origins on unsafe cookie mutations`.

### Task 5: AuthRateLimitGuard and trusted client IP

**Files:** Create `apps/api/src/auth-rate-limit.guard.ts`; modify `apps/api/src/app.module.ts`, `main.ts`, config; tests under `apps/api/test`.

- [ ] Add singleton fixed-window 10 requests/60 seconds map shared by login/logout/password/provisioning; failures consume quota; probes, OPTIONS, and business routes do not.
- [ ] Enforce 10,000-key cap, bounded expiry pruning, no active-key eviction, fail-closed new-key rejection, exact `Retry-After`, normalized IPv4-mapped IPv6, and approved Caddy-only forwarded-header trust.
- [ ] Test 11th denial, expiry, shared accounting, capacity, spoofed chains, direct ingress, and exact `RATE_LIMITED` response. Commit: `feat(api): add bounded single-process authentication rate limiting`.

### Task 6: Strict CORS, API logout, validation and application ingress

**Files:** Modify `apps/api/src/main.ts`, proposed `configure-app.ts`, `error.filter.ts`, `floz.controller.ts`, `auth.ts`, runtime DTOs; tests under `apps/api/test`. No Caddy, Compose, Dockerfile or production network edits; controlled fixture tests only.

- [ ] Configure exact-origin credentialed CORS: approved Origin receives `Access-Control-Allow-Origin` equal to that exact approved Origin and `Access-Control-Allow-Credentials: true`, with `Vary: Origin`; denied/missing/null/malformed/path-bearing/credential-bearing origins receive no CORS allow headers, never `*`. Missing Origin on safe nonbrowser requests remains usable without CORS headers; the independent guard rejects unsafe missing-Origin work.
- [ ] Configure OPTIONS methods exactly `GET, POST, PUT, PATCH, DELETE, OPTIONS`; existing client request headers `Content-Type, Idempotency-Key`, inspected in `apps/web/lib/api-client.ts:322–330,454–458`. Also allow `X-Request-Id`: frozen design Section 8 explicitly accepts this inbound correlation header, implemented in Task 7/C; the final exact allowedHeaders set is `Content-Type, Idempotency-Key, X-Request-Id`. This preserves the accepted contract without adding a new Web header producer. Do not reflect requested headers or add Authorization speculatively; Cookie/Origin are browser-managed, not allowedHeaders entries. Unknown methods/headers cannot receive a permitting preflight; OPTIONS performs no mutation or quota accounting. Better Auth uses the same normalized origins.
- [ ] Set `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`, no implicit conversion; add runtime DTO coverage for inline/type-only payloads without altering Better Auth semantics.
- [ ] Enforce 1 MiB JSON/URL-encoded bodies including parser failures as canonical 413; set Node 10-second headers, 30-second body receive, 5-second idle keepalive; remove X-Powered-By and add API-owned headers. Test narrow Caddy source IP/CIDR trust in the application with controlled peers; no hop-count or arbitrary-private-range trust.
- [ ] Correct actual logout at `apps/api/src/floz.controller.ts:81–87`: inspect `signOut({asResponse:true})` result, require `result.ok` before 204; forward every deletion cookie via Node 22 `result.headers.getSetCookie()` as separate Set-Cookie values, never comma-split/join. Preserve HttpOnly, production Secure, `/api/v1` Path, approved SameSite, Domain if present, Max-Age/Expires and every auxiliary deletion. Failed response/throw remains sanitized non-204; do not invent session invalidation. API auth tests cover multiple deletion cookies, failure, correct attributes and old persisted-cookie `/me` 401 only after success. These production API corrections are complete in B, not Task 15/E.
- [ ] Run real bootstrap CORS/guard/DTO/parser/header/trust and auth fixtures; production forwarded-header replacement, private ingress, API-host HSTS, upstream dial/network proof belong to Task 17/F.
- [ ] Commit: `feat(api): harden strict CORS logout validation and application ingress`.

### CHECKPOINT B — STOP

- [ ] Review all actual unsafe route verbs/paths, guard order, auth coverage, compatibility tightening, and Better Auth behavior. Run focused API tests with approved origins. Await explicit human acceptance.

## Checkpoint C — API Observability, Health, Shutdown

### Task 7: Canonical logs and request correlation

**Files:** Modify `packages/observability/src/index.ts`, API bootstrap/filter, worker logging; tests in observability/API/worker.

- [ ] Add validated single `X-Request-Id` replacement/response propagation; log canonical fields, registered route templates, status, duration, and service without raw URL/query/body/cookies/secrets.
- [ ] Sanitize every logged error to allow-listed `err: { type, code }`; configure exact redaction paths and test root/nested/serialized/bracket `set-cookie` inputs plus URL-bearing driver errors.
- [ ] Ensure one completion or abort event, probe exclusion, and no raw Error object/message/stack/cause. Commit: `feat(observability): add sanitized request and runtime diagnostics`.

### Task 8: Prefixed health/readiness

**Files:** Modify `apps/api/src/health.controller.ts`, AppModule, API service access; tests under `apps/api/test`.

- [ ] Preserve `GET /api/v1/health`; add `/api/v1/health/live` process-only and `/api/v1/health/ready` PostgreSQL-only readiness, no root aliases.
- [ ] Use no-store, sanitized 503, 2-second dependency probe/3-second total invocation, no Redis/new API pool, no limiter/CSRF consumption, bounded cleanup, and rate-controlled failure logs.
- [ ] Test stopping state, timeout, pool wait, cleanup, successful readiness, and probes staying outside ingress guards. Commit: `feat(api): add prefixed liveness and database readiness endpoints`.

### Task 9: API shutdown coordinator

**Files:** Create `apps/api/src/api-shutdown-coordinator.ts`; modify `apps/api/src/main.ts`, `app.module.ts`, `auth.ts`; tests/integration harness under `apps/api/test`.

- [ ] Own SIGINT/SIGTERM exclusively; atomically mark not-ready, start 35-second outer deadline, close idle sockets/server, drain admitted work to 30 seconds, call `app.close()` once, and let AuthService close the sole pool.
- [ ] Make repeated signals/idempotent server close share one operation; exit 0 only cleanly, exit 1 on forced sockets, cleanup error, or outer timeout; avoid `enableShutdownHooks` duplicate ownership.
- [ ] Test ordering, long request drain, repeated signal, forced socket path, pool hook timing, and exact 30/35-second boundaries without claiming mutation cancellation. Commit: `feat(api): add bounded ordered shutdown coordination`.

### CHECKPOINT C — STOP

- [ ] Review observability leaks, health ownership, shutdown ordering, and error-envelope compatibility. Await explicit human acceptance.

## Checkpoint D — Worker Runtime, Replay, Health, Readiness

### Task 10: Queue policy and reconnect diagnostics

**Files:** Modify `apps/worker/src/queues.ts`, config, diagnostic CLI location selected from existing package scripts; tests under `apps/worker/test`.

- [ ] Preserve actual recurrence queue wiring; apply attempts 3, exponential delay 1000, remove completed, failed count 100/age 604800; do not invent notification queue or DLQ.
- [ ] Keep `maxRetriesPerRequest: null`; cap reconnect jitter at 5 seconds; log sanitized state transitions, not attempts; add bounded read-only failed-job diagnostic with no payload/re-drive.
- [ ] Test policy, TLS, failure retention semantics, and diagnostic non-mutation. Commit: `feat(worker): bound queue policy and dependency diagnostics`.

### Task 11: Worker shutdown and owner lifecycle

**Files:** Modify `apps/worker/src/main.ts`, `recurrence-worker.ts`, `reconciliation.ts`, `outbox-dispatcher.ts`; tests under `apps/worker/test`.

- [ ] Add one coordinator: mark not-ready, stop both loops promptly, drain workers with `close(false)`, close queues/Redis, then close each owned DB resource; bound graceful/outer shutdown at 30/35 seconds.
- [ ] Preserve replay semantics and BullMQ cached-close behavior; do not fake `close(true)` escalation. Ensure notification job clients finally close and claim session unlocks before pool close.
- [ ] Test long jobs, hung loops, forced cleanup, repeated signals, worker close ordering, and replay after interruption. Commit: `feat(worker): add bounded ordered shutdown and replay-safe cleanup`.

### Task 12: Heartbeat and local-only health CLI

**Files:** Create worker heartbeat/health modules and CLI; modify worker startup; add worker runtime/CLI fixture tests only. No Dockerfile, Compose or image wiring.

- [ ] Atomically remove stale prior-instance state before healthy initialization; write identity/timestamp/initialized/stopping/progress every 15 seconds; invalidate wrong-instance, malformed, future, stale >45-second, stopping, or stuck-progress state. Runtime path contract is `/run/floz-worker`; tests inject a private temporary equivalent rather than requiring image wiring.
- [ ] Mark stopping/remove heartbeat before drain. CLI reads only local state: no DB, Redis, network, or temporary pool. Task 17 creates the tmpfs/image ownership and Docker HEALTHCHECK wiring with interval 30s/start period 30s/timeout 5s/retries 3.
- [ ] Test idle initialized health, remote outage degraded health, stale cleanup ordering, wrong identity, malformed state, shutdown, hung progress, process/start identity and zero-network command tracing. Commit: `feat(worker): add instance-aware local health and heartbeat`.

### Task 13: Explicit worker dependency readiness

**Files:** Create worker readiness CLI/host single-flight module; modify config/package scripts only as needed; tests under worker.

- [ ] Require current local health, then concurrently probe PostgreSQL and Redis with 2 seconds each/3 seconds overall, bounded cleanup, one temporary PG owner, private bounded Redis connection, and recheck before success.
- [ ] Permit only explicit/operator/deployment/approved Phase 13 cadence invocation; never Docker health or unconditional timer. Fail closed on timeout, stale state, dependency failure, cleanup failure, or overlapping invocation.
- [ ] Test single-flight cleanup admission, TLS failure, both dependencies, and no abandoned replacement work. Commit: `feat(worker): add explicit bounded dependency readiness`.

### CHECKPOINT D — STOP

- [ ] Review worker ownership totals, replay/failure semantics, heartbeat/local-vs-remote distinction, and no probe spam. Await explicit human acceptance.

## Checkpoint E — Web Hardening

### Task 14: Next-owned production headers and CSP baseline

**Files:** Modify `apps/web/next.config.ts` and existing Web header configuration; tests/served-response harness under `apps/web`.

- [ ] Preserve default Next output and test `distDir`; add exactly base-uri/object-src/frame-ancestors CSP baseline, nosniff, DENY, strict-origin-when-cross-origin, HSTS without preload/includeSubDomains.
- [ ] Ensure Next is the sole Web header owner; test served headers and hydration under controlled credentialed origins. Commit: `feat(web): add Next-owned production security headers`.

### Task 15: Accessible boundaries and unknown auth outcomes

**Files:** Create only required existing Next root/segment error boundary files; modify `apps/web/lib/api-client.ts`, `auth-context.tsx`; tests under Web. Do not modify `apps/api/src/floz.controller.ts` or API logout behavior; Task 6/B owns that correction and its cookie tests.

- [ ] Add accessible root/segment recovery UI with alert/status semantics, keyboard focus and explicit retry/reload controls while preserving server conflict/authorization codes.
- [ ] In auth context, distinguish confirmed logout success, confirmed failure and unknown transport outcome. Never clear local session as proof after failed/unknown mutation; never auto-retry logout or any mutation. Unknown outcome offers a user-triggered `/me` authoritative recovery read; a successful `/me` preserves/restores session, a 401 confirms signed-out state, other read failures remain unknown. Boundary reset/reload performs reads/rerender only.
- [ ] Test credentialed login/me/logout consumption, failed logout, transport loss, no repeated POST, manual `/me` recovery and accessible boundaries. API deletion-cookie forwarding/attributes remain Task 6 tests. Commit: `fix(web): preserve unknown auth outcomes and accessible recovery`.

### CHECKPOINT E — STOP

- [ ] Review accessibility, header ownership, CSP compatibility, and mutation retry behavior. Await explicit human acceptance.

## Checkpoint F — Compiled Migration and Container Artifacts

### Task 16: Compiled session-locked migration runner

**Files:** Create `database/src/migrate.ts`; modify `database/package.json`/tsconfig and build wiring; create/update migration tests only, no SQL migration.

- [ ] Compile to `database/dist/migrate.js`; use production migrator dependencies and checked-in SQL/journal; no drizzle-kit/tsx/source in runner.
- [ ] Use dedicated direct verified-TLS max1 client, fixed environment/database-scoped `pg_try_advisory_lock`, same-session migration/unlock, backend PID continuity, no idle/lifetime recycling, 60-second outer cap, failclosed disconnect/lock contention.
- [ ] Test clean/populated/rerun/noop, competing runner, session loss, PID continuity, timeout, and unchanged migration history. Commit: `feat(database): add compiled session-locked production migrator`.

### Task 17: Multiarch production images and Caddy composition

**Files:** Modify `infra/docker/api.Dockerfile`, `worker.Dockerfile`, `web.Dockerfile`, `infra/docker-compose.yml`, `infra/Caddyfile`; add only required build/verification scripts. May wire Task 12's `/run/floz-worker` tmpfs and `HEALTHCHECK --interval=30s --start-period=30s --timeout=5s --retries=3 CMD ["node","apps/worker/dist/health.js"]` here, not earlier.

- [ ] **Mandatory first action, before Task 17 executable implementation:** complete the ARM64 capability preflight below; unavailable local runtime requires STOP at Checkpoint F before requesting the exact separately authorized CI mechanism/push workflow.
- [ ] Use official Node 22 Debian slim with real reviewed multiarch digest/tag/provenance evidence, frozen pnpm lock, correct workspace build order, production dependency closure, non-root runtime, CA certificates, no secrets, correct entrypoints. Validate native dependencies and each emitted executable path on both architectures.
- [ ] Keep Next default output including optional Docker Web; do not publish API publicly. Caddy discards inbound Forwarded/X-Forwarded-* headers, replaces them from actual socket/TLS state, trusts only the approved Caddy source boundary, has 5-second upstream dial and no business response deadline; Caddy alone owns API-host HTTPS HSTS and prefixed readiness routing.
- [ ] Before any Task 17 executable work, run the local ARM64 capability preflight: verify registered Buildx ARM64 support and binfmt/QEMU; run a known trusted, pinned minimal `linux/arm64` image and assert `uname -m` is `aarch64` or `arm64`, non-root execution works, and the runtime exits successfully. Manifest inspection/cross-build is insufficient. If local runtime is unavailable, STOP at Checkpoint F and request explicit human authorization naming the exact CI mechanism and push workflow; do not proceed on an implied CI assumption.
- [ ] `.github/workflows/ci.yml` has no multiarch runtime policy. A proposed `.github/workflows/phase12-multiarch-smoke.yml` may remain an intended future mechanism only; creating it does not authorize pushing the implementation branch and does not prove CI availability. No implicit branch push.
- [ ] With local ARM64 capability approved, or after the preflight STOP with an explicitly authorized and available equivalent CI mechanism, build and runtime-smoke linux/amd64 and linux/arm64 with non-root UID, native dependencies, CA tools, exact digest/tag/provenance, API, worker local health, migrator, Web and backup once G exists. Record exact implementation SHA, image tag/digest, runtime architecture, non-root UID, API/worker local health/migrator/Web/backup evidence, and age/pg/CA/native exit codes. Commit: `build(infra): package reproducible non-root multiarch runtime artifacts`.

### CHECKPOINT F — STOP

- [ ] Review migration lock/session evidence, artifact closure, digest/provenance, ingress isolation, and architecture runtime results. Await explicit human acceptance.

## Checkpoint G — Backup Fixture and Restore

### Task 18: Encrypted backup pipeline

**Files:** Create backup utility/test harness in the existing infra/tooling convention; modify image packaging only for selected pinned age/pg/S3 tools.

- [ ] Stream serial `pg_dump --format=custom` with libpq `sslmode=verify-full` into pinned age X25519 recipient encryption; hash encrypted bytes SHA-256; allow only restricted encrypted staging; clean it on every path.
- [ ] Pin the fixture server using bounded candidate `minio/minio:RELEASE.2025-04-22T22-12-26Z`, not floating local MinIO. Before Task 18 implementation, verify official release provenance, availability and both architecture manifests; resolve and record the immutable manifest digest and per-platform digests, then use `tag@sha256:<verified manifest digest>` in the fixture. This is an unverified candidate, not a claimed available/safe pin. Missing release, provenance, digest or runtime compatibility: STOP before implementation for human approval; no silent substitution.
- [ ] Use S3 client candidate `minio/mc:RELEASE.2025-08-13T08-35-41Z`, copying the matching verified architecture binary into the Debian backup image. Reinspection of that exact release's `Dockerfile.release` confirms architecture-specific download but contains no checksum/signature verification; prior verification claims are not evidence. Before implementation, independently verify official provenance and checksums/signatures for both binaries and record exact version, checksums and source digest. If bounded verification cannot establish trust/availability, STOP for human approval; no floating tag, SDK, custom signer or silent alternative.
- [ ] The isolated fixture runs MinIO `server /data` at explicit `http://minio:9000` on a private disposable network with no public port; this fixture-only HTTP endpoint never weakens PostgreSQL verify-full or production TLS. Generate disposable administrator credentials supplied only to MinIO via private secret files referenced by `MINIO_ROOT_USER_FILE`/`MINIO_ROOT_PASSWORD_FILE`; create separate scoped upload/verify, retention-delete and restore-read credentials. Supply each client a private temporary `mc --config-dir` configuration via `mc alias set fixture <endpoint> <access-key> <secret-key> --api S3v4 --path on`, with subprocess arguments/output excluded from logs and config removed on every path. Reject missing/non-allow-listed endpoint or production credentials before work. Upload with `mc cp <encrypted-stage> fixture/<private-backup-bucket>/postgres/<environment>/<backup-id>.dump.age`, download with `mc cp fixture/<private-backup-bucket>/postgres/<environment>/<backup-id>.dump.age <private-download>`, and compare local SHA-256 of both encrypted files. Metadata publication and last-success occur only after equality; never trust ETag.
- [ ] Check pg_dump, age, hash, upload, remote download/hash, metadata publication, and last-success updates independently; metadata excludes secrets/plaintext/private identity; use dedicated `postgres/<environment>/` fixture prefix and separated credentials.
- [ ] Test dump/encryption/upload/hash/metadata failures, corruption, no last-success displacement, 7 daily/4 weekly retention, age identity separation, endpoint/credential misuse and no actual R2 credentials. Commit: `feat(backup): add encrypted PostgreSQL backup pipeline`.

### Task 19: Disposable isolated restore fixture

**Files:** Extend backup fixture tests/tooling; no production deployment files beyond required packaging.

- [ ] Download/hash encrypted artifact, decrypt with separately supplied identity, restore serially using `pg_restore --exit-on-error --no-owner --no-privileges` into a new isolated DB, remove temporary decrypted archive.
- [ ] Verify migration journal, representative relations/counts, constraints, sessions/accounts, workspace isolation, outbox, notification deduplication; record elapsed fixture recovery without claiming RTO proof.
- [ ] Run both amd64/arm64 age and PostgreSQL tool round-trips. Commit: `test(backup): verify isolated encrypted restore and retention fixtures`.

### CHECKPOINT G — STOP

- [ ] Review cryptographic/access separation, plaintext cleanup, corruption/failure behavior, integrity assertions, and multiarch tooling. Await explicit human acceptance.

## Checkpoint H — Crosscutting Verification and Regression

### Task 20: Failure replay and queue/database integration

**Files:** Extend `apps/worker` and database integration tests around `database/src/outbox.ts`, `database/src/notification-core.ts`, `apps/worker/src/generate-due-occurrence.ts`.

- [ ] Exercise outbox claim fencing, DB commit before dispatch mark, stale lease ownership, Redis add/ack loss, SIGTERM/forced interruption, stalled replay, and recurrence duplicate races.
- [ ] Assert stable event identity, no duplicate notifications/tasks, preserved pending/retry state, and no exactly-once claim. Commit: `test(worker): prove replay safety across dependency and shutdown failures`.

### Task 21: Full real-stack regression

**Files:** Existing Phase 9/10/11 test files plus new Phase 12 integration harness only where required.

- [ ] Run full API/Web/database/worker E2E across admin/auth, collaboration, workflow/archive, credentialed origins, CSP hydration, and served header ownership; update tests to approved origins, never disable assertions.
- [ ] Verify no Phase 9 files or existing migration SQL changed. Commit: `test: cover Phase 12 compatibility across existing product flows`.

### CHECKPOINT H — STOP

- [ ] Review requirements, code quality, security, accessibility, concurrency, replay, and compatibility findings; resolve only small corrections in separately reported commits. Await explicit human acceptance.

## Checkpoint I — Final Gate A Documentation

### Task 22: Gate A execution ledger

**Files:** Create `docs/superpowers/evidence/2026-09-11-phase-12-gate-a.md` only after future implementation and only if internal evidence documentation is explicitly authorized; no external documentation. Task 22 is the sole ordered Gate A execution ledger before Task 23 and Task 24.

- [ ] Run and record this exact order with command, immutable implementation SHA, immutable image tag/digest where applicable, environment/fixture identity, runtime architecture, non-root UID where applicable, pass/fail/BLOCKED, elapsed time, and scenario count: (1) existing `pwsh scripts/test-clean-db.ps1`; (2) existing config/API security focused suites plus proposed ingress/config matrix suites; (3) proposed API resilience/shutdown suites; (4) existing worker integration plus proposed replay/health/readiness suites; (5) proposed migration suite; (6) proposed controlled backup fixture suite with backup age and pg evidence; (7) existing `pwsh scripts/test-e2e.ps1`; (8) existing `pnpm lint`; (9) existing `pnpm typecheck`; (10) existing `pnpm test`; (11) existing `pnpm build`; (12) proposed amd64 build/runtime smoke with API/worker local health/migrator/Web/backup and CA/native exit evidence; (13) arm64 gate only when local ARM64 runtime is approved capable or separately authorized CI is explicit and available, with API/worker local health/migrator/Web/backup and CA/native exit evidence; (14) `git status --short`, `git diff --check`, secret scan command selected from installed tooling, and artifact/repository hygiene.
- [ ] Treat every required scenario as executed evidence. No skipped scenario. An unresolved timeout is recorded as unresolved, not pass/fail. Gate B evidence is excluded.
- [ ] Any executable correction after any Gate A step restarts at step 1. Documentation-only correction after step 14 is separately reported and does not rerun runtime gates.
- [ ] Proposed commit after explicit future authorization: `docs: record Phase 12 Gate A evidence`.

### Task 23: Gate A internal closure review

**Files:** Modify only authorized internal Gate A evidence and Phase 12 plan status after all Task 22 evidence is complete; never alter accepted design.

- [ ] Independently cross-check every coverage-matrix row against recorded scenario evidence, every owner total (7/8/10), every unsafe route inventory row, digest/provenance, fixture-only backup scope, and exclusions.
- [ ] Record failures/blockers verbatim-safe without secret values. Gate A may be presented for human acceptance only if every required deterministic engineering scenario has evidence; it must not claim Gate B, provider quota, production archive, real domain, actual-environment restore, RPO, or RTO.
- [ ] Proposed commit after explicit future authorization: `docs: close Phase 12 Gate A evidence review`.

### Task 24: Post-Gate-A documentation synchronization and publication plan

**Files:** Future-only, after Tasks 22 and 23: internal `docs/implementation/PHASE_12_REPORT.md`, `IMPLEMENTATION_STATUS.md`, `CURRENT_HANDOFF.md`, `docs/decisions/OPEN_DECISIONS.md`, and `docs/superpowers/evidence/2026-09-11-phase-12-gate-a.md` only. External future inspection and applicable-update targets under `D:\Portofolio\Floz\Documentation`: `Technical/Floz_API_Specification.md`, `Technical/Floz_ERD_Database_Design.md`, `Technical/Floz_Technical_Design_Architecture.md`, `Technical/Floz_Technical_Design_Architecture_Free_Bootstrap.md`, `Design/Floz_Wireframe_UI_Specification.md`. Never Git-track, copy, or commit external documents.

- [ ] Execute only after the Gate A evidence ledger is complete and Task 23 cross-check is complete; no runtime rerun for documentation-only work. Record each external target as `UPDATED` or `INSPECTED — NO UPDATE REQUIRED`; ERD must be `INSPECTED — NO SCHEMA UPDATE REQUIRED` unless a separately authorized schema decision exists, which this plan does not provide.
- [ ] Create/update internal `PHASE_12_REPORT`, `IMPLEMENTATION_STATUS`, `CURRENT_HANDOFF`, and `OPEN_DECISIONS` with exact `CURRENT`, `HANDOFF`, `OPEN_DECISIONS`, evidence path, accepted contracts, commit/task/config/TLS/route-inventory/security/shutdown/health 7/8/10/migration/multiarch/backup fields, Gate A limitations, and explicit `Gate B not run`; do not claim runtime verification not evidenced.
- [ ] Inspect and update when applicable the five external documents only for consistency with accepted Gate A facts; each must be `UPDATED`, `INSPECTED — NO UPDATE REQUIRED`, or for ERD `INSPECTED — NO SCHEMA UPDATE REQUIRED`. Never copy them into the repository, never edit the ERD schema, and never alter external docs before this task. Proposed commits are separate: `docs: record Phase 12 Gate A evidence`, `docs: close Phase 12 Gate A evidence review`, then a future docs-only internal publication commit after human authorization; implementation publication is distinct and not authorized here.
- [ ] Commit: `docs: synchronize Phase 12 post-gate documentation` only after explicit future authorization and clean separation from implementation publication.

### CHECKPOINT I — STOP

- [ ] Order is Task 22 ledger, Task 23 cross-check, Task 24 documentation, then final human acceptance. Gate A is not passed by this plan; Gate B remains Phase 13 operational acceptance.

## Future Git Workflow

This is a future docs-baseline publication sequence, not authority to commit, fetch, push or create a worktree during this revision. Implementation publication remains a separate later authorization.

1. This plan's FINAL status approves its content only, not implementation or Git actions. Next obtain explicit human setup authorization for this docs commit, docs-baseline synchronization/publication and branch/worktree creation, then retain FINAL status in a docs-only change on `master`. Verify frozen design commit `d2b1a62001b2e038a73abf67df28c9b2fc37653d` remains an ancestor, inspect status/diff/recent log, stage only finalized plan documentation, and commit `docs: finalize Phase 12 production hardening implementation plan`. Require clean master afterward.
2. Verify both fetch/push origin are exactly `https://github.com/AnandaDwiLaksono/Floz.git`; fetch `origin`, require `origin/main` remains expected `b4a03d7dce10fb87714fde80a37c8035f998f1e0` unless a human explicitly approves an updated baseline, and require `git merge-base --is-ancestor origin/main master` succeeds. Local master legitimately includes the finalized design/plan docs commits ahead of origin; do not require equality before the docs push. Unexpected remote revision, divergence, remote commits not ancestral to master, dirty tree or changed design: STOP; no reset/rebase/rewrite/force push.
3. Publish this docs baseline only with normal `git push origin master:main`. Fetch again; require equal `git rev-parse master` and `git rev-parse origin/main`, and `git rev-list --left-right --count master...origin/main` exactly `0 0`, plus clean master. Any failure or unexpected concurrent remote advance: STOP, do not create the worktree.
4. Only then create future branch `phase12-production-hardening` in worktree `D:\Portofolio\Floz\phase12-production-hardening` from the exact synchronized HEAD; verify branch/worktree do not already exist, correct parent directory, identical baseline HEAD, and clean status. No earlier worktree creation.
5. After setup, obtain explicit human authorization for Checkpoint A only, not all 24 tasks. Execute 24 tasks across hard-stop checkpoints A–I incrementally with forward-only reviewed commits on that dedicated branch; every checkpoint stops for human acceptance before the next is authorized. Master stays untouched during implementation. No implementation merge/push/publication, history rewrite or worktree deletion without distinct human authorization; docs-baseline publication never implies implementation publication. Canonical ARM64 execution is local Docker Buildx/binfmt/QEMU after Task 17 capability preflight. If unavailable, STOP at Checkpoint F and request separate authorization naming the exact CI mechanism and any implementation-branch push/ref/invocation; a proposed or created workflow is not authorization and does not establish CI availability. Only that explicitly scoped CI exception may permit a pre-final implementation push; otherwise implementation publication requires distinct final human authorization.

## Task Execution Annex — Exact Paths, RED Checks, and Review Boundaries

This annex supplies exact paths/commands wherever a checkpoint summary uses a category. Every task follows: write named failing assertion; run focused command and confirm meaningful RED (not missing infrastructure); implement minimal behavior; rerun focused command; run existing `pnpm lint` and `pnpm typecheck`; review requirements/security/compatibility; inspect `git status`, `git diff`, `git log --oneline -10`; stage only reviewed task paths; commit with its proposed message. No task or checkpoint is automatically accepted by green tests. Do not change accepted design or historical Phase 9 documents/worktree. Existing Phase 9 regression test clients may receive the expressly required approved-Origin adaptation without changing their policy/assertions.

### Tasks 1–3: exact additions and contract tests

**Task 1 files:** `packages/config/src/index.ts`, `packages/config/test/index.test.ts`, proposed `packages/config/test/production-env.test.ts`. Expose service parsers plus proposed `parseDatabaseEnv(env)` and `parseMigrationEnv(env)`; preserve existing parser exports. Return validated origins and normalized database/Redis options, never raw validation values in errors. `parseWebEnv` must succeed without DATABASE_URL/Redis/auth secrets. API requires DB/auth/origins but not Redis; worker requires DB/Redis but not auth secrets. Production `BETTER_AUTH_SECRET` must encode at least 32 generated random bytes; reject weak repeated/example values without claiming entropy can be proven from arbitrary strings. CA paths/material are operator supplied and never logged.

**Task 1 RED assertions:** agreeing singleton legacy/new origin sets parse equally; disagreement throws with key names only; invalid boolean spelling throws; unset remains undefined until transport policy; `NODE_TLS_REJECT_UNAUTHORIZED=0` fails production; each TLS matrix row is table-tested, including unknown mode, duplicate conflicting mode, remote and localhost hosts. Exact command (proposed test): `pnpm --filter @floz/config exec vitest run test/production-env.test.ts`.

**Task 2 files:** `database/src/index.ts`, `database/package.json`, `apps/api/src/auth.ts`, `apps/worker/src/main.ts`, `apps/worker/src/recurrence-worker.ts`, `apps/worker/src/reconciliation.ts`, `apps/worker/src/queues.ts`; proposed `database/test/connection-policy.test.ts`. Add existing-workspace `@floz/config` dependency to database if importing its normalization there; no dependency cycle. Preserve `createDatabase(url)` callers while ensuring production consumes validated policy before constructing any owner. Keep fixed max1, not an adjustable high-cap setting. `AuthService` obtains identical allowed origins for Better Auth and CORS. All four persistent and two transient worker constructors receive normalized policy; due-soon handler still owns its separate job client. Readiness/migration/backup consumers are wired in their later tasks, not prematurely created in A.

**Task 2 RED assertions:** captured postgres options have max1/connect_timeout5/verified ssl and statement/lock connection settings; reject bad certificate chain and hostname on controlled TLS endpoints. Redis options retain maxRetriesPerRequest null only on BullMQ runtime connections. Command: `pnpm --filter @floz/database exec vitest run test/connection-policy.test.ts` (proposed test).

**Task 3 files:** proposed `database/test/resource-bounds.integration.test.ts`, `apps/worker/test/owner-budget.test.ts`; modify `database/src/index.ts` only if bounds tests expose missing admission cleanup. Business pool wait is at most 5 seconds: reject/cancel queued acquisition before it can later execute a mutation; retain accepted in-flight work semantics. A promise timeout alone that leaves queued work alive fails. Reserved claim session must not share its max1 with generation work; loss of reserved session is fatal rather than continued lockless work.

**Task 3 RED assertions:** server reports statement_timeout=10000 and lock_timeout=3000; sleep/lock-contention queries time out server-side; exhausted pool rejects queued work at5s and later releasing the pool does not execute it. Count exact 7/8/10 owners and reject concurrency>1. Command: `pnpm --filter @floz/database exec vitest run test/resource-bounds.integration.test.ts`; `pnpm --filter @floz/worker exec vitest run test/owner-budget.test.ts` (proposed tests). Review boundary A proves current runtime ownership; future temporary owners receive final integrated count proof in H.

### Tasks 4–6: exact DTO and test-harness adaptations

**Task 4 files:** proposed `apps/api/src/cookie-origin.guard.ts`, `apps/api/test/production-ingress.integration.test.ts`; existing `app.module.ts`, `floz.controller.ts`, `notification.controller.ts`, `apps/api/test/auth.test.ts`, `api.test.ts`, `notification.test.ts`, `approval-api.test.ts`, `comment-api.test.ts`, and other API test callers identified by unsafe HTTP methods. Register via `APP_GUARD` once; method-level auth limiter is not `APP_GUARD`. Keep unmounted signup 404 by testing it with an approved Origin. All 40 inventory rows are required, not category samples. Approved-Origin requests retain original 401/403/404/409/422 and success assertions. Test app construction currently bypasses production pipes/filter in `auth.test.ts:15–21`; proposed `apps/api/src/configure-app.ts` is a shared bootstrap configurator consumed by main and real ingress test harnesses so parser/CORS/pipes/filter tests are production-real, with no test guard disablement.

**Task 5 files:** proposed `apps/api/src/auth-rate-limit.guard.ts`, `apps/api/test/auth-rate-limit.test.ts`; existing AppModule/FlozController/config. Four method decorators share one injected provider. Use timer disposal on module destroy and fake-clock tests. Quota counts admitted calls including auth failures, not Origin-rejected calls. Assert exact Retry-After formula for 1ms,1001ms,60000ms remaining; exhausted key uses own expiry, map capacity uses earliest expiry; sweep every60000ms; at cap prune expired keys before refusing new keys. Command: `pnpm --filter @floz/api exec vitest run test/auth-rate-limit.test.ts` (proposed).

**Task 6 files:** existing `main.ts`, proposed `configure-app.ts`, existing `error.filter.ts`, `floz.controller.ts`, `task.service.ts`, `workflow.dto.ts`, `approval.dto.ts`, `comment.dto.ts`, `recurrence.dto.ts`, `notification.dto.ts`; proposed `apps/api/src/ingress.dto.ts`, `apps/api/test/payload-validation.test.ts`. Use installed class-validator/class-transformer, not new validation dependency. Controller imports of decorated approval/comment DTOs must be runtime imports, not `import type`. Workflow and task DTOs are interfaces; replace boundary types with runtime classes or explicit validators preserving nested shapes. Inline auth/profile/member/team bodies get concrete DTOs. Enumerate allowed keys from inspected definitions: task assignees `{user_id,is_primary}`, workflow statuses `{name,code,category,is_initial}`, transition inputs `{from_status_code,to_status_code}` and bulk `{from_status_id,to_status_id,requires_permission}`. Preserve notification aliases `is_read`/`isRead` and required true semantics. Preserve recurrence explicit `@Transform` active and `@Type` query limit; no global implicit conversion. Keep business semantic errors such as inactive approver/version conflict distinct from wrong JSON types.

**Task 6 RED checks:** unknown nested keys and string boolean/number bodies return400; existing explicitly parsed query values still work. Add empty-body mutation unknown-key rejection where applicable. Oversized body returns exactly `{error:{code:'PAYLOAD_TOO_LARGE',message:'Request body is too large.',details:[]}}`. Malformed JSON below limit is400 VALIDATION_ERROR, not413. Configure custom parsers before default parser can reject with a different envelope (Nest bodyParser:false plus explicit JSON/urlencoded parsers). Command: `pnpm --filter @floz/api exec vitest run test/payload-validation.test.ts test/production-ingress.integration.test.ts` (proposed). Proxy controlled-network proof is finalized in F/H; B validates trust predicate with untrusted peer/forwarded headers without claiming deployed isolation.

### Tasks 7–9: exact observability and API lifecycle files

**Task 7 files:** `packages/observability/src/index.ts`; proposed `packages/observability/test/production-logging.test.ts`, `apps/api/src/request-logging.ts`, `apps/api/test/request-logging.test.ts`; `apps/api/src/error.filter.ts`, `configure-app.ts`, `apps/worker/src/main.ts`. Proposed `sanitizeError(error: unknown): {type:string;code:string}` returns fixed allow-listed classifications; never includes arbitrary driver strings. Match inbound ID `^[A-Za-z0-9_.:-]{1,128}$` and inspect duplicate raw headers, not only normalized Express headers. Use crypto.randomUUID for invalid/multiple/missing input; one finish/close completion event; fixed unmatched marker instead of raw path. Fields requestId/jobId/workspaceId/entityId/service plus method/registered route/statusCode/durationMs when available; native Pino time/level retained.

Redaction paths are exactly: `req.headers.authorization`, `req.headers.cookie`, `req.headers["set-cookie"]`, `res.headers["set-cookie"]`, `headers.authorization`, `headers.cookie`, `headers["set-cookie"]`, `password`, `current_password`, `new_password`, `temporary_password`, `token`, `secret`, `session`, `credential`, `credentials`, `authorization`, `cookie`, `["set-cookie"]`, `data.password`, `data.temporary_password`, `body.password`, `body.currentPassword`, `body.newPassword`, `err.message`, `err.stack`, `err.cause`; censor `[REDACTED]`. Explicit plain-object error serializer must preserve `{type,code}` rather than Pino default Error normalization.

**RED assertions:** actual destination stream JSON has exactly safe err keys; injected URL/password/SQL/stack/cookie canaries absent from all serialized lines; root/nested redaction cases emit censor; request IDs valid length1/128 retained,129/duplicate/invalid replaced; abort+finish yields one log; probes zero completion lines. Commands: `pnpm --filter @floz/observability exec vitest run test/production-logging.test.ts`; `pnpm --filter @floz/api exec vitest run test/request-logging.test.ts` (proposed files).

**Task 8 files:** `apps/api/src/health.controller.ts`, proposed `apps/api/src/readiness.service.ts`, `apps/api/test/readiness.test.ts`, existing `apps/api/test/health.test.ts`; wire AppModule. `ReadinessService.check(): Promise<boolean>` borrows AuthService SQL, one pending probe including queued acquisition, cancels timed-out query, admits no replacement until cancellation settled, no new DB/Redis client. Deadline gives sanitized503 by3s; no healthy result before cleanup. Commands: `pnpm --filter @floz/api exec vitest run test/health.test.ts test/readiness.test.ts` (mixed existing/new). RED assert no-store on all probes; health response remains current cheap shape, no root alias; stop before successful PG completion forces503.

**Task 9 files:** proposed coordinator, `apps/api/test/shutdown.integration.test.ts`, proposed `apps/api/test/fixtures/api-shutdown-child.mjs` (plain Node fixture imports actual compiled coordinator); existing `main.ts`, `configure-app.ts`, `auth.ts`, AppModule. `ApiShutdownCoordinator.stop(): Promise<void>` is memoized and exposes stopping read-only to admission/readiness. Node server stop-new-admissions includes existing keepalive connections; do not close pool while admitted requests run. Exact production API artifact is `apps/api/dist/src/main.js` from package start script; child fixture is launched by `node apps/api/test/fixtures/api-shutdown-child.mjs`, importing compiled code with injected event recorder only in fixture. Integration test command builds prerequisite package before Vitest. Run real signal cases under Linux container/native runner; Windows process kill is not treated as POSIX SIGTERM evidence. Fake timers prove exact boundaries, real process proves handlers/wiring, host watchdog35 is final fallback.

### Tasks 10–13: exact runtime/CLI artifacts

**Task 10 files:** `apps/worker/src/queues.ts`, proposed `apps/worker/src/failed-jobs.ts`, `apps/worker/test/queue-policy.test.ts`, `apps/worker/test/failed-jobs.test.ts`; `apps/worker/src/outbox-dispatcher.ts`. Read-only CLI `node apps/worker/dist/failed-jobs.js` requests at most100 failed rows, returns only jobId/type/status/safe code/timing, bounded connect/cleanup and sanitized errors. Never prints failedReason/stacktrace/payload or calls retry/remove. Runtime currently creates recurrence queue only; optional notificationQueue is not supplied. Exact queue policy applies at actual enqueue owner; failed age cleanup lifecycle-triggered. Commands: `pnpm --filter @floz/worker exec vitest run test/queue-policy.test.ts test/failed-jobs.test.ts` (proposed). RED asserts attempts3/delay1000/completed true/failed count100 age604800; reconnect delay never>5000; state transition logs not each retry.

**Task 11 files:** `apps/worker/src/main.ts`, `reconciliation.ts`, `recurrence-worker.ts`, `outbox-dispatcher.ts`; proposed `apps/worker/src/shutdown.ts`, `apps/worker/test/production-runtime.test.ts`, `apps/worker/test/fixtures/worker-shutdown-child.mjs`. Preserve actual owners while separating stop-request from drain completion and pool disposal; both workers close(false) are requested promptly. Do not let one hung loop prevent another stop request. Real fixture imports `apps/worker/dist/main.js`/`shutdown.js`, executes actual BullMQ5.81.3 cached close behavior, records safe close order, kills/restarts active worker against disposable DB/Redis. Test actual non-escalation by leaving close(false) pending then calling close(true): second call cannot complete first close. No worker internal mutation. Command: `pnpm --filter @floz/worker build` then `pnpm --filter @floz/worker exec vitest run test/production-runtime.test.ts` (future file).

**Task 12 files:** proposed `apps/worker/src/heartbeat.ts`, `apps/worker/src/health.ts`, `apps/worker/test/heartbeat-health.test.ts`; `main.ts` and existing loops/handlers only. Runtime path contract is `/run/floz-worker`; tests use an injected private temporary directory only. Task 12 owns no Dockerfile, Compose, tmpfs, image, or HEALTHCHECK integration; Task 17/F owns all production `/run/floz-worker` tmpfs and Docker HEALTHCHECK wiring. The CLI must compare independent current-instance identity plus heartbeat with process/start identity, not trust identity repeated inside a stale record. Atomic temp+rename with restrictive permissions; remove stale heartbeat/temp/instance state before initialization. Track active job/iteration steps and recovery loop progress, not writer timer. Entrypoint `node apps/worker/dist/health.js` imports only local/stdlib modules (not network factories). ZERO instrumentation uses module-load interception/traps in test subprocess and sandbox network-deny plus fixture Redis command counter baseline/delta=0 and PostgreSQL connection/query delta=0. Include no env secrets required to run local health. Command: `pnpm --filter @floz/worker exec vitest run test/heartbeat-health.test.ts` (proposed).

**Task 13 files:** proposed `apps/worker/src/readiness.ts`, `apps/worker/src/readiness-probe.ts`, `apps/worker/test/readiness-cli.test.ts`; config/package as required. Entrypoint `node apps/worker/dist/readiness.js`; local exclusive lock under same private runtime directory prevents multiple child invocations. Supervisor probes child with private PG/Redis, terminates timed-out resources, retains exclusion while cleanup pending; stale lock recovery checks owner/process instance safely. A second invocation exits nonzero rather than another pool. First verifies local health; concurrent SELECT1/PING2s each, total3s includes cleanup; revalidate instance/stopping before0. No interval/cadence is installed in P0. Command: `pnpm --filter @floz/worker exec vitest run test/readiness-cli.test.ts` (proposed).

### Tasks 14–15: exact Web files

**Task 14:** existing `apps/web/next.config.ts`; proposed `apps/web/test/security-headers.test.ts`, `apps/web/e2e/production-hardening.spec.ts`. Exact CSP `base-uri 'self'; object-src 'none'; frame-ancestors 'none'`; no default/script/style-src; HSTS15552000 HTTPS-only policy without includeSubDomains/preload. Next sole owner, default output plus FLOZ_NEXT_DIST_DIR/test tsconfig preserved. Commands: `pnpm --filter @floz/web exec vitest run test/security-headers.test.ts`; served TLS Playwright run through proposed controlled-stack script in Task21. RED assert exact headers and successful hydration/no CSP console error.

**Task 15:** proposed `apps/web/app/error.tsx`, `apps/web/app/global-error.tsx`, `apps/web/test/error-boundaries.test.tsx`, `apps/web/test/logout-outcome.test.tsx`; existing `apps/web/lib/auth-context.tsx`, `api-client.ts` only. Global boundary includes html/body and both client boundaries accessible heading/alert/button focus. Recovery reset only rerenders/reads; never repeats failed mutation. Remove current `auth-context.tsx:80–87` finally-based false logout; preserve session on failure, show unknown on transport loss, user-triggered `/me` 200 restores session and 401 confirms signed-out; other read failures remain unknown. API correction and all deletion-cookie/persisted-session assertions are owned by Task 6/B, not E. Command: `pnpm --filter @floz/web exec vitest run test/error-boundaries.test.tsx test/logout-outcome.test.tsx test/api-client.test.ts`. RED asserts no repeated POST on loss, no false session clearing, correct manual recovery and retained auth/conflict codes.

### Tasks 16–19: exact compiled tools and fixtures

**Task 16:** proposed `database/src/migrate.ts`, `database/test/migrate-runner.integration.test.ts`; existing database package/tsconfig (rootDir src already emits dist/migrate.js). Production dependencies drizzle-orm/postgres are already present. Installed migrator delegates db.session; dialect creates schema/table and reads journal BEFORE transaction; session.transaction invokes this.client.begin. Therefore acquire session advisory lock first, then call `migrate(drizzle(privateMax1Client), {migrationsFolder:absoluteCheckedInFolder})`, never shell drizzle-kit. Use fixed key derived from `floz:production-migration:<validated environment>:<current_database>` consistently, pg_try_advisory_lock false fails; client max_lifetime/idle recycling disabled, onclose marks fatal and blocks subsequent dispatch, reconnect is not accepted as retained ownership. Observe single backend PID through fixture DB server statement logging or instrumented session execution without logging SQL in application logs. Controlled backend termination after lock/before journal/before transaction/during transaction must all fail and never unlock unrelated new PID. Use connection5/statement10/lock3/outer60. Populated pre-latest valid DB must apply remaining immutable migrations, then rerun/noop preserves data/journal. Command: `pnpm --filter @floz/database build` then `pnpm --filter @floz/database exec vitest run test/migrate-runner.integration.test.ts`. Actual runner `node database/dist/migrate.js`, no fixture TS compiler or tsx in production.

**Task 17:** proposed `infra/docker/migrate.Dockerfile`, `scripts/phase12-build-multiarch.ps1`, `scripts/phase12-image-smoke.ps1`, `infra/test/production-images.test.ts`, and `.github/workflows/phase12-multiarch-smoke.yml`; existing three Dockerfiles, compose, Caddyfile and proposed `.dockerignore` if absent. The workflow path is conditional, not a required creation or available runner. Canonical execution is local Docker Buildx with registered ARM64 and binfmt/QEMU, actual ARM64 execution, no push. Before Task 17 executable implementation, run `docker buildx version`, `docker buildx inspect --bootstrap`, verify `linux/arm64` registration and enabled binfmt/QEMU handler/version, then resolve an official trusted minimal multiarch image to a verified immutable digest (record provenance; never invent a digest). Set `$Arm64PreflightImage` to that reviewed `name:tag@sha256:digest`; run `docker run --rm --platform linux/arm64 --network none --user 65534:65534 $Arm64PreflightImage uname -m` and require exit 0 with `aarch64` or `arm64`. Record host/runtime architecture separately. Do not install/register privileged binfmt handlers without explicit human approval. Missing trust, builder support, binfmt/QEMU or successful actual execution: STOP at Checkpoint F preflight before task implementation; request explicit authorization for the exact CI mechanism, runner, workflow/ref, source SHA, permitted push destination/ref and invocation. Workflow creation alone neither authorizes an implementation-branch push nor establishes CI availability. Commands after creation, on an approved capable local runtime only: `pwsh scripts/phase12-build-multiarch.ps1 -Platform linux/amd64`; `pwsh scripts/phase12-image-smoke.ps1 -Platform linux/amd64`; repeat separately for linux/arm64. If separately authorized CI replaces unavailable local ARM64, execute the approved mechanism instead of local ARM64 commands; require equivalent runtime assertions and evidence. Every path records exact implementation SHA, immutable image tag/digest, QEMU/Buildx versions, host and container `uname -m`, non-root UID, API, worker local-only health, migrator and Web execution, plus backup age encrypt/decrypt and pg_dump/pg_restore after G, CA/native checks, individual exit codes and safe logs. Neither available path means BLOCKED, never skipped/pass; manifests or cross-build alone cannot satisfy runtime evidence. Build script validates platform enum, uses docker buildx --platform/--load, frozen lock, builds API/worker/web/migrate and later backup; no push. Node22 Debian slim tag/real manifest digest and official provenance reviewed before pinning; no invented digest. Native bcrypt plus DB/Redis TLS handshake, CA bundle, non-root writable heartbeat tmpfs, default Next `next start`, migration `node database/dist/migrate.js` all execute on each architecture. API `node apps/api/dist/src/main.js`, worker `node apps/worker/dist/main.js`; packaging must verify these paths exist. Controlled Caddy rejects public API port, discards Forwarded/all incoming X-Forwarded-* then sets socket-derived client IP/TLS proto; narrow fixed fixture Caddy source trust. API HSTS owner Caddy; no global HTTP response timeout; route health `/api/v1/health/ready`. Runtime35 deadline plus host final fallback configured; Docker unhealthy is observable, not auto-restart evidence.

**Task 18:** use existing `@floz/infra` workspace, not another package. Proposed `infra/backup/backup.mjs`, `infra/backup/retention.mjs`, `infra/test/backup.test.ts`, `infra/test/retention.test.ts`, `infra/docker/backup.Dockerfile`; proposed `scripts/test-phase12-backup.ps1`. Plain Node stdlib orchestration (no crypto wrapper); spawn pg_dump→age with pipe backpressure, check every child, encrypted restrictive staging and streaming SHA-256; use pinned trusted S3-capable CLI packaged in backup image. The disposable fixture pins exact MinIO client source `minio/mc:RELEASE.2025-08-13T08-35-41Z`, uses its matching `linux/${TARGETARCH}` `mc` binary, verifies release provenance/checksum before image copy, and records binary version/checksum. If that bounded release verification cannot be completed, STOP before implementation; do not silently choose a different release. Independent private backup bucket/prefix fixed architecture; controlled fixture only. Pin distro age from trusted Debian snapshot for both targets or official per-arch binaries/checksums if unavailable; verify pg_dump/pg_restore version compatibility and S3 client runtime. Public X25519 recipient only in backup; separately scoped source read, upload/verify, retention delete, and restore identity/read credentials; never reuse attachments credentials. Serialize backups with admission before source connection; capture journal/version metadata sequentially without exceeding one source slot, ensure snapshot/journal consistency in fixture (no concurrent migration while snapshot metadata collection changes). Commands: `pnpm --filter @floz/infra exec vitest run test/backup.test.ts test/retention.test.ts`; `pwsh scripts/test-phase12-backup.ps1` (proposed files/scripts).

**Task 19:** proposed `infra/backup/restore-fixture.mjs`, `infra/test/restore-fixture.test.ts`; extend proposed backup script. S3 fixture endpoint mandatory and local/isolated allow-list enforced by test harness; generated disposable identity never production key. Restore refuses source DB identity/host+database equality and non-isolated target. Dump over verify-full even local controlled TLS fixture; decrypt temporary archive mode0600/private directory only when seek needed; restore serial flags exact, integrity sequential one target connection after restore closes. Failure injection includes download corruption, wrong/missing identity, decrypt auth failure, restore nonzero, integrity mismatch and cleanup failure; none reports success or leaks data. Verify source untouched; sessions/accounts usable via Better Auth APIs, workspace access isolation, foreign keys/uniques, outbox state and notification dedup, migration journal exact. Snapshot age24h measured from start; deterministic 24h threshold tests and RTO elapsed are fixture evidence only. Commands: `pnpm --filter @floz/infra exec vitest run test/restore-fixture.test.ts`; `pwsh scripts/test-phase12-backup.ps1` (proposed). Build/runtime scripts include actual age encrypt/decrypt and pg client restore on both architectures once G lands.

### Tasks 20–24: exact crosscutting, post-gate docs, and final checks

**Task20 files:** extend existing `apps/worker/test/outbox-db.integration.test.ts`, `outbox.integration.test.ts`, `notification-reconciliation.integration.test.ts`, `recurrence.integration.test.ts`, `approval-notifications.integration.test.ts`; proposed `apps/worker/test/replay-failures.integration.test.ts`. Use actual DB dedup/lease tokens and Redis, not all mocked success. Before claim/no event; after claim pending recoverable; after notification commit/before mark replay yields one notification; stale owner cannot mark new lease; Redis enqueue success/ack loss uses same jobId; SIGTERM/forced kill+stalled restart generates one recurrence occurrence/task; notification job max1 still counted even queue not presently enqueued. Command: `pnpm --filter @floz/worker exec vitest run test/replay-failures.integration.test.ts` plus existing `pnpm --filter @floz/worker test:integration`.

**Task21 files:** existing `scripts/test-e2e.ps1`, `scripts/test-clean-db.ps1`, `apps/web/e2e/flow.spec.ts`; proposed `scripts/test-phase12-stack.ps1`, `infra/test/production-ingress.test.ts`, `scripts/test-phase12-groups.ps1`. Existing E2E uses disposable PG/Redis, API dist/src/main.js, worker dist/main.js, next test distDir; adapt all fixture Origin headers without weakening assertions. Existing script's broad repeated log dumps must not leak driver raw errors. Proposed stack script wraps controlled TLS Caddy, isolated DB/Redis and Web origins, no provider credentials. Proposed groups script owns disposable fixture setup/teardown, explicit NODE_ENV=test, approved Origins, env restoration, no fallback to developer DB, nonzero if required scenarios missing; groups `config-security`, `api-resilience`, `worker`, `migration`, `backup` map exactly to focused files above and run existing relevant regressions too. Build necessary fixtures as setup, not claimed final build gate. Test harnesses do not remove security controls to accommodate process startup. Commands: existing `pwsh scripts/test-e2e.ps1` plus proposed `pwsh scripts/test-phase12-stack.ps1`; existing `pwsh scripts/test-clean-db.ps1`.

**Task22 executable order (each line completed before next):**

```powershell
pwsh scripts/test-clean-db.ps1
pwsh scripts/test-phase12-groups.ps1 -Group config-security
pwsh scripts/test-phase12-groups.ps1 -Group api-resilience
pwsh scripts/test-phase12-groups.ps1 -Group worker
pwsh scripts/test-phase12-groups.ps1 -Group migration
pwsh scripts/test-phase12-groups.ps1 -Group backup
pwsh scripts/test-e2e.ps1
pwsh scripts/test-phase12-stack.ps1
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pwsh scripts/phase12-build-multiarch.ps1 -Platform linux/amd64
pwsh scripts/phase12-image-smoke.ps1 -Platform linux/amd64
```

**Step 13 — ARM64 conditional gate:** only on the approved capable local Docker Buildx/binfmt/QEMU runtime that passes Task 17 preflight, run:

```powershell
pwsh scripts/phase12-build-multiarch.ps1 -Platform linux/arm64
pwsh scripts/phase12-image-smoke.ps1 -Platform linux/arm64
```

Otherwise, use only the separately human-authorized, available CI mechanism and exact push/invocation workflow; do not run those local ARM64 commands or implicitly push the implementation branch. Await that exact implementation SHA's complete ARM64 runtime evidence before advancing. If neither path is authorized and capable, record `BLOCKED` and STOP: never skipped/pass. Step 13 must prove API, worker local health, migrator, Web, backup age encrypt/decrypt and pg_dump/pg_restore after G, CA/native execution and individual exit codes, image tag/digest, runtime architecture and non-root UID. A manifest build cannot pass it.

**Step 14 — only after step 13 passes:**

```powershell
pwsh scripts/test-phase12-hygiene.ps1
```

Each script named phase12 is proposed; existing clean DB/E2E and root quality scripts are verified in package/source. The two E2E commands are one full-real-stack gate; build+runtime pair is one architecture gate. Proposed `scripts/test-phase12-hygiene.ps1` is created in Task21, asserts clean tracked tree, no unexpected untracked outputs, immutable `database/drizzle` and accepted design relative to baseline, no generated logs/identities/backups/node_modules tracked, image secret scan/test fixtures excluded from shipping, `git diff --check`, and secret-canary scans of build context/image history/serialized logs. It emits safe counts/names, never matching secrets. Command exit missing scenario/nonzero blocks gate; test suites using passWithNoTests must additionally prove nonzero scenario counts. Gate log records every command result, not merely aggregate return.

**Task23 review boundary:** evidence-only doc forward commit under future execution authority; no new executable edits allowed without restarting all Task22 from1. Report separate minor follow-ups and leave checkpoint `complete; awaiting explicit human acceptance`. Do not auto-publish/merge/delete worktrees. Task22/23 need no runtime rerun for docs-only ledger corrections after final executable gate; lint/typecheck runtime gates are not invoked by this planning session.

**Task24 review boundary:** future-only, after Task22 ledger and Task 23 cross-check. Synchronizes internal status/handoff/decisions/report docs and inspects external Documentation files, updating applicable facts when needed without Git-tracking external files. Proposed commits are separated: implementation evidence commit, evidence review close commit, then internal documentation publication commit. Docs-baseline publication never implies implementation publication.

## Detailed Test Contracts and Future Commands

### API ingress contracts (Tasks 4–6)

- **Create:** `apps/api/test/production-ingress.integration.test.ts` (proposed). Build the real `AppModule`, use `supertest`, and use spies on direct Better Auth methods plus service mutation methods.
- **RED/GREEN:** For every row in the unsafe inventory, send no Origin, `Origin: null`, malformed `Origin: https://good.example/path`, an unapproved exact origin, and approved configured origin. Assert the first four are 403 with existing envelope and every spy count is zero; approved Origin reaches the route's ordinary auth/validation result. OPTIONS remains non-mutating and uncounted.
- **Task 6/B CORS RED/GREEN:** Real bootstrap approved credentialed requests and OPTIONS preflights return exact requesting approved origin (never wildcard/reflection), credentials `true`, and `Vary: Origin`; permitting preflight methods are exactly `GET, POST, PUT, PATCH, DELETE, OPTIONS` and headers exactly `Content-Type, Idempotency-Key, X-Request-Id` (compare case-insensitive header-name sets). Unknown method/header is not permitted. Missing, literal null, duplicate, malformed, path-bearing, credential-bearing and unapproved origins receive no CORS allow headers. Approved preflight performs zero mutations/Better Auth calls and zero auth quota accounting. Safe missing-Origin GET remains usable without CORS headers; unsafe requests with each invalid Origin independently return guard 403 before work, not merely browser CORS denial. Assert Better Auth trustedOrigins, CORS and CookieOriginGuard use identical normalized origins; Task 7/C validates/replaces supplied request IDs independently.
- **Task 6/B logout RED/GREEN:** Real auth harness receives separate deletion Set-Cookie values for session and auxiliary cookies using `getSetCookie()`, preserving HttpOnly, production Secure, Path, SameSite, Domain when present, Max-Age and Expires without comma splitting. Better Auth non-ok/throw yields sanitized non-204; successful logout alone yields 204 and old persisted-cookie `/me` 401. Task 15/E tests only Web consumption/recovery of this completed API contract.
- **RED/GREEN:** Login with no/null/unapproved origin does not call `signInEmail`; logout does not call `signOut`; password does not call `changePassword`/`revokeOtherSessions`; provisioning does not call `signUpEmail`. `POST /api/v1/auth/sign-up/email` remains 404.
- **RED/GREEN:** Same normalized IP admits ten combined auth-route calls during one fake-clock fixed 60,000ms window; 11th is 429 with exact `RATE_LIMITED`, `Too many requests.`, empty details, Retry-After >=1; failure counts; expiry resets; capacity 10,000 rejects only new key after expiry prune and leaves existing key usable. `::ffff:203.0.113.4` equals `203.0.113.4`; spoofed forwarded chain cannot choose client IP; health/OPTIONS/business calls do not consume quota.
- **RED/GREEN:** Unknown DTO field/type is 400 `VALIDATION_ERROR`; exact 1,048,576 byte JSON succeeds/fails only on its normal DTO rule, 1,048,577 byte JSON and URL-encoded body are 413 exact `PAYLOAD_TOO_LARGE`; malformed JSON below the body limit returns400 VALIDATION_ERROR; oversized parser errors return413; no global implicit conversion is accepted, preserving explicit recurrence query transforms.
- **Existing focused command:** `pnpm --filter @floz/api test`. **Proposed focused command:** `pnpm --filter @floz/api test -- production-ingress.integration.test.ts`.

### API shutdown contracts (Task 9)

- **Create:** `apps/api/test/shutdown.integration.test.ts` and `apps/api/test/fixtures/api-shutdown-child.mjs` (proposed). Inject a fake monotonic clock/timers for unit boundary tests and run compiled child processes with real SIGTERM for lifecycle proof.
- **RED/GREEN fake-clock assertions:** first signal writes stopping/readiness false before `server.close`; active request resolves before 30,000ms and `app.close` runs once after close; at 30,000ms remaining sockets are destroyed; only then pool destroy hook runs; 35,000ms outer expiry exits 1. Repeated SIGTERM returns same promise/no double close. Clean drain exits 0; forced socket, cleanup rejection, or outer expiry exits 1.
- **RED/GREEN real-process assertions:** child prints ordered safe event tokens, admits a deliberately held request, receives SIGTERM, rejects later connection, drains or force-closes within observed 30/35 budgets, has exactly one AuthService close token, and exits expected code. Do not assert database mutation rollback/cancellation.
- **Proposed focused command:** `pnpm --filter @floz/api test -- shutdown.integration.test.ts`.

### Worker health/readiness contracts (Tasks 11–13)

- **Create:** `apps/worker/test/production-runtime.test.ts`, `apps/worker/test/heartbeat-health.test.ts`, `apps/worker/test/readiness-cli.test.ts` (proposed). Extend dependency injection in `startWorkerRuntime` only enough to pass fake clock, DB/Redis constructors, process exit, and progress probes.
- **RED/GREEN:** exact close order is heartbeat stopping/removal, both stop requests issued without awaiting either, `Worker.close(false)` for both workers, queue/Redis close, then jobs/dispatcher/reconciliation/claim SQL closure. A 30,000ms fake-clock graceful wait abandons cached close promise; 35,000ms exits 1; no `close(true)` second-call escalation. Clean path exits 0.
- **RED/GREEN:** heartbeat cleanup occurs before initialized write; identity/current timestamp/progress writes every 15,000ms; stale >45,000ms, wrong instance, malformed JSON, future timestamp, stopping, loop termination, and stalled active progress are nonzero. Idle initialized runtime remains healthy; handled remote outage stays locally healthy.
- **ZERO network instrumentation:** local-health CLI injects throwing/counting `createDatabase`, `Redis`, `fetch`, socket, and DNS constructors. For healthy, stale, malformed, stopping, and hung cases assert all counts exactly zero. Task 12/D proves this using private temporary-directory local CLI tests only. Task 17/F separately proves Docker HEALTHCHECK invokes only this CLI with interval 30s/start_period 30s/timeout 5s/retries 3 and owns tmpfs/image integration.
- **RED/GREEN readiness:** local health first; PG `SELECT 1` and Redis `PING` start concurrently, each terminates/cleans by 2,000ms and aggregate returns by 3,000ms. Instrument exactly one private max1 PG client, private bounded Redis client, no BullMQ client reuse; concurrent CLI invocation rejects/does not overlap until cleanup settles; recheck heartbeat before exit 0. Test TLS and cleanup failures nonzero.
- **Proposed focused commands:** `pnpm --filter @floz/worker test -- production-runtime.test.ts heartbeat-health.test.ts readiness-cli.test.ts`; existing broad command `pnpm --filter @floz/worker test:integration`.

### Migration and image contracts (Tasks 16–17)

- **Create:** `database/test/migrate-runner.integration.test.ts` and `database/test/fixtures/migrate-runner-child.mjs` (proposed). Use disposable PostgreSQL only, preserving every checked-in `database/drizzle` SQL/meta byte.
- **RED/GREEN:** clean DB applies journal; populated DB and rerun are no-op; competing runner returns nonzero before migrator; observed `pg_backend_pid()` is identical at lock acquisition, journal read, migration transaction, and unlock; simulated client disconnect fails nonzero; 60,000ms outer timer fails nonzero; no seed/down/schema push/runtime startup migration.
- **Create:** `scripts/phase12-image-smoke.ps1` and `scripts/phase12-build-multiarch.ps1` (proposed), only after implementation chooses real image/digest. Tests build/run actual amd64 and arm64 artifacts, inspect non-root UID, production dependency closure, CA/pg_dump/pg_restore/age availability, emitted entrypoints, default Next output, and secret-free image history/context. Manifest inspection alone is insufficient.

### Backup and restore contracts (Tasks 18–19)

- **Create:** `infra/backup/backup.mjs`, `infra/backup/retention.mjs`, `infra/backup/restore-fixture.mjs`, `infra/test/backup.test.ts`, `infra/test/retention.test.ts`, `infra/test/restore-fixture.test.ts` in existing `@floz/infra`; paths and command wiring are specified in the execution annex.
- **RED/GREEN stages:** inject controlled disposable PostgreSQL, real `pg_dump`, `age`, SHA-256, and controlled S3-compatible fixture. For each dump, encryption, encrypted-write, hash, upload, remote-download, remote-hash, metadata-write, and cleanup failure assert nonzero, encrypted staging removal, no plaintext dump file, unchanged last-success object, and no retention deletion. A successful upload with failed dump is failure.
- **RED/GREEN integrity:** remote encrypted byte SHA-256 must equal metadata and downloaded bytes; deterministic byte corruption fails before restore; private identity is supplied only to restore process and never appears in environment logs/metadata/archive; metadata has backup ID/environment/start/completion/encrypted size/SHA/tool versions/journal/recipient ID only.
- **RED/GREEN retention:** select UTC 7 daily plus 4 weekly from successful archives, retain union, never delete selected archive, rotate only after verified replacement, first-day history does not claim 7/4 copies. Fixture decrypts to restricted temp archive, restores isolated target using exact flags, removes temp archive on success/failure, checks journal/relations/counts/constraints/sessions/accounts/workspace isolation/outbox/dedup; recovery elapsed is recorded as fixture-only evidence.
- **Proposed focused commands:** `pnpm --filter @floz/infra exec vitest run test/backup.test.ts test/retention.test.ts test/restore-fixture.test.ts`; `pwsh scripts/test-phase12-backup.ps1`; `pwsh scripts/phase12-image-smoke.ps1 -Platform linux/amd64`; ARM64 smoke only through the approved local preflight path or separately authorized available CI mechanism. Existing infra package/Vitest is reused; all named Phase12 files are future artifacts.

## Bidirectional Coverage Matrix

| Accepted requirement | Implementing tasks | Verification artifact |
|---|---|---|
| Sections 4 origins/CSRF/limiter/trusted proxy | 1,4,5,6 | production-ingress integration inventory |
| Section 4 validation/body/API headers | 6 | payload/DTO/parser/header tests |
| Section 5 bounds/API drain | 2,3,8,9,17 | fake-clock plus child-process shutdown tests |
| Section 6 owner/TLS/budgets | 1,2,3,8,11,13,16,18 | constructor instrumentation/owner table |
| Section 7 queue/replay/shutdown/heartbeat/readiness | 10,11,12,13,20 | worker lifecycle, zero-network health, replay tests |
| Section 8 request ID/redaction/sanitized logging | 7 | serialized Pino capture tests |
| Section 9 prefixed probes | 8,9 | health/readiness tests |
| Section 10 Next headers/boundaries/logout | 14,15 | served header/browser tests |
| Section 11 migrator/images/Caddy | 16,17 | clean/populated/lock/PID/image runtime tests |
| Section 12 backup/restore/retention | 18,19 | controlled S3 fixture and isolated restore |
| Section 13 env/secret/TLS precedence | 1,2 | full config matrix tests |
| Sections 14–15 failure/test semantics | 4–21 | named negative assertions above |
| Sections 16–17 Gate A/compatibility | 21–24 | ordered evidence ledger and docs |

| Task | Requirements served |
|---|---|
| 1–3 | configuration, TLS, secret safety, PG budget/bounds |
| 4–6 | all API unsafe mutations, auth ingress, strict CORS, logout cookie forwarding, validation/proxy |
| 7–9 | logs, probes, shutdown |
| 10–13 | queue, worker shutdown/health/readiness |
| 14–15 | Web headers/error/unknown auth outcome recovery |
| 16–17 | migrator/container/proxy |
| 18–19 | encrypted fixture backup/restore |
| 20–21 | replay and full regression |
| 22–24 | Gate A execution, internal evidence closure, and post-gate documentation |

## Coverage and Exclusions Review

- Every P0 design section maps to Tasks 1–24: origins/CSRF/limiter/validation (1,4–6), resource bounds/TLS (2–3), API shutdown (9), worker/queue/heartbeat/readiness/replay (10–13,20), observability (7), health (8), Web (14–15), migration/images (16–17), backup/restore (18–19), Gate A execution/closure/docs (22–24).
- Reverse trace: each task maps back to Sections 4–17 and Gate A evidence; no task authorizes a schema migration, global limiter, standalone Next, script CSP, DLQ/re-drive, production deployment, Gate B, external document schema changes, or Phase 9 edits.
- Exact accepted contracts retained: API/worker 30/35-second shutdown; verified TLS; max 1 owners; concurrency 1; totals 7/8/10; heartbeat 15/45; Docker local-only health 30/30/5/3; readiness 2/3; migration 60 seconds/session PID continuity; backup custom dump→age→SHA-256→fixture restore; 7 daily/4 weekly.
- Gate A exclusions: no Oracle/Neon/Upstash/R2 production credentials, real domain, provider quota, public deployment, actual-environment restore/RPO/RTO, or Gate B launch evidence.
