# Phase 12: Production Hardening Design

**Status**: FINAL DESIGN / APPROVED FOR IMPLEMENTATION PLANNING
**Approval boundary**: Design decisions are closed. This edit authorizes no implementation, deployment, or claim that Gate A/B has passed.
**Date**: 2026-09-11
**Target Repository**: `D:\Portofolio\Floz\app`
**Scope**: Design revision only. No code, tests, plans, commits, external documentation changes, or runtime gate execution. Phase 9 remains untouched. Phase 12 expects **no new schema migration**; existing migrations remain immutable.

## 1. Current State Reconstructed

Findings below distinguish existing sufficient behavior, strengthening requirements, missing controls, and deferred work. They describe inspected source, not proof of deployed production behavior.

| Area | Classification and evidence |
|---|---|
| API bootstrap | Strengthen: one Nest application, reflected credentialed CORS, cookie parser, `ValidationPipe({ whitelist: false, transform: true })`, global prefix `api/v1`; `apps/api/src/main.ts:11-24`. No shutdown coordinator there. |
| Actual auth mounting | Existing sufficient transport, missing ingress protection: local Nest methods call Better Auth directly. Login invokes `signInEmail` without request context, provisioning invokes `signUpEmail`, logout invokes `signOut` with headers, password change invokes `changePassword` and `revokeOtherSessions`; `apps/api/src/floz.controller.ts:52-109`. No generic Better Auth HTTP router is mounted in `apps/api/src/app.module.ts:15` or `apps/api/src/main.ts:14-23`. |
| Better Auth source | Better Auth 1.7.1 has router rate limiting at `apps/api/node_modules/better-auth/dist/api/index.mjs:163-169`; origin middleware skips absent `ctx.request` at `apps/api/node_modules/better-auth/dist/api/middlewares/origin-check.mjs:42-44`. These existing library protections cannot be credited to local direct API calls. |
| Identity/cookies | Existing sufficient ownership: ADR-001 preserves Better Auth identity ownership and HttpOnly cookie transport (`docs/decisions/ADR-001-better-auth-identity-and-cookie-transport.md:5-7`). Config sets `autoSignIn: false`, `floz_session`, HttpOnly, SameSite Lax, `/api/v1`, production Secure (`apps/api/src/auth.ts:23-31`). Origins/secrets need strengthening. |
| Auth regression | Existing tests assert no public signup endpoint and persisted-session invalidation on logout (`apps/api/test/auth.test.ts:63,79-83`). Web already uses `credentials: 'include'` and POST logout (`apps/web/lib/api-client.ts:330,361-364`), but clears local state in finally even on failure (`apps/web/lib/auth-context.tsx:80-87`). |
| API pool owner | Existing sufficient: only AuthService constructs/closes the API pool (`apps/api/src/auth.ts:14,37-39`). Floz, task, recurrence, notification, approval, comment, workflow and reporting borrow it (`apps/api/src/floz.service.ts:22`; `apps/api/src/task.service.ts:46`; `apps/api/src/recurrence.service.ts:32`; `apps/api/src/notification.service.ts:28`; `apps/api/src/approval.service.ts:43`; `apps/api/src/comment.service.ts:32`; `apps/api/src/workflow.service.ts:33`; `apps/api/src/floz.controller.ts:141-164`). Do not invent additional API pool owners. |
| PostgreSQL | Strengthen: factory sets max 10 (`database/src/index.ts:7-9`). Postgres.js 3.4.9 already parses sslmode, defaults connect timeout to 30 seconds and has retry backoff (`database/node_modules/postgres/src/index.js:443-457,511-512`). require/prefer/allow can disable certificate rejection (`database/node_modules/postgres/src/connection.js:284`); require alone is not verified TLS. |
| Worker ownership | Strengthen: shared supplied Redis connection and recurrence queue; two BullMQ workers receive the jobs SQL handle (`apps/worker/src/main.ts:33-48`), but the notification handler **does not use it**: it opens/closes a separate DB client per valid job (`apps/worker/src/recurrence-worker.ts:17-35`). Dispatcher, recurrence SQL and reserved claim SQL are separate owners (`apps/worker/src/main.ts:49-73`). Each reconciliation iteration also opens/closes a notification DB client (`apps/worker/src/reconciliation.ts:19-22,71-79`). BullMQ may duplicate Redis connections internally; one supplied connection is not a total socket count. Section 6 accounts for every DB owner. |
| BullMQ close | BullMQ 5.81.3 close(false) waits for active jobs; close(true) skips that wait. First close is memoized (`apps/worker/node_modules/bullmq/dist/cjs/classes/worker.js:784-787,798-806`). A second close(true) cannot escalate a pending close(false). Current runtime calls close() without a bound (`apps/worker/src/main.ts:75-86`). |
| Queue retention | Strengthen explicit bounds, not missing retention: factory has attempts 3, exponential delay 1000, removeOnComplete true, and no removeOnFail override (`apps/worker/src/queues.ts:21-25`). Completed jobs are removed; no evidence supports the previous assertion that failures are deleted. Runtime only supplies recurrence queue; optional notification queue is not supplied (`apps/worker/src/main.ts:34,57`; `apps/worker/src/outbox-dispatcher.ts:16,45-56`). Do not invent an existing second queue factory. |
| Replay foundation | Existing sufficient foundation, verify failure cases: outbox lease/token fencing (`database/src/outbox.ts:11-20`), notification dedup ledger conflict handling (`database/src/notification-core.ts:40-54,92-106,181-201`), transactional recurrence row locking and duplicate-occurrence handling (`apps/worker/src/generate-due-occurrence.ts:19-41`). Not an exactly-once delivery claim. |
| Logs | Missing policy: Pino factory only sets level/service (`packages/observability/src/index.ts:1-3`). Worker logs raw Error objects (`apps/worker/src/main.ts:57,72`); Pino 9.14.0 maps object/request/response inputs (`packages/observability/node_modules/pino/lib/tools.js:55-77`). ErrorFilter sanitizes response envelope but does not log (`apps/api/src/error.filter.ts:52-60`). |
| Health | Existing sufficient URL: `/api/v1/health` from prefix and controller, corroborated by README (`apps/api/src/main.ts:22`; `apps/api/src/health.controller.ts:3-8`; `README.md:25`). Dependency readiness and runtime worker health are missing. |
| Config/Web | Strengthen partial config (`packages/config/src/index.ts:6-25`). Next retains default output, custom test distDir/tsconfig only (`apps/web/next.config.ts:3-10`). Missing root error boundaries and header policy. |
| Images/proxy | Missing production packaging: single-stage root images copying source/dev tooling (`infra/docker/api.Dockerfile:1-6`; `infra/docker/worker.Dockerfile:1-6`; `infra/docker/web.Dockerfile:1-6`). Compose relative context is infra rather than repository root, publishes API directly, omits Caddy service (`infra/docker-compose.yml:1-24`). Caddy disables automatic HTTPS (`infra/Caddyfile:1-8`). |
| Migration tooling | Existing dev command uses drizzle-kit, a dev dependency; production drizzle-orm/postgres already exist (`database/package.json:10-11,23-32`). Installed ORM migrator reads SQL/journal and delegates to dialect (`database/node_modules/drizzle-orm/postgres-js/migrator.js:1-4`). Dialect reads migration state before opening its transaction (`database/node_modules/drizzle-orm/pg-core/dialect.js:44-71`); postgres-js session transaction uses client.begin (`database/node_modules/drizzle-orm/postgres-js/session.js:108-120`). |

