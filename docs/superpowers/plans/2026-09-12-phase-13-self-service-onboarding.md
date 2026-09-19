# Phase 13 — Self-Service Onboarding, Workspace Creation, Invitations & Join Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement full self-service onboarding, email verification, atomic workspace creation, invitations, Join Code/Link, Workspace ID approval requests, and local dev email capture while preserving security, RBAC, multi-tenant isolation, and Admin Provisioning fallback.

**Architecture:** Modular Monolith + BullMQ Worker + Outbox. API layer in NestJS (`apps/api`), Web layer in Next.js (`apps/web`), DB schema in Drizzle ORM (`database`), background email outbox processing in BullMQ worker (`apps/worker`).

**Tech Stack:** Node.js 22, NestJS, Next.js (App Router), PostgreSQL 16, Drizzle ORM, Better Auth 1.7.1, BullMQ, Vitest, Playwright.

## Global Constraints
- Node >= 22.0.0, pnpm 9.15.4.
- DB pool limits: API max 2, Worker max 1. Worker concurrency = 1.
- No plaintext tokens or raw Join Codes saved in DB or logged in production logs.
- All email verification, invitations, Join Codes, and Workspace ID join requests require `user.email_verified === true`.
- Zero automated tests depend on live Resend endpoints.

---

### Task 1 (Gate 13A): Database Schema Extensions & Migration 0009

**Files:**
- Modify: `database/src/schema.ts`
- Create: `database/drizzle/0009_phase13_self_service_onboarding.sql`
- Test: `database/test/phase13-schema.test.ts`

**Interfaces:**
- Consumes: Existing Drizzle schema (`workspaces`, `users`, `roles`).
- Produces: `join_policy` on `workspaces`, tables `workspace_invitations`, `workspace_join_requests`, `workspace_join_codes`.

- [ ] **Step 1: Update Drizzle Schema**
  Add `joinPolicy` to `workspaces`. Define `workspaceInvitations`, `workspaceJoinRequests`, and `workspaceJoinCodes` with constraints.

- [ ] **Step 2: Generate Migration 0009 SQL**
  Create `database/drizzle/0009_phase13_self_service_onboarding.sql` with clean `ALTER TABLE` and `CREATE TABLE` DDL.

- [ ] **Step 3: Write Schema Tests**
  Write tests in `database/test/phase13-schema.test.ts` to assert constraints, partial indexes, and status enums.

- [ ] **Step 4: Run Tests**
  Run `pnpm --filter @floz/database test` and ensure all tests PASS.

- [ ] **Step 5: Commit**
  `git commit -m "feat(db): add Phase 13 self-service onboarding schema and migration 0009"`

---

### Task 2 (Gate 13B): Public Registration, Email Verification & Local Mailbox Adapter

**Files:**
- Create: `apps/api/src/email-adapter.ts`
- Modify: `apps/api/src/auth.ts`, `apps/api/src/floz.controller.ts`, `apps/api/src/floz.service.ts`
- Modify: `apps/web/app/register/page.tsx`, `apps/web/app/verify-email/page.tsx`
- Test: `apps/api/test/auth-registration.test.ts`

**Interfaces:**
- Consumes: Better Auth server API, Outbox queue.
- Produces: `POST /api/v1/auth/register`, `POST /api/v1/auth/verification/resend`, local `.dev-mailbox.json`.

- [ ] **Step 1: Write Email Delivery Adapter Module**
  Implement `ResendEmailAdapter`, `DevMailboxEmailAdapter`, and `InMemoryEmailAdapter`.

- [ ] **Step 2: Implement Registration & Resend Endpoints in API**
  Mount `POST /api/v1/auth/register` and `POST /api/v1/auth/verification/resend` with `AuthRateLimitGuard`.

- [ ] **Step 3: Create Registration & Verification UI in Web**
  Create UI pages `/register` and `/verify-email`.

- [ ] **Step 4: Run API & Web Tests**
  Run `pnpm --filter @floz/api test` and `pnpm --filter @floz/web test`.

- [ ] **Step 5: Commit**
  `git commit -m "feat(auth): implement public registration, email verification and dev mailbox"`

---

### Task 3 (Gate 13C): Atomic Workspace Self-Creation & Onboarding Hub

