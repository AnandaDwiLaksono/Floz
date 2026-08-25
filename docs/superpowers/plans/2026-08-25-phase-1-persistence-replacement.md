# Phase 1 Persistence Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace runtime in-memory Floz storage with PostgreSQL repositories and Better Auth 1.7.1 persistence while preserving API envelopes and isolation rules.

**Architecture:** Better Auth owns canonical users/accounts/sessions/verifications through its Drizzle adapter. FlozService becomes a PostgreSQL repository/service over Drizzle for profile projection, workspace memberships, teams, and team memberships. Nest tests use a disposable PostgreSQL database seeded only by test setup; production has no fallback store.

**Tech Stack:** NestJS 11, Better Auth 1.7.1, Drizzle ORM 0.45.2, PostgreSQL 16, Vitest, Supertest, pnpm.

## Global Constraints

- No runtime in-memory canonical business storage or hardcoded production credentials.
- Preserve `/api/v1` paths, response envelopes, status codes, and isolation/reference rejection behavior.
- Better Auth owns auth/session lifecycle; `floz_session` is secure HttpOnly transport.
- Floz roles/policies remain outside Better Auth.
- Phase 2 excluded.

### Task 1: Database and Better Auth schema compatibility

**Files:** `database/src/schema.ts`, generated migration files, `database/src/seed.ts`, `.env.example`, `infra/docker-compose.yml`.

- [ ] Verify Better Auth 1.7.1 Drizzle adapter schema/API from installed declarations.
- [ ] Align canonical tables/columns with adapter requirements while retaining Floz fields and relations.
- [ ] Generate and apply a clean migration; remove duplicate/obsolete migration ambiguity.
- [ ] Make seed idempotent and test-only credentials explicit via environment variables, never runtime fallback.
- [ ] Add PostgreSQL service/environment wiring.
- [ ] Run migration and seed against disposable PostgreSQL.

### Task 2: Failing real database integration tests

**Files:** `apps/api/test/auth.test.ts`, `apps/api/test/api.test.ts`, new test helpers only if required.

- [ ] Replace in-memory assumptions with database-backed setup using `DATABASE_URL`.
- [ ] Add failing tests for login persistence after service/module recreation, logout invalidation, workspace/team reads, mutation authorization, tenant isolation, and cross-workspace reference rejection.
- [ ] Run tests and confirm expected failures before implementation.

### Task 3: Better Auth integration

**Files:** `apps/api/src/auth.ts`, `apps/api/src/app.module.ts`, `apps/api/src/main.ts`, `apps/api/src/floz.controller.ts`, package scripts/dependencies.

- [ ] Configure Better Auth 1.7.1 with installed Drizzle adapter, email/password, canonical database, secure cookie settings, and API handler.
- [ ] Route login/logout/session lookup through Better Auth APIs; preserve existing Floz response envelope and cookie name/path.
- [ ] Remove hardcoded admin/password and all session maps.
- [ ] Resolve current user from Better Auth session, then load Floz profile fields from canonical user row.
- [ ] Run focused auth tests to green.

### Task 4: PostgreSQL repositories and policies

**Files:** `apps/api/src/floz.service.ts`, `apps/api/src/policy.service.ts`, `apps/api/src/floz.controller.ts`, module wiring.

- [ ] Implement Drizzle queries for users, memberships, workspaces, teams, and team memberships.
- [ ] Preserve envelope shapes and HTTP errors.
- [ ] Enforce active membership and ADMIN mutation policy in database queries/service boundaries.
- [ ] Enforce manager/member references belong to the target workspace.
- [ ] Run full API integration tests to green.

### Task 5: Verification and documentation

**Files:** `docs/implementation/PHASE_1_REPORT.md`, `docs/implementation/IMPLEMENTATION_STATUS.md`.

- [ ] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- [ ] Record exact commands/results, migration/seed verification, integration coverage, and blockers.
- [ ] Confirm no Phase 2 work added and no in-memory production fallback remains.