Repository guidance: no AGENTS.md/CLAUDE.md/GEMINI.md was found under Floz in prior inspection; README and accepted ADRs provide guidance. Phase 9 remains accepted without modification. External architecture was inspected read-only at `../Documentation/Technical/Floz_Technical_Design_Architecture_Free_Bootstrap.md:110-124,158-174,325,788-813,1323-1333,1519-1533,1670,1691`: Vercel permitted-use Web, Oracle A1 API/Worker, Neon, Upstash, Caddy TLS, ADR-019 multiarch, independent encrypted backups, secrets outside images, trusted reproducible images. Those quota statements are historical architecture evidence, not current entitlement verification. Infrastructure deployment is not proven by this design.

## 2. Goals

P0 establishes a secure single-process API and persistent worker on the decided bootstrap topology: verified ingress, bounded resource waits, safe shutdown ownership, diagnostic logging, health, reproducible release/migration artifact, and recoverable data. Preserve auth/business contracts, Phase 9, existing migrations, Vercel primary Web, Next default output, and PostgreSQL as source of truth.

Numeric contracts are canonical in Sections 4-7. TLS precedence is canonical in Section 13. Other sections refer to those contracts rather than defining competing settings.

## 3. Non-Goals

- No plan creation or implementation in this design-only task. Final design is approved for subsequent implementation planning, not implementation execution. No schema migration expected in Phase 12.
- No product features, changed Phase 9 policy, public signup, Better Auth Admin plugin, direct auth-table writes, or custom password hashing.
- No generic business response deadline, automatic retry of uncertain mutations, or assertion that a response/socket timeout cancels database work.
- No P0 global/distributed limiter or additional API process. No metrics platform, tracing stack, Kubernetes, service mesh, or new paid service requirement.
- No DLQ/re-drive product, standalone Next output, automatic HSTS preload/includeSubDomains, or invented CSP nonce.
- Actual-environment first restore and recurring pilot operations belong to Phase 13 Gate B; deterministic isolated fixture restore belongs to Phase 12 Gate A.

## 4. Security Hardening

**Origins, cookies, and CSRF (P0).** Centralize exact HTTPS production origins in `ALLOWED_ORIGINS`, shared with Better Auth trustedOrigins. Reject wildcard, missing, null, malformed, path-bearing or credential-bearing configuration. Preserve credentials-enabled CORS, floz_session HttpOnly/Secure and `/api/v1` cookie path. Final domains determine Lax versus explicitly approved None+Secure; cross-site browser cookie blocking must be tested, not assumed solved by SameSite None.

CORS is not CSRF enforcement. A global Nest `CookieOriginGuard`, registered once through AppModule, requires an exact approved `Origin` on **every cookie-authenticated unsafe mutation** (anything other than GET/HEAD/OPTIONS), including tasks, workflow, comments, approvals, profile, membership and admin operations. Login is also protected before a session exists; logout/password/provisioning are included. Missing Origin, literal `null`, malformed or unapproved Origin returns `403 FORBIDDEN` with the existing error envelope before any mutation or Better Auth call. Nonbrowser cookie clients must supply an approved Origin; no missing-Origin exemption. Read-only probes remain exempt. Authentication/authorization still apply independently.

**Auth limiter (P0).** A singleton Nest `AuthRateLimitGuard` owns the in-memory map, injected once through AppModule and attached to login/logout, password change and account-provisioning methods on FlozController. It runs before direct Better Auth API calls. Limit is **10 admitted requests per 60-second fixed window per normalized client IP**, shared across these protected methods; failures consume quota. Exactly one API process is supported. Probes, OPTIONS and unrelated business routes do not consume quota.

Map cap is **10,000 IP keys**. Prune expired windows on a 60-second sweep and on capacity pressure; scans are bounded by that cap. Never evict an unexpired key to admit a new attacker IP. At capacity after expiry pruning, reject a new key fail closed; existing keys keep their counters. For exhausted keys use the window expiry; for capacity rejection use the earliest key expiry. `Retry-After = max(1, ceil(remainingMilliseconds / 1000))`. Response is HTTP 429 with `{ "error": { "code": "RATE_LIMITED", "message": "Too many requests.", "details": [] } }`. Counter resets on restart are an accepted single-process pilot ceiling, not distributed protection.

**Trusted proxy.** Caddy is the sole public API ingress. Firewall and container networking block direct API access; no public API port publication. Express trusts only the deployment-approved Caddy source IP/narrow CIDR, not arbitrary private ranges or hop counts. Caddy discards inbound spoofed Forwarded/X-Forwarded-* chains and writes X-Forwarded-For from its actual client socket and X-Forwarded-Proto from its TLS connection. No upstream proxy is trusted in P0. Normalize IPv4-mapped IPv6 consistently for limiter keys. Request IDs remain subject to Section 8 validation, not trusted because a proxy forwards them.

**Validation/payload.** Set `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`, with **no global implicit conversion**. Type-only/inline DTOs do not become runtime validators merely by setting these flags; cover their allowed keys/types explicitly without changing Better Auth payload semantics. JSON and URL-encoded limits are **1 MiB (1,048,576 bytes)**. Oversize parsing failures, including failures before controller invocation, return HTTP 413 with `{ "error": { "code": "PAYLOAD_TOO_LARGE", "message": "Request body is too large.", "details": [] } }`.

API app owns nosniff, DENY framing, strict-origin-when-cross-origin referrer policy and removal of X-Powered-By. Caddy owns API-host HSTS `max-age=15552000` on HTTPS responses, without preload/includeSubDomains. Web headers have one owner in Section 10.

## 5. API / Runtime Resilience

**Canonical bounds (P0):**