**Files:**
- Modify: `apps/api/src/floz.controller.ts`, `apps/api/src/floz.service.ts`
- Create: `apps/web/app/onboarding/page.tsx`, `apps/web/app/onboarding/create-workspace/page.tsx`
- Modify: `apps/web/app/page.tsx`
- Test: `apps/api/test/workspace-creation.test.ts`

**Interfaces:**
- Consumes: User auth context, `email_verified` guard.
- Produces: `POST /api/v1/workspaces`, `/onboarding` hub.

- [ ] **Step 1: Implement Atomic Workspace Creation API**
  Add `POST /api/v1/workspaces` checking `user.email_verified`. Execute DB transaction for workspace + membership (ADMIN), relying on DB trigger for workflow seeding.

- [ ] **Step 2: Implement Onboarding Hub & Creation UI**
  Replace dead-end "No workspace access yet" on `/` with redirect to `/onboarding`. Build `/onboarding` hub and `/onboarding/create-workspace`.

- [ ] **Step 3: Run API & Web Tests**
  Run tests and verify exit code 0.

- [ ] **Step 4: Commit**
  `git commit -m "feat(workspace): add atomic workspace creation and onboarding hub"`

---

### Task 4 (Gate 13D): Workspace Invitation Lifecycle

**Files:**
- Create: `apps/api/src/invitation.service.ts`
- Modify: `apps/api/src/floz.controller.ts`
- Create: `apps/web/app/invitations/accept/page.tsx`, `apps/web/app/workspaces/[workspaceId]/settings/members/page.tsx`
- Test: `apps/api/test/invitation-lifecycle.test.ts`

**Interfaces:**
- Consumes: Outbox worker, DB schema `workspace_invitations`.
- Produces: `POST /workspaces/:wid/invitations`, `/invitations/accept`.

- [ ] **Step 1: Implement Invitation API Services & Endpoints**
  Add endpoints for create, resend, revoke, list, preview token, accept, and decline invitation. Store token hashes only.

- [ ] **Step 2: Build Web Accept & Admin Member Invitation UI**
  Build landing page `/invitations/accept?token=...` and update Admin Members page with primary `[ Invite Member ]`.

- [ ] **Step 3: Run Tests**
  Run `pnpm --filter @floz/api test` and assert all invitation scenarios PASS.

- [ ] **Step 4: Commit**
  `git commit -m "feat(invitations): implement workspace invitation lifecycle and accept flow"`

---

### Task 5 (Gate 13E): Join Code & Join Link

**Files:**
- Create: `apps/api/src/join-code.service.ts`
- Modify: `apps/api/src/floz.controller.ts`
- Create: `apps/web/app/join/page.tsx`, `apps/web/app/workspaces/[workspaceId]/settings/join/page.tsx`
- Test: `apps/api/test/join-code.test.ts`

**Interfaces:**
- Consumes: DB schema `workspace_join_codes`, `join_policy`.
- Produces: `POST /workspaces/:wid/join-code`, `/join?code=...`.

- [ ] **Step 1: Implement Join Code Admin & Self-Join API**
  Add endpoints for join-settings, generate, rotate, revoke, preview, and join-by-code. Set `Cache-Control: no-store`.

- [ ] **Step 2: Build Join UI and Admin Join Settings**
  Build `/join` page (capturing `code` param) and Admin `/settings/join` UI.

- [ ] **Step 3: Run Tests**
  Run API tests for Join Code hash, rotation, and revocation.

- [ ] **Step 4: Commit**
  `git commit -m "feat(join-code): implement Join Code generation, rotation, and self-join link"`

---

### Task 6 (Gate 13F): Workspace ID Lookup & Join Request Approval Workflow

**Files:**
- Create: `apps/api/src/join-request.service.ts`
- Modify: `apps/api/src/floz.controller.ts`
- Modify: `apps/web/app/join/page.tsx`, `apps/web/app/workspaces/[workspaceId]/settings/members/page.tsx`
- Test: `apps/api/test/join-request.test.ts`

**Interfaces:**
- Consumes: DB schema `workspace_join_requests`.
- Produces: Exact UUID lookup, PENDING join requests, Admin approve/reject.

- [ ] **Step 1: Implement Workspace ID Preview & Join Request API**
  Add endpoints to preview workspace ID policy, submit join request, list pending requests, cancel, approve, and reject.

