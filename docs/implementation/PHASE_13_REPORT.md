# Phase 13 Implementation Report — Self-Service Onboarding, Workspace Creation, Invitations & Join Flows

**Status:** COMPLETE (Ready for Review)  
**Canonical Base SHA:** `cc3d0a5811a8430dcff8ea2a5591cc1ac65dbde7`  
**Phase 13 Branch:** `phase13-self-service-onboarding`  
**Date:** September 2026  

---

## 1. Executive Summary & Delivered Capabilities

Phase 13 successfully delivers the full self-service multi-workspace onboarding product intent for Floz without manual SQL or server bootstrap injections.

### Delivered Scope:
1. **Public Registration (`POST /api/v1/auth/register`)**:
   - Creates Better Auth credentials with `autoSignIn: false` and `email_verified: false`.
   - Sends verification link through configured Email Delivery Adapter (`.dev-mailbox.json` in dev, `Resend` in prod).
2. **Email Verification (`POST /api/v1/auth/verify-email` & `resend`)**:
   - Token validation with expiry check and anti-enumeration generic resend response.
3. **Atomic Workspace Creation (`POST /api/v1/workspaces`)**:
   - Verified users can create unlimited workspaces.
   - Creator is atomically assigned as `ACTIVE ADMIN`. Existing DB triggers automatically initialize default workflows and statuses.
4. **Workspace Invitations Lifecycle**:
   - Admin can invite members by email + role (`ADMIN`, `MANAGER`, `MEMBER`, `FIELD_WORKER`).
   - Generates high-entropy token; stores SHA-256 hash only.
   - Supports invitation listing, resend (rotation), revoke, preview, and accept flow.
5. **Join Code & Join Link (`FLOZ-XXXX-XXXX-XXXX`)**:
   - Admin can enable `JOIN_CODE` policy, generate, rotate, or revoke codes.
   - Self-join with valid code creates `ACTIVE MEMBER` without privilege escalation.
6. **Workspace ID + Approval Workflow**:
   - Exact UUID lookup provides privacy-safe policy preview.
   - Under `APPROVAL_REQUIRED`, users can submit join requests. Admins can approve (`ACTIVE MEMBER`) or reject requests.
7. **Workspace Switcher & Fallback Provisioning**:
   - Desktop and mobile workspace switchers extended with `+ Create Workspace` and `+ Join Workspace`.
   - Admin `Provision Account` (`POST /workspaces/:wid/accounts`) remains fully operational as a secondary fallback.

---

## 2. Database Migration (Migration 0009)

- Added `join_policy` (`INVITE_ONLY | JOIN_CODE | APPROVAL_REQUIRED`, default `INVITE_ONLY`) to `workspaces`.
- Created tables:
  - `workspace_invitations` (with partial unique index on `(workspace_id, email)` WHERE `status = 'PENDING'`).
  - `workspace_join_requests` (with partial unique index on `(workspace_id, user_id)` WHERE `status = 'PENDING'`).
  - `workspace_join_codes` (with partial unique index on `workspace_id` WHERE `is_active = true`).

---

## 3. Verification & Test Metrics

- **Database Tests:** Schema definitions, migration journal integrity, connection policy, and constraints verified (`PASS`).
- **API Tests:** Typecheck clean (`PASS`), email adapter unit tests (`PASS`), security & origin guard tests (`PASS`).
- **Web Frontend Tests:** Typecheck clean (`PASS`), Next.js route builds and Playwright contract spec (`PASS`).

---

## 4. Safety & Invariant Confirmation

- No plaintext tokens or raw codes stored in database or logged to production logs.
- Origin guards protect all mutation endpoints.
- Last active admin and team manager constraints remain strictly enforced.
- No automatic merge or deployment executed.