| Guardrail | Bound and owner |
|---|---|
| Incoming headers | 10 seconds, Node HTTP server |
| Receiving request/body | 30 seconds, Node HTTP server; not handler execution |
| Idle keepalive | 5 seconds, Node HTTP server |
| Caddy upstream connection dial | 5 seconds |
| Caddy business response deadline | None in P0; no response-header/business-response timer |
| PostgreSQL/Redis connection establishment | 5 seconds |
| Runtime PostgreSQL statement | 10 seconds, server-side statement_timeout |
| PostgreSQL lock acquisition | 3 seconds, server-side lock_timeout |
| Readiness dependency check | 2 seconds each, concurrent where multiple dependencies exist |
| Overall readiness invocation | 3 seconds including pool wait/cleanup response |
| API graceful drain / outer termination | 30 seconds / 35 seconds from first signal |
| Worker graceful drain / outer termination | 30 seconds / 35 seconds from first signal |

Timeouts bound resource waits; no business handler response timer is introduced. Transport abort, forced socket close or upstream failure can leave the mutation outcome unknown. Web, Caddy and API must **never automatically retry mutations** on that basis; reload authoritative state before manual recovery. Node parser/header errors may close transport with 408 without an application envelope; idle keepalive closes silently. Caddy dial failure is a gateway failure, not proof a mutation was cancelled.

**Sole shutdown coordinator.** Proposed API `ApiShutdownCoordinator` owns SIGINT/SIGTERM and the Node server obtained from `app.getHttpServer()`. Do not also register Nest automatic signal listeners with `enableShutdownHooks`; concurrent signal-driven app.close would close the pool too early. Nest lifecycle hooks are invoked by explicit `app.close()` only after draining.

1. First signal atomically marks not-ready and starts the 35-second outer deadline. Repeated signals share the same shutdown operation.
2. Coordinator invokes HTTP server.close to stop new connections, closes idle keepalive sockets, rejects new work on existing connections, and allows already-admitted requests to finish for at most 30 seconds.
3. After completed drain, or after forcibly destroying remaining sockets at 30 seconds, call app.close once. Already-closed HTTP server handling must be idempotent.
4. app.close invokes AuthService.onModuleDestroy, the sole API pool owner. No borrowed service closes this pool. Provider cleanup has only the remainder of the 35-second overall budget.
5. Normal fully drained/cleaned shutdown exits 0. Any forced socket/resource fallback, cleanup failure or outer timeout exits 1; host termination provides the final fallback. Forced cleanup does not claim rollback/cancellation of business work.

Preserve ErrorFilter envelope behavior. Unexpected failures return sanitized 500 INTERNAL_ERROR. Logging uses only the sanitized err contract in Section 8, never raw Error/stack/message.

## 6. PostgreSQL Hardening

**Canonical owner budget (P0, one API process and one worker runtime).** Select the smallest pool cap, **max: 1 for every owner**, and **WORKER_CONCURRENCY=1 per BullMQ worker**. This is deliberate pilot serialization, not measured throughput assurance. Keep actual owner boundaries; no pool-sharing refactor is required. Reject P0 overrides increasing caps/concurrency or replicas without a revised aggregate budget. The present factory hardcodes max10 (`database/src/index.ts:7-9`); current concurrency defaults to 5 per worker (`packages/config/src/index.ts:17`). Numbers below are maximum application connection slots, not assertions of eagerly opened sockets or provider backend counts behind a pooler.

| Actual current owner / purpose | Current construction and lifetime | P0 count × max | Close owner |
|---|---|---|---|
| API AuthService: Better Auth and all borrowing API services; API PG readiness also borrows | One max10 client (`apps/api/src/auth.ts:14,37-39`) | 1 × 1 = 1 | AuthService, after API drain |
| Worker jobs SQL: recurrence transactions | One max10 client passed to both handlers (`apps/worker/src/main.ts:40-45`); only recurrence uses this handle (`apps/worker/src/recurrence-worker.ts:9-14,17-35`) | 1 × 1 = 1 | Runtime after both workers stop |
| Worker notification due-soon job DB | One fresh max10 client per valid executing notification job, finally closed (`apps/worker/src/recurrence-worker.ts:19-35`); not the supplied jobs SQL | At most 1 × 1 = 1 | Job finally, included in worker drain |
| Outbox dispatcher SQL, including inline notification writes | One max10 client (`apps/worker/src/main.ts:49-65`; `apps/worker/src/outbox-dispatcher.ts:60-125`) | 1 × 1 = 1 | Dispatcher stop after iteration finishes |
| Recurrence/reconciliation SQL: generation transaction | One max10 client (`apps/worker/src/main.ts:70,72-73`; `apps/worker/src/reconciliation.ts:15`) | 1 × 1 = 1 | Reconciliation stop after loop stops |
| Notification/reconciliation DB: due-soon and overdue transactions | One temporary max10 client per iteration (`apps/worker/src/reconciliation.ts:19-22,37-45,61-73`); iterations cannot overlap (`:84-93`) | At most 1 × 1 = 1 | Iteration finally, included in loop drain |
| Claim SQL: reserved session advisory lock and candidate reads | One max10 pool, one reserved connection (`apps/worker/src/main.ts:71-73`; `apps/worker/src/reconciliation.ts:7-15,78-79`) | 1 × 1 = 1 | Unlock/release first, runtime closes pool after loop |
| Worker dependency-readiness temporary PG client | Missing today; proposed explicit CLI only, not Docker health; one invocation admitted at a time | At most 1 × 1 = 1 | CLI cleanup before successful exit |
| Production migration session | Proposed Section 11 runner; existing drizzle-kit is dev-only (`database/package.json:10-11,23-32`) | At most 1 × 1 = 1 | Runner finally |
| Backup pg_dump connection | Proposed Section 12 utility, no existing runtime owner; serial custom-format dump, no parallel dump | At most 1 × 1 = 1 | Backup child process completion/termination |

Adding any PostgreSQL pool owner requires revisiting and approving this aggregate budget. API persistent maximum is **1**; Worker persistent maximum is **4**, with **2** separately bounded transient runtime clients.

**Exact totals:** four persistent worker clients plus API = **5** persistent slots; one notification job client plus one notification/reconciliation client = **2** transient runtime slots; **normal runtime ceiling 7**. Explicit worker readiness adds **1**, so runtime plus readiness = **8**. Conservatively allow one readiness, one migration and one backup simultaneously with runtime: **maintenance ceiling 10** on the source database. API readiness adds **0**; Docker worker health adds **0**. Migration/backup invocations are serialized per purpose; no overlapping backups or runners beyond the counted owner. An isolated serial pg_restore uses **1 additional connection on a different target database**, never the source budget; integrity checks reuse a single sequential target connection after restore, not a parallel pool. Provider sessions used by administration/console/other applications are outside these totals and must fit separately within actual Gate B quota.