- [ ] **Step 2: Connect Join Requests to UI**
  Update `/join` for exact ID lookup and request approval feedback; add Join Requests tab in Admin Members UI.

- [ ] **Step 3: Run Tests**
  Verify join request lifecycle and atomic approval.

- [ ] **Step 4: Commit**
  `git commit -m "feat(join-request): implement Workspace ID join request and Admin approval workflow"`

---

### Task 7 (Gate 13G): Workspace Switcher Extension & Provision Fallback Regression Test

**Files:**
- Modify: `apps/web/components/shell.tsx`, `apps/web/lib/auth-context.tsx`
- Test: `apps/api/test/provision-fallback.test.ts`

**Interfaces:**
- Consumes: Auth context workspace list.
- Produces: Extended workspace switcher with `+ Create Workspace` and `+ Join Workspace`.

- [ ] **Step 1: Update Web Auth Context & Switcher**
  Add `+ Create Workspace` and `+ Join Workspace` options in desktop header and mobile drawer. Ensure workspace list refreshes seamlessly.

- [ ] **Step 2: Verify Provision Account Fallback Regression**
  Run integration tests for `POST /workspaces/:wid/accounts` to guarantee Admin Provisioning remains functional.

- [ ] **Step 3: Commit**
  `git commit -m "feat(web): extend workspace switcher and verify Provision Account fallback"`

---

### Task 8 (Gate 13H): Security, Concurrency & Rate Limit Hardening

**Files:**
- Modify: `apps/api/src/auth-rate-limit.guard.ts`, `apps/api/src/cookie-origin.guard.ts`
- Test: `apps/api/test/phase13-security.test.ts`

**Interfaces:**
- Consumes: NestJS guards & middleware.
- Produces: Hardened rate limits and origin protection for Phase 13 endpoints.

- [ ] **Step 1: Update Rate Limiter & Security Guards**
  Cover `/auth/register`, `/workspace-joins`, `/workspace-invitations/accept` with rate limiting and origin checks.

- [ ] **Step 2: Run Security & Concurrency Test Suite**
  Run tests asserting double-accept prevention, race condition handling, and last-admin invariant enforcement.

- [ ] **Step 3: Commit**
  `git commit -m "security(api): harden rate limits, origin guards and concurrency checks for Phase 13"`

---

### Task 9 (Gate 13I): Real-Stack Playwright E2E Scenarios A-G

**Files:**
- Create: `apps/web/e2e/phase13-onboarding.spec.ts`

**Interfaces:**
- Consumes: Real PostgreSQL, Redis, API, Worker, Web stack.
- Produces: Verified E2E scenarios A through G.

- [ ] **Step 1: Implement E2E Scenarios A through G**
  Write Playwright tests covering:
  - Scenario A: Self-register -> Verify -> Login -> Create Workspace -> ADMIN.
  - Scenario B: Multi-workspace isolation & switching.
  - Scenario C: Existing-user invitation accept.
  - Scenario D: New-user invitation register -> accept.
  - Scenario E: Join Code self-join & rotation.
  - Scenario F: Workspace ID approval request -> Admin approve.
  - Scenario G: Provision Account Admin fallback.

- [ ] **Step 2: Run Playwright Test Suite**
  Run `pnpm --filter @floz/web test:e2e` and verify 100% PASS.

- [ ] **Step 3: Commit**
  `git commit -m "test(e2e): add Phase 13 Playwright real-stack E2E test suite"`

---

### Task 10 (Gate 13J): Documentation, Local Setup Guide & Final Report

**Files:**
- Modify: `README.md`, `.worktrees/setup-config-local/README.md`
- Create: `docs/implementation/PHASE_13_REPORT.md`

**Interfaces:**
- Consumes: Completed Phase 13 code & test evidence.
- Produces: Updated local setup runbook & final implementation report.

- [ ] **Step 1: Update Local Setup Runbook**
  Replace old Step 8 manual bootstrap with clean self-service onboarding runbook (Register -> Dev Mailbox -> Verify -> Create Workspace).

- [ ] **Step 2: Generate PHASE_13_REPORT.md**
  Document test metrics, database migration details, delivered features, and security verifications.

- [ ] **Step 3: Commit**
  `git commit -m "docs: complete Phase 13 documentation, setup runbook, and implementation report"`