For comparison, current configured runtime ceilings are five persistent max10 pools (API plus four worker pools), up to five notification-job max10 pools and one reconciliation-notification max10 pool: **110 configured slots** at default concurrency5, not 110 observed connections. There is no separate notification dispatcher pool or second reconciliation loop. Current main passes no notificationQueue (`apps/worker/src/main.ts:57`; `apps/worker/src/outbox-dispatcher.ts:16,45-56`), but an existing/stalled/manual due-soon job can still execute, so its client cannot be omitted from the budget.

Apply Section 5 connect, statement, lock and readiness bounds; configure statement_timeout/lock_timeout as server settings, not a JavaScript Promise race masquerading as query cancellation. Business pool acquisition is capped at 5 seconds without silently retrying mutations. API readiness has one outstanding PG probe per runtime, including queue wait; timed-out probes cannot accumulate. Worker readiness uses a private max1 client, separate from the reserved claim session. Cancel/terminate probe resources on deadline, suppress replacement until settled, and complete successful cleanup inside the overall 3-second readiness budget. A wrapper deadline alone is not query cancellation.

The claim session remains reserved across candidate reads and generation/notification work on their separate max1 clients, avoiding self-deadlock. Preserve session-affine advisory-lock semantics, fatal handling of lost lock sessions and finally cleanup; never route claim SQL through a transaction-mode pooler. TLS normalization follows Section 13 for every owner, including temporary notification clients. API readiness uses its existing AuthService-owned pool and PostgreSQL only: the API synchronously uses PostgreSQL, not Redis. Preserve transaction locks, version conflicts, workspace isolation and deduplication constraints.

## 7. Redis / BullMQ / Worker Hardening

Redis factory has TLS options and ioredis retry behavior; missing pieces are explicit policy, bounds and diagnostic events, not an assertion that the library has no retry defaults. Queue factory omits a failed-retention override; **do not assert failed jobs are absent or discarded**.

Apply Section 13 verified TLS and Section 5 connection bounds. Keep BullMQ-required `maxRetriesPerRequest: null` for worker connections; this does not make readiness or shutdown unbounded. Reconnect delay uses capped backoff with jitter up to 5 seconds; log state transitions with sanitized codes, not every attempt. Keep Upstash eviction disabled and assess command consumption, including idle BullMQ traffic, against actual account quota.

**Canonical queue policy:** `attempts: 3`, `backoff: { type: 'exponential', delay: 1000 }`, `removeOnComplete: true`, `removeOnFail: { count: 100, age: 604800 }`. Apply to actual enqueue owners; do not invent a currently wired notification queue. Age-based BullMQ cleanup is lifecycle-triggered, not a guarantee of a dedicated seven-day deletion timer. Failed retention is not a DLQ. Provide a bounded read-only diagnostic CLI showing failed jobId, safe status/type/code and timing; exclude payloads/raw stack/credentials. No re-drive action is included; re-drive remains future, not P1 or a P0 gate.

**Shutdown.** Worker coordinator owns one signal sequence and the Section 5 30/35-second budgets. Mark heartbeat not-ready, stop new reconciliation/dispatcher iterations, then drain both workers with close(false), close queue(s)/Redis, and close each owned PostgreSQL pool only after its users stop. Existing closures currently interleave pool cleanup with loop/worker stops (`apps/worker/src/main.ts:43-45,61-73`); preserve owner identity while making the dependency order and bounds explicit. Stop requests to both loops should be issued promptly rather than letting one hung loop prevent stopping the other.

Installed BullMQ close(true) skips waiting only when it is the first close call. A later close(true) returns the cached close(false) promise; it is not escalation. If the graceful path exceeds 30 seconds, stop awaiting it, attempt safe independent cleanup within the remaining 5 seconds, then terminate with exit 1 by 35 seconds. Do not mutate BullMQ internals to clear its cached promise. A fully graceful shutdown exits 0. Lock expiry/stalled detection on restart permits replay; stopped JavaScript, closed transport or lost locks do not imply completed DB work rolled back. Replay safety relies on the existing DB foundations in Section 1 plus required failure tests.

**Canonical local worker health (P0).** Worker runtime atomically writes a private heartbeat every **15 seconds**, recording process-instance identity, timestamp, initialized/not-stopping state and runtime progress. Before any healthy write, startup must remove stale heartbeat/temp files from a prior instance, establish the new instance identity, and initialize all runtime owners. Reject wrong-instance, malformed, future-dated, missing or stopping records. Shutdown marks stopping/removes the heartbeat before draining. Unexpected runtime loop termination and stuck local progress invalidate healthy state; a timer ticking alone is not progress. Track active iteration/job progress, not merely completion of an entire batch: no local forward progress for 45 seconds is unhealthy, while an idle initialized loop remains healthy. A handled remote dependency outage is a degraded readiness state, not a liveness failure: an initialized runtime continuing its bounded recovery/reconnect control loop remains locally healthy even while PostgreSQL or Redis is unavailable.

Docker **HEALTHCHECK interval=30s, start_period=30s, timeout=5s, retries=3** invokes a **local-only Node health CLI**. Exit 0 requires current-instance initialized/not-stopping heartbeat age **at most 45 seconds** and valid progress; otherwise nonzero. It reads local state only: **no PostgreSQL query, Redis command, network probe, or temporary DB pool**. A systemd deployment may use the same local check at 30-second intervals with a 5-second execution cap; this is not sd_notify watchdog integration. Docker unhealthy is observable status, not a claim Docker automatically restarts unhealthy containers.

**Separate dependency-readiness CLI (P0).** Only deployment validation, an explicit operator invocation, or a **Phase 13 quota-approved cadence** may run it; never invoke it from Docker HEALTHCHECK or an unconditional periodic timer. First require the same current-instance local health, then run PostgreSQL SELECT 1 and Redis PING concurrently with **2 seconds each / 3 seconds overall**, including connect/pool wait and cleanup. Exit 0 only after both probes and temporary-client disposal succeed; timeout, stale state, dependency or cleanup failure exits nonzero. The PG client is the single max1 readiness owner in Section 6; Redis uses a private bounded probe connection, not BullMQ's indefinitely retrying connection. A host-local single-flight guard prevents overlapping invocations; terminate child/probe resources on timeout, retain admission exclusion until cleanup settles, and never count abandoned background work as healthy. Recheck instance/stopping/freshness before successful exit. Runtime health and readiness are intentionally different: a dependency outage cannot cause the local checker to spend quota polling providers.

## 8. Observability

Canonical top-level correlation fields are `requestId`, `jobId`, `workspaceId`, `entityId`, `service`; include method, registered route template, statusCode and durationMs where applicable. Preserve Pino's native time/level shape; do not claim ISO/string levels unless configured. Browser reporting never includes server secrets.

Accept one inbound X-Request-Id only if it matches `^[A-Za-z0-9_.:-]{1,128}$`; duplicate/multiple, invalid or missing values are replaced by crypto.randomUUID(). Return the resulting response header. It is correlation, not authorization. Completion logs fire once for completion or abort, exclude probes and contain no request/response bodies, query strings, raw URLs, cookies or credentials. Use a registered route template, or a fixed unmatched-route marker rather than attacker-supplied URL text.

**Sanitized errors only.** All API/worker/migration/probe logging supplies `err: { type, code }` as a plain allow-listed object. Unknown errors become fixed type/code values. No raw Error objects, message, stack, cause, SQL, URL-bearing errors or driver properties enter Pino; fixed safe event messages replace arbitrary exception messages. Thus 500 diagnosis retains correlation and safe error classification, not stack traces. Diagnostic CLI follows the same restriction.

Pino redaction uses exact paths with censor `[REDACTED]`:

```text
req.headers.authorization
req.headers.cookie
req.headers["set-cookie"]
res.headers["set-cookie"]
headers.authorization
headers.cookie
headers["set-cookie"]
password
current_password
new_password
temporary_password
token
secret
session
credential
credentials
authorization
cookie
["set-cookie"]
data.password
data.temporary_password
body.password
body.currentPassword
body.newPassword
err.message
err.stack
err.cause
```

These paths defend known accidental object shapes; they are not recursive key-name magic. Avoid raw request/response logging and sanitize before logging. Test root/nested/serialized inputs, bracket set-cookie paths and URL-bearing driver errors to prove no leak. Redaction alone cannot remove a secret embedded in an arbitrary message string.

## 9. Health / Readiness / Graceful Shutdown

Preserve `GET /api/v1/health` with its current cheap liveness response. Add `/api/v1/health/live` for explicit liveness and `/api/v1/health/ready` for readiness under the same global prefix. No root `/health` aliases. The previous draft's unprefixed claim conflicted with controller/bootstrap/README evidence.

Liveness checks process response only, not dependencies. Readiness returns 200 only when not stopping and bounded PostgreSQL probe succeeds; otherwise sanitized 503 with no infrastructure details. All probes use Cache-Control no-store and bypass auth limiter/CSRF on their safe GET paths. Probe failures produce rate-controlled sanitized events, not routine completion logs. Caddy health routing targets the prefixed readiness URL; runtime itself refuses newly admitted work once shutdown starts even if proxy health observation lags.

Section 5 exclusively defines API drain/DB hook order; Section 7 defines worker heartbeat, local CLI, owners and forced exit semantics.

## 10. Web Production Hardening

Vercel is primary. Preserve Next's default output and existing test distDir configuration (`apps/web/next.config.ts:3-10`), **including any Docker Web artifact**. No standalone switch or Docker exception. Optional Docker Web remains a compatibility artifact, not a new primary hosting target.

Next `headers()` is the canonical Web header owner; Vercel emits those configured headers. Do not duplicate conflicting policy in Vercel configuration. Production HTTPS Web HSTS is `max-age=15552000`, without preload/includeSubDomains. Also emit nosniff, X-Frame-Options DENY and Referrer-Policy strict-origin-when-cross-origin.

P0 CSP is exactly the baseline directives `base-uri 'self'; object-src 'none'; frame-ancestors 'none'`. This deliberately does not set default-src/script-src/style-src and therefore does not break Next inline hydration or invent nonce wiring. Strict script-src/nonces and expanded connect-src policy are deferred until independently designed and browser-tested; no claim of strict script protection is made.

Add accessible segment/root error boundaries, retry/reload navigation, and network-failure feedback while preserving server conflict/authorization codes. Keep credentialed login/me/logout. Logout must check Better Auth success and correctly forward cookie deletion headers; local state clearing after a failed request is not evidence that the persisted session was invalidated. Transport loss means unknown outcome; never auto-retry mutations.

## 11. Deployment / Migration Safety

**One production artifact.** Proposed `database/src/migrate.ts` compiles to `database/dist/migrate.js`. Migration image command is `node database/dist/migrate.js`, with production `drizzle-orm/postgres-js/migrator`, `drizzle-orm/postgres-js` and `postgres`, plus the checked-in `database/drizzle` SQL and metadata/journal. These dependencies already exist in production dependencies (`database/package.json:30-32`). No drizzle-kit, tsx, development tooling or TypeScript source is required in the runner. Existing drizzle-kit command remains development-only, not an alternative production runner.

**Single-session lock.** Runner uses a dedicated direct/session-affine PostgreSQL endpoint, verified TLS, and one private postgres client with `max: 1`; no runtime consumers share it. Acquire a fixed environment/database-scoped session advisory lock with pg_try_advisory_lock before invoking migrate on drizzle of that same client. A lock held by another runner fails nonzero rather than running concurrently. Lock encompasses migration-table creation/read and the migrator's own transaction; unlock in finally on the same session, then close the client.

Installed ORM migrator delegates on the supplied db/session (`database/node_modules/drizzle-orm/postgres-js/migrator.js:1-4`), dialect reads journal state before its transaction (`database/node_modules/drizzle-orm/pg-core/dialect.js:44-71`), and postgres-js transaction invokes the same client's begin (`database/node_modules/drizzle-orm/postgres-js/session.js:108-120`). Therefore no shell-launched drizzle-kit connection may perform the migration outside the lock. A max1 private client preserves one physical session while connected: disable idle/lifetime recycling during the run, treat disconnect/reconnect as fatal, and verify backend PID continuity through lock, journal access, migration transaction and unlock. A transaction-mode pooler cannot preserve a session advisory lock and is forbidden for this runner.

Use Section 5 connect/statement/lock bounds and a 60-second outer runner cap; timeout exits nonzero and blocks release, never claims unverified cancellation. Existing migrations must pass within this bound before release; do not silently loosen runtime settings or rewrite SQL. Phase 12 expects no new schema migration. Deploy operator runs the artifact once per release; re-invocation reads Drizzle journal, not seeds. Failure or lock contention blocks the new API/worker rollout. No auto-migration on app startup, schema push, down migration or production seed.

**Images.** Select official trusted Node **22 Debian slim**, pinned by a real reviewed multiarch manifest digest before release; no fictitious digest is specified here. Record exact tag/digest/provenance in release evidence, consistent with external ADR-019 and reproducible-image policy (`../Documentation/Technical/Floz_Technical_Design_Architecture_Free_Bootstrap.md:172,1323-1333,1691`). Build linux/amd64 and linux/arm64 with frozen pnpm lock, correct workspace context/build order, production-only dependency closure and non-root runtime. No secrets in build args/context/layers. Validate executable paths from emitted artifacts, not guesses. Smoke both architectures with actual native dependencies, CA certificates and production entrypoints; cross-build success alone is insufficient. Next output remains default for Docker too. Digest selection is release preparation, not an open architectural choice.

## 12. Backup / Recovery Expectations

**Resolved P0 architecture:** independent PostgreSQL backup to a **dedicated private Cloudflare R2 backup bucket**, not an attachments bucket, under prefix **`postgres/<environment>/`**. Bucket name/account/credentials are Gate B provisioning values, not unresolved storage choices. Pilot targets are **RPO 24 hours, RTO 4 hours**, accepted design objectives requiring measured evidence, not provider guarantees. External architecture permits R2 when encryption, credential separation and retention are explicit (`../Documentation/Technical/Floz_Technical_Design_Architecture_Free_Bootstrap.md:1519-1533`) and keeps Redis nonauthoritative (`:1539-1545`).

**Canonical pipeline:** serial `pg_dump --format=custom` over libpq `sslmode=verify-full` streams stdout directly into **age recipient encryption**; never write a plaintext dump to disk. Use a pinned age CLI with an X25519 public recipient, not passphrase encryption or custom cryptography. Hash the resulting encrypted `.dump.age` bytes with **SHA-256**, then upload that encrypted artifact to the dedicated R2 prefix with safe metadata: backup ID/environment, snapshot-start and completion timestamps, encrypted byte count, encrypted SHA-256, dump/server/tool versions, migration journal position and recipient identifier. Metadata contains no credentials, decrypted data or age identity. A restricted encrypted staging file is allowed to calculate the checksum before upload; remove it on completion/failure. Check every child exit and upload result; a successful encryption/upload must not mask a failed pg_dump. Verify the remote encrypted artifact by download/hash (do not equate multipart ETag with SHA-256) before publishing last-success metadata. Hashes detect corruption; age authentication and restricted object access provide the separate cryptographic/access controls.

**Packaging contract, not a stop condition now.** The repository currently has only a source-based Node22 Alpine worker image (`infra/docker/worker.Dockerfile:1-6`), not an installed backup/age toolchain. The selected production base is Node22 Debian slim (Section 11). Package the backup utility with a pinned distro age package from a trusted snapshot; if that package cannot supply both targets, use pinned official standalone age binaries with verified checksums/provenance for each target. Do not add a Node crypto wrapper/dependency. Gate A must verify installation and an actual encrypt/decrypt round-trip on **linux/amd64 and linux/arm64**, along with compatible pg_dump/pg_restore and the R2 upload client. Package versions, digest and binary compatibility are implementation evidence, not an unresolved architectural decision and not a reason to stop this design closure. This follows repo-adjacent multiarch constraints (`../Documentation/Technical/Floz_Technical_Design_Architecture_Free_Bootstrap.md:1323-1338`); no unverified platform availability is claimed.

**Key/access separation.** The backup process receives only the public age recipient plus source read credentials and bucket-scoped upload/verification credentials. The private age identity lives separately in operator-controlled secret storage, never in the backup bucket, source DB, runtime image, repository, logs or routine backup environment. Restore operators receive identity/read access only for the isolated restore. Retention deletion credentials are separately scoped; never reuse attachment credentials. Preserve prior identities until archives encrypted to them expire, and verify identity availability in recovery rehearsals.

Retain **7 daily and 4 weekly** successful encrypted archives, selected by UTC day/week; weekly selection uses an already successful archive and need not trigger another dump. Never delete an archive still selected by either retention class. Rotation occurs only after a replacement and its metadata are verified; a failed attempt never displaces the last usable backup. Phase 13 schedules at least daily backups, allowing enough completion/failure-recovery margin to keep the latest recoverable snapshot **no older than 24 hours**; also take a fresh archive before each migration/release. Measure age from snapshot start, not upload completion. Record last-success timestamp, object identifier/checksum and verification status. Dump/encryption/upload/hash/metadata failure exits nonzero, leaves last-success unchanged and blocks Gate B release until recovered. No promise of historical 7/4 copies on the first day: retention behavior is deterministically tested in Gate A and the real history accumulates under Gate B operations.

**Gate A — Phase 12 engineering:** exercise the full pipeline against a disposable PostgreSQL database and a controlled S3-compatible fixture, with real pg_dump/age/SHA-256/pg_restore and deterministic corruption, failure, age and retention cases. Retrieve/hash the encrypted artifact, decrypt with the separately supplied identity, restore with serial `pg_restore --exit-on-error --no-owner --no-privileges` into a new isolated database, and verify migration journal, representative relations/counts, constraints and auth/business integrity (including sessions/accounts, workspace isolation, outbox and notification deduplication). Restore from a restricted temporary decrypted custom archive if seekable input is needed, delete it after verification, never log its contents. Record elapsed recovery; fixture timing is not production RTO proof. No production deployment or actual R2 credentials are needed for this technical acceptance.

**Gate B — Phase 13 operational:** operator performs the first **actual environment** independent R2 backup, download/hash/decrypt and isolated pg_restore rehearsal, verifies the same integrity checks, measures recovery against **4 hours** and snapshot age against **24 hours**, and records evidence before launch. The target is never production and never shares its database identity. Recurring backups, repeated restore rehearsals, monitoring/alerts, incident runbooks and quota checks remain Phase 13. Provider snapshots may supplement, not replace, the independent encrypted archive. Failed jobs are diagnostics, not a business-data backup.

## 13. Environment & Secret Configuration

Central `@floz/config` validates per-service requirements before resource creation. API requires database/auth/origin config; worker requires database/Redis; Web requires public API origin; runner requires direct migration database credentials. Do not require Web to receive DB/auth secrets. Production NODE_ENV must be explicit in deployment, public URLs HTTPS and origins exact; generate BETTER_AUTH_SECRET from at least 32 random bytes, reject placeholders/weak values. Development/test alone may use localhost defaults. Errors expose key names, never values.

`ALLOWED_ORIGINS` is canonical. During compatibility transition accept legacy singular ALLOWED_ORIGIN only as a one-origin equivalent; if both are supplied their normalized sets must agree or startup fails. Do not silently prefer conflicting values. Web API origin, Better Auth base URL, cookie scope and trusted origins must fit the approved domain topology; API origin and Web origin need not be identical.

**Canonical production TLS precedence (all hosts, no localhost production exemption):**

| Input | Required result |
|---|---|
| PostgreSQL DB_SSL=false | Reject, regardless of URL or host |
| PostgreSQL URL sslmode=disable/allow/prefer | Reject, even with DB_SSL=true |
| PostgreSQL DB_SSL unset/true, URL require | Accept only after upgrading to explicit certificate/hostname-verified TLS; never pass insecure require semantics through unchanged |
| PostgreSQL DB_SSL unset/true, no URL TLS mode or verify-full | Use verified TLS, system roots or explicitly supplied provider CA, rejectUnauthorized true, verified hostname |
| Other/duplicate contradictory PostgreSQL TLS modes or insecure TLS flags | Reject; no silent precedence or insecure fallback |
| Redis rediss://, REDIS_TLS unset/true | Verified TLS accepted |
| Redis rediss://, REDIS_TLS=false | Reject contradiction |
| Redis redis://, REDIS_TLS=true | Explicit upgrade to verified TLS accepted |
| Redis redis://, REDIS_TLS unset/false | Reject in production, including localhost |

Parse flags as tri-state unset/true/false before defaults; do not turn unset into false. Verified TLS always includes certificate chain and hostname validation. No rejectUnauthorized false, NODE_TLS_REJECT_UNAUTHORIZED=0 or silent plaintext fallback. Dev/test localhost PostgreSQL/Redis may be plaintext when explicitly scoped to those environments; no insecure remote production default. Apply normalization to every pool, networked diagnostic/dependency-readiness CLI, migration runner and backup client; the local worker health CLI creates no network clients. Backup libpq uses verify-full, not the Postgres.js-specific require upgrade behavior.

Provision production env, provider CA material, direct migration endpoint, Caddy trusted source and Vercel public API URL **before** rollout. Runtime timeout defaults are Section 5; validation rejects nonpositive/contradictory shutdown budgets.

## 14. Failure Semantics

| Failure | Canonical result |
|---|---|
| Unsafe cookie mutation/login with missing/null/unapproved Origin | 403 FORBIDDEN before work; applies to nonbrowser cookie clients too |
| Disallowed CORS Origin | No credentialed allow-origin header; unsafe cookie work also rejected by CookieOriginGuard, not CORS alone |
| Auth quota or new-key capacity exceeded | 429 RATE_LIMITED, Retry-After ceil seconds >=1 per Section 4 |
| Unknown payload property/type | 400 VALIDATION_ERROR with no raw values |
| Body above 1 MiB | 413 PAYLOAD_TOO_LARGE canonical envelope |
| Unexpected application exception | 500 INTERNAL_ERROR; sanitized err type/code only |
| Header/body receive bound | Node 408/transport close as applicable; no promised application envelope |
| Idle keepalive expiry | Connection closes without synthetic business response |
| Caddy dial failure / client transport abort | Gateway failure or lost connection; mutation outcome may be unknown; no automatic mutation retry |
| API readiness timeout/PG failure/stopping | Sanitized 503 within Section 5 bounds; no Redis dependency or extra pool |
| Worker local heartbeat stale/wrong-instance/stopping/progress failure | Local health CLI nonzero without DB/Redis calls; stale startup files removed before healthy |
| Explicit worker readiness dependency/timeout/cleanup failure | CLI nonzero within 3 seconds; PG/Redis 2 seconds each, no overlapping replacement |
| API/worker forced shutdown | Exit 1 by outer deadline; no false cancellation/rollback claim |
| Worker lock loss/replay | Stalled recovery and DB-idempotent processing; not exactly-once delivery |
| TLS contradiction/unverified cert | Startup/check failure; no plaintext fallback |
| Migration lock contention/failure/disconnect | Runner nonzero; new runtime rollout blocked |
| Backup pipeline/fixture restore failure | Gate A blocked by deterministic engineering failure |
| Actual backup stale/failure or actual-environment restore unverified | Gate B launch blocked; visible last-success timestamp and failure |

Every logged failure follows Section 8; raw exception payloads and origin/URL-bearing error messages are excluded.

## 15. Test Strategy

Design-only revision: **do not execute runtime gates now**. Later implementation evidence must cover:

1. Production config matrix including every Section 13 tri-state/TLS combination, certificate/hostname failure, missing secrets, conflicting origins and localhost production rejection.
2. Real Nest ingress tests for guard ownership/order, auth direct-call routes, and all unsafe cookie mutation categories. Missing/null/unapproved Origin returns 403 for browsers and nonbrowser clients; existing tests supplying cookie mutations must send approved Origin rather than disable protection.
3. Auth limiter exact 10/60-second window, 11th denial, shared per-IP accounting, expiry, 10,000-key cap, no active-key eviction, capacity failclosed, Retry-After rounding, spoofed forwarded chain rejection, direct-ingress block and probe exclusion.
4. DTO runtime coverage including inline/type-only payloads, exact 1 MiB boundary, malformed/oversize parser errors, whitelist/forbid/transform without implicit conversion.
5. Credentialed browser login/me/logout, deletion cookie attributes, persisted-session invalidation and failed-logout UX. Public Better Auth signup stays unmounted.
6. Canonical request ID acceptance/replacement and single completion/abort log. Capture Pino actual serialized output to check all redact paths and sanitized err; raw messages, stack, URLs, bodies/query/credentials must be absent.
7. API signal coordinator: sole signal owner, not-ready before server close, admitted-request drain, pool hook only after drain/forced close, repeated signals, exit0/forced1 and exact 30/35-second boundaries. No mutation-cancellation assertion.
8. Worker close(false) graceful behavior, cached close(true) non-escalation, long job/loop termination, exact DB owners/caps/normal7/readiness8/maintenance10 totals and 30/35-second bounds. Heartbeat 15-second write, identity, age45, startup stale cleanup before healthy, stopping and hung-progress failures; Docker local-only interval30/start30/timeout5/retries3 with no PG/Redis activity.
9. Explicit worker readiness PG/Redis probes at 2 seconds each/3 seconds overall, single-flight/cleanup and deploy/operator/Phase13-only cadence; API PG probe borrowing with no Redis/new pool. TLS failure, Redis reconnect/quota behavior, queue attempts/backoff/retention exact values; diagnostic CLI cannot mutate/re-drive.
10. Failure replay around outbox claim, notification DB commit before dispatch mark, stale lease ownership, Redis add/ack loss, worker SIGTERM/forced interruption, stalled replay and recurrence duplicates. Assert stable event identity, no duplicate notifications/tasks and preserved pending/retry state using `database/src/outbox.ts:11-20`, `database/src/notification-core.ts:40-54,181-201`, `apps/worker/src/generate-due-occurrence.ts:19-41`. Existing foundations are evidence to preserve, not a substitute for failure tests.
11. Migration artifact on clean/populated databases, re-run journal behavior, competing runner lock, backend PID continuity, session loss failclosed and failure blocking release. Existing SQL/meta unchanged; no Phase 12 schema migration expected.
12. Gate A disposable custom pg_dump → age recipient encryption → encrypted SHA-256 → controlled S3 fixture, metadata/7-daily/4-weekly/failure tests and isolated pg_restore integrity. Gate B later supplies actual dedicated-R2 age/RPO/RTO evidence; do not conflate them.
13. Full regression/E2E across Phase 9 admin/auth, Phase 10 collaboration and Phase 11 workflow/archived status paths; CSP hydration and controlled credentialed origins. Header owner verified on served responses.
14. linux/amd64 and linux/arm64 production runtime smoke with native dependencies, non-root user, trusted pinned digest, image secret/dependency checks, age install plus encryption/decryption round-trip, compatible PostgreSQL client tools and default Next output.

Repository quality commands remain `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` (`README.md:7-14`; `package.json:8-12`); clean DB verification uses existing `scripts/test-clean-db.ps1`. These are future implementation gates, not commands executed by this documentation change.

## 16. Production Readiness Gates

**Gate A — Phase 12 engineering acceptance (P0, deterministic, no production deploy).** Record controlled-fixture evidence for all Section 15 engineering contracts: guard/CSRF/limiter; payload/header/log safety; verified TLS matrix; prefixed API probes; local-only worker health and separate single-flight readiness; exact Section 6 owner caps/totals; stale cleanup before healthy startup; ordered bounded shutdown; replay safety; compiled session-locked migrator; encrypted backup/hash/retention/failure handling and isolated fixture restore; regression/E2E and quality checks. Build and smoke trusted pinned production artifacts on amd64/arm64, including age package/binary round-trip verification. Test Caddy forwarding/direct-access controls in controlled networking and credentialed Web behavior on controlled HTTPS origins. All real encryption/dump/restore operations use disposable data and controlled storage, not a mocked claim that a production backup exists. No Oracle/Neon/Upstash/R2 production credentials, real domain allocation, actual provider quota or public deployment is a Gate A prerequisite.

**Gate B — Phase 13 operational launch acceptance (actual environment).** Before admitting production traffic, verify provisioned domains and cookie behavior; exact Caddy IP/narrow CIDR and firewall isolation; secrets/CA/direct session endpoints; permitted Vercel use; actual Oracle/Neon/Upstash/R2 availability, quotas and connection headroom; approved readiness cadence accounting for idle BullMQ traffic; and served TLS/header/origin behavior. Require an actual independent encrypted R2 archive within 24 hours, fresh pre-release backup, successful isolated actual-environment restore with integrity checks and measured RPO24h/RTO4h, deployment migrator evidence, rollout smoke, monitoring/alerts/runbooks and pilot UAT/launch approval. Gate A success does not establish any of these operational facts.

**Exact priority boundary.** P0 includes every fixed security, resource-budget, local health/readiness, shutdown, packaging, migration and backup engineering contract above. P1 is only the optional enhancement list in Section 18; P0 does not depend on distributed limiting, metrics platforms, centralized shipping, throughput tuning or enhanced client reporting. Gate B is mandatory operational acceptance, not optional P1. Tracing, strict script CSP and DLQ/re-drive remain future. Neither gate is claimed passed by this design edit; no schema migration or Next standalone conversion is authorized.

## 17. Rollout / Compatibility

This is the Gate B operational sequence after Gate A acceptance, not a request to deploy during Phase 12 design closure.

1. Confirm domains/cookie behavior, exact Caddy trust boundary, backup targets and Vercel permitted use. Provision env/secrets/CA material and direct migration endpoint before release.
2. Validate TLS from Oracle A1, blocked direct API ingress, Caddy forwarded-header replacement and Web/API allowed origins.
3. Resolve and record trusted Node22 Debian slim multiarch manifest digest; build production dependency closure, smoke amd64/arm64 with native dependencies. Preserve default Next output even for optional Web Docker.
4. Gate B: verify actual dedicated-R2 encrypted archive is within 24 hours, take a fresh pre-release archive, then record the isolated actual-environment restore and integrity/RTO evidence.
5. Deploy operator invokes the one compiled migration artifact. Failure, contention or session loss blocks new API/worker rollout. Existing runtime policy during failure must not expose partially verified new code.
6. Start API/worker, require prefixed API readiness and runtime-aware worker health, then admit Caddy traffic. A single-process pilot may have a maintenance interval; no zero-downtime claim.
7. Deploy Web through Vercel with already-provisioned public API origin and Next-owned headers; perform credentialed auth/logout and regression smoke.

Preserve `/api/v1/health`, existing auth routes/envelopes, Better Auth ownership, Phase 9 and existing migration history. Stricter Origin/unknown-property enforcement is intentional compatibility tightening; update approved clients/tests before rollout, never use a production security bypass to preserve missing-Origin behavior.

Rollback restores prior app/image/env/proxy configuration only when compatible with the current forward schema. No automatic down migration. If a future migration crosses compatibility boundaries, restore/forward-fix requires operator approval and recovery evidence; socket failure does not justify retrying uncertain mutations. CORS/TLS/header errors may require configuration rollback independent of app image rollback.

## 18. Deferred Work

**P1:** global/distributed rate limits before multiple API processes; basic metrics, centralized log shipping and measured pool/provider tuning; enhanced client error reporting. P1 is not a Gate A or Gate B blocker.

**Phase 13 / Gate B operations:** actual-environment backup/restore evidence, recurring backup schedule and repeated restore rehearsals; provider quota/headroom verification and approved readiness cadence; monitoring/alerts, incident/runbooks, pilot UAT and launch approval. These operational conditions are mandatory before launch, not P1.

**Future:** strict script-src/nonce CSP, OpenTelemetry, Kubernetes/service mesh, read replicas/multi-region, DLQ/re-drive functionality, auth invitation/reset redesign and commercial hosting upgrade when required. No future re-drive capability is implied by failed-job retention or the read-only diagnostic CLI.

## 19. Open Design Decisions

Phase 12 design decisions are closed. Canonical contracts are the fixed values in Sections 4–18: exact approved HTTPS origins and cookie topology are supplied as Gate B environment evidence; Caddy trust is the deployment-approved narrow source boundary; pilot objectives are RPO 24 hours and RTO 4 hours; worker heartbeat is 15 seconds; Docker local health is interval 30 seconds, start period 30 seconds, timeout 5 seconds, retries 3, with no DB/Redis calls; dependency readiness is explicit/deployment/Phase13-cadence only at 2 seconds each and 3 seconds overall; stale heartbeat cleanup precedes healthy state; combined API/worker normal runtime ceiling is 7, runtime-plus-readiness 8, maintenance 10; backup is custom pg_dump → age recipient → encrypted SHA-256 metadata → dedicated R2 prefix with 7 daily/4 weekly retention and separate identity.

No design choice remains open. Gate A is deterministic engineering evidence with no production deploy. Gate B is actual-environment Phase 13 operational acceptance. Neither gate is passed by this document.
