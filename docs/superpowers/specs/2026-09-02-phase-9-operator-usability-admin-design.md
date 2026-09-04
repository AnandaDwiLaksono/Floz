# Phase 9 Design Proposal — P0 Operator Usability & Administration

**Document status:** FINAL DESIGN / APPROVED FOR IMPLEMENTATION PLANNING  
**Target phase:** Phase 9  
**Gate label:** MUST BEFORE GATE A  
**Canonical state:** `master`, remote `origin/main`, HEAD `fc76fbc0e27794d03ac0634e10fe06a7e7672e43` at publication; local design draft commit may be ahead.  
**Roadmap input:** `docs/implementation/FLOZ_MASTER_GAP_AUDIT.md`  

---

## 1. Reconstructed Current State

Phases 0–8 are complete. Phase 8 delivered My Work, member dashboard, manager dashboard, role-scoped reporting, and KPI projections. Phase 9 is not implemented.

Gate A remains open for verified P0 operator/admin usability gaps:

1. Profile & personal preferences.
2. Workspace administration.
3. User / membership administration.
4. Team administration and manager assignment.
5. Multi-assignee task creation UX.
6. Calendar edit / reschedule UX.
7. Field Worker operational quick-status UX.
8. Task List search/filter completion.

Phase 9 remains focused on operator usability and administration only. It does not absorb Approval, comments, mentions, workflow configuration, attachments, notification preferences, email/push, exports, offline mode, deployment, CI/CD, or Phase 10+ scope.

### 1.1 Current Repository Evidence

| Area | Current canonical behavior | Phase 9 design need |
|---|---|---|
| Auth | Better Auth email/password login is exposed through `POST /api/v1/auth/login`; logout through `POST /api/v1/auth/logout`; current user through `GET /api/v1/me`. No user-facing sign-up route or sign-up UI currently exists. | Add minimal safe account provisioning decision. |
| Profile | `users` has `name`, `image`, `timezone`, `locale`, `is_active`; `/me` maps identity to web-facing profile fields. No `PATCH /me` exists. Current public avatar response is not backed by upload behavior. | Add own-profile update endpoint/UI for name/timezone/locale metadata; display read-only email; display current avatar/placeholder only. |
| Workspace | `workspaces` has `name`, `slug`, `timezone`, `is_active`; list/detail reads exist. No workspace settings update UI or `PATCH /workspaces/:workspaceId` implementation exists. | Add ADMIN-only workspace settings endpoint/UI for current editable fields. |
| Membership | `workspace_memberships` has `role_id`, `status`, unique `(workspace_id,user_id)`. Canonical statuses are `INVITED`, `ACTIVE`, `SUSPENDED`, `REMOVED`. Current API lists members only. No add/update lifecycle UI exists. | Add ADMIN-only member lifecycle API/UI aligned to canonical `POST /members` and `PATCH /members/:userId`. |
| Team | API already has team create/update/read and team member add/remove. `teams.manager_user_id` is canonical and validates active `MANAGER`/`ADMIN` when assigned. `teams.is_active` exists but archive/restore is not operator-facing. | Build ADMIN team admin UI; extend team update to expose active/archive where needed. |
| Manager dashboard | Manager scope is live PostgreSQL projection from active teams where `teams.manager_user_id` equals authenticated manager. | Preserve `manager_user_id`; ensure member lifecycle cannot silently invalidate configured active team managers. |
| Multi-assignee | DB/API supports multiple unique assignees and max one primary. Task detail assignment replacement UI exists. Task create UI only emits zero or one primary assignee. | Replace create single-assignee select with multi-assignee picker preserving existing API contract. |
| Calendar | Month/Week/Day read projection, filters, deadline-only tasks, workspace timezone behavior, and create-from-calendar handoff exist. Calendar card click opens task detail route only. | Add click-only accessible reschedule flow using task update + version. |
| Field Worker | My Work Today/Upcoming/Overdue exists. My Work tasks currently lack status/version/transition details and no quick transition action exists. | Add server-authoritative, on-demand quick transition UX using current task detail + available transitions. |
| Task filters | `TaskQueryDto` already supports `limit`, `sort`, `q`, `status_id`, `priority`, `team_id`, `assignee_id`, `bucket`, `due_from`, `due_to`, `cursor`. `bucket=active` and `bucket=completed` are already implemented. UI exposes only a subset consistently. | Do not add bucket backend. Expose/preserve canonical filters in UI. Add only `overdue=true` backend convenience if still justified. |

---

## 2. Gap-to-Design Mapping

### 2.1 Profile & Personal Preferences

**Gap:** No user-facing profile settings route and no `PATCH /me` endpoint.

**Design:** Add Profile Settings at:

```text
/workspaces/:workspaceId/settings/profile
```

Accessible to all active workspace members.

UI fields:
- Full name / display name.
- Timezone.
- Locale/basic preference metadata, only described as formatting preference unless full localization is actually implemented.
- Avatar display:
  - If current profile has image/avatar URL, display it.
  - Otherwise display initials/placeholder.
  - No upload infrastructure.
- Authenticated email identity, read-only.

Explicit exclusions:
- Email identity change.
- Password reset.
- Email verification.
- Avatar upload/storage.
- Notification preferences.

API:

```http
PATCH /api/v1/me
```

Canonical external request contract:

```json
{
  "full_name": "Jane Operator",
  "timezone": "Asia/Jakarta",
  "locale": "id-ID",
  "avatar_url": null
}
```

Mapping:
- `full_name` → `users.name`
- `avatar_url` → `users.image`

Validation:
- `full_name` required if provided, trimmed, non-empty.
- `timezone` must be a valid IANA timezone.
- `locale` must be one of explicitly supported metadata values, initially `id-ID` and `en-US`.
- `avatar_url` is metadata only: nullable; if non-null, validate as an allowed URL shape; never fetch it server-side; no upload/storage is introduced.

States:
- Loading skeleton while `/me` loads.
- Save disabled while unchanged or saving.
- Inline success banner after save.
- Inline validation errors.
- API error banner.
- Keyboard focus returns to first invalid field.

### 2.2 Workspace Administration

**Gap:** ADMIN cannot update workspace settings from UI.

Route:

```text
/workspaces/:workspaceId/settings/workspace
```

ADMIN only.

Fields:
- Workspace name.
- Workspace timezone.
- Read-only slug.
- Read-only workspace ID.

API:

```http
PATCH /api/v1/workspaces/:workspaceId
```

Request:

```json
{
  "name": "Floz Operations",
  "timezone": "Asia/Jakarta"
}
```

Rules:
- Server-side authorization through ADMIN workspace membership.
- Name must be non-empty after trim.
- Timezone must be valid IANA timezone.
- Slug remains read-only in Phase 9 unless existing API evidence proves safe mutation.
- Workspace active/inactive lifecycle is not exposed unless already supported by canonical API.

States:
- Loading, success, validation error, forbidden, generic error.
- Non-admin users do not see nav item; direct access receives a permission screen/403 handling.

### 2.3 User / Membership Administration

**Gap:** Member administration UI and lifecycle mutation endpoints are missing.

Route:

```text
/workspaces/:workspaceId/settings/members
```

ADMIN only.

Canonical distinction:
- **User account lifecycle** is global identity (`users.is_active`) and auth-owned.
- **Workspace membership lifecycle** is workspace-scoped (`workspace_memberships.status`).

Canonical membership statuses:

```text
INVITED
ACTIVE
SUSPENDED
REMOVED
```

Phase 9 may not create `INVITED` rows, but must preserve the canonical vocabulary in API/UI and not redefine it.

#### Account Provisioning / Onboarding Decision

Current master exposes login/logout/current-user only. There is no verified user-facing registration screen or registration endpoint. Therefore "user must create an account first" is not operationally sufficient unless Phase 9 adds a minimal account acquisition path.

**Locked Phase 9 onboarding decision: ADMIN-provisioned account with temporary credentials.**

Public self-registration is not safe for this pilot because email/password sign-up is enabled without email verification. An unauthenticated person could claim another person's email, then be added by an ADMIN who searches that email. Better Auth's technical `signUpEmail` capability does not establish email ownership.

Phase 9 therefore does **not** expose unrestricted public registration.

Feasibility gate result: Better Auth 1.7.1 core `auth.api.signUpEmail` is the approved provisioning primitive, but only with global email/password auto-sign-in disabled:

```ts
emailAndPassword: {
  enabled: true,
  autoSignIn: false
}
```

Rationale:
- documented Better Auth core API;
- provider-owned password hashing;
- zero schema migrations;
- no Admin plugin;
- no direct auth-table/password-hash writes;
- no signup session row/token;
- no signup `Set-Cookie`;
- ADMIN browser session cannot be replaced by the provisioned identity;
- Floz does not expose public self-registration.

This is a deliberate Phase 9 auth behavior change. Do not mount the generic Better Auth signup handler; public signup routes such as `POST /api/v1/auth/sign-up/email` must remain unavailable.

Provisioning API:

```http
POST /api/v1/workspaces/:workspaceId/accounts
```

Request:

```json
{
  "email": "worker@example.com",
  "full_name": "Field Worker"
}
```

Provisioning flow:
1. ADMIN opens `Provision Account` from Member Administration.
2. ADMIN enters the user's email and display name.
3. Server verifies the actor is an `ACTIVE ADMIN` of `:workspaceId`; the workspace parameter is authorization context only.
4. Server generates a high-entropy temporary password and calls `auth.api.signUpEmail` with global `emailAndPassword.autoSignIn=false`, creating Better Auth user/account records only, with no workspace creation, no membership, no session row/token, and no signup `Set-Cookie`.
5. Server reveals the high-entropy temporary password exactly once over the authenticated ADMIN response; it remains valid until the user successfully changes it. Account creation must not forward any created-user cookie, replace the ADMIN session, or change the authenticated ADMIN identity. No password or temporary credential may appear in application logs.
6. ADMIN gives the credential to the intended user through an identity-confirmed out-of-band channel.
7. User signs in and changes the temporary password through authenticated `PATCH /api/v1/me/password` using current and new password.
8. ADMIN separately adds the existing account to the workspace using the canonical member-add flow.

Password-change API:

```http
PATCH /api/v1/me/password
```

Canonical request:

```json
{
  "current_password": "...",
  "new_password": "..."
}
```

Requirements:
- Authenticated user only.
- Current password must verify.
- Use Better Auth/provider-owned password-change behavior; Floz business code never writes password hashes directly.
- After success, old password no longer authenticates and new password authenticates.
- Exact session retention/revocation behavior must be defined during implementation planning using supported Better Auth behavior.

Credentials lifecycle:
- Better Auth hashes the generated temporary password; plaintext exists only in the one provisioning response.
- Floz does not store a recoverable copy or temporary-password flag.
- The user can authenticate with it until successful password change; successful change invalidates the old credential.
- Forced first-login password change is not claimed because the current schema has no temporary-password state and Phase 9 adds no schema migration.
- Workspace ADMIN cannot generally reset an existing global account password.
- Lost pre-claim temporary credentials are a known Phase 9 pilot limitation pending a later verified account-recovery mechanism.

Authorization/security:
- Account provisioning is workspace-ADMIN-only and server-authorized.
- `:workspaceId` scopes authorization only; provisioning never creates membership or assigns a role.
- Email is an account identifier, not proof of ownership.
- Duplicate email returns conflict only to authenticated ADMIN callers.

A provisioned user with no active workspace sees `No workspace access yet` after login, not an error loop.

Future migration path: verified-email invitations or verified self-registration may replace this flow without changing workspace membership semantics. Email invitation tokens and email delivery remain excluded from Phase 9.

#### Member Add / Lifecycle API

Prefer canonical API Specification naming:

```http
POST /api/v1/workspaces/:workspaceId/members
```

Request:

```json
{
  "email": "worker@example.com",
  "role": "FIELD_WORKER"
}
```

Semantics:
- Finds an existing registered user by normalized email.
- If user does not exist, return a clear account-not-found error and direct the operator to the ADMIN-only account provisioning flow.
- If membership does not exist, create `workspace_memberships` with `status='ACTIVE'`.
- If membership exists with `INVITED`, `SUSPENDED`, or `REMOVED`, ADMIN can reactivate by PATCHing status to `ACTIVE` and role as needed.
- If already active, return conflict.

Do not invent email invitation infrastructure.

Accepted workspace role values remain the canonical role set:

```text
ADMIN
MANAGER
MEMBER
FIELD_WORKER
```

Lifecycle mutation uses one canonical endpoint:

```http
PATCH /api/v1/workspaces/:workspaceId/members/:userId
```

Request:

```json
{
  "role": "MANAGER",
  "status": "ACTIVE"
}
```

Accepted membership status values remain:

```text
INVITED
ACTIVE
SUSPENDED
REMOVED
```

Removal is modeled by:

```json
{
  "status": "REMOVED"
}
```

No redundant DELETE member endpoint is required for Phase 9.

#### Atomic Membership Invariants

Every member role/status mutation must be transactionally validated server-side:

1. Resulting workspace must contain at least one `ACTIVE ADMIN`.
   - Applies to self and other-admin mutations.
   - Applies to demotion, suspension, removal, and any combined role/status update.
   - Must be enforced atomically with row locks/transactional checks.

2. A user referenced by active `teams.manager_user_id` must not silently become invalid.
   - Before changing an active manager/admin to `MEMBER`, `FIELD_WORKER`, `SUSPENDED`, or `REMOVED`, check active teams managed by that user.
   - If any active teams exist, reject with conflict/state error.
   - ADMIN must reassign or clear those team managers first.
   - Do not silently clear `teams.manager_user_id`.

Member UI:
- List/search by name/email.
- Role selector.
- Status selector/actions.
- Add existing account by email.
- Clear empty state.
- Permission screen for non-admin direct access.
- Row-level loading state for role/status mutation.
- Conflict error messages for last-active-admin and managed-team constraints.

### 2.4 Team Administration

**Gap:** API foundation exists, but operator-facing team administration UI is missing. Archive/restore behavior is not exposed.

Route:

```text
/workspaces/:workspaceId/settings/teams
```

ADMIN only.

Capabilities:
- Team list with active/archived filter.
- Create team.
- Edit name/description.
- Archive/deactivate via `teams.is_active=false`.
- Restore/reactivate via `teams.is_active=true` if exposed through team update.
- Manage team members.
- Assign/clear manager.

API:
- Reuse existing team endpoints.
- Extend existing `PATCH /workspaces/:workspaceId/teams/:teamId` to accept `is_active?: boolean` if needed.
- Preserve `manager_user_id` contract.

Manager assignment validation:
- Target manager must be an `ACTIVE` workspace member.
- Target role must be `ADMIN` or `MANAGER`.
- `manager_user_id: null` clears manager.
- Cross-workspace references rejected server-side.

Archived team behavior:
- New Task/team selectors show active teams only.
- New team membership additions to an archived team are rejected; restore team first.
- Existing Task references to archived teams are preserved.
- When an existing Task references an archived team:
  - Show current team as `Archived`.
  - Do not silently clear `team_id`.
  - Allow authorized reassignment to an active team.
- Manager dashboard scope ignores inactive teams through existing live projection behavior.

Permission boundaries:
- ADMIN manages all teams.
- MANAGER has read/report scope only in Phase 9, unless a currently implemented endpoint already allows more.
- MEMBER/FIELD_WORKER read team names only where needed for task/filter display.

States:
- Loading team list.
- Empty active teams.
- Empty archived teams.
- Duplicate team name validation.
- Invalid manager conflict.
- Archived-team mutation disabled states.

### 2.5 Multi-Assignee Task Creation

**Gap:** Backend and detail edit support multiple assignees; task create UI only supports single primary assignee.

Task create form design:
- Replace single primary assignee select with multi-assignee picker.
- Only show active workspace members.
- Allow zero or more unique assignees, preserving current API behavior that unassigned tasks are valid.
- Allow maximum one primary assignee.
- Primary must be one of the selected assignees.
- If selected primary is removed, clear primary automatically.

Payload remains canonical:

```json
{
  "assignees": [
    { "user_id": "usr_1", "is_primary": true },
    { "user_id": "usr_2", "is_primary": false }
  ]
}
```

Validation:
- Client prevents duplicate selected users.
- Server remains authoritative for active membership and max-one-primary validation.
- Cross-workspace/inactive member errors shown inline.

Responsive behavior:
- Desktop: searchable checkbox list or combobox plus selected chips.
- Mobile: full-screen picker or stacked checkbox list with 44px minimum touch targets.
- Keyboard: picker is tab-navigable; primary radio group uses arrow keys.

No schema cardinality changes.

### 2.6 Calendar Edit / Reschedule

**Gap:** Calendar read projection is complete, but mutation UX is missing.

Decision:
- Use click-only contextual action.
- Reuse existing Task Detail modal and `PATCH /tasks/:taskId` update semantics.
- No drag-to-reschedule.

Route behavior:

```text
/workspaces/:workspaceId/calendar
/workspaces/:workspaceId/tasks?selected_task_id=:taskId&edit_schedule=1
```

`edit_schedule=1` is ephemeral UI mode only:
- It opens Task Detail in edit mode.
- It focuses schedule fields.
- It should not be a persisted domain concept.

Success flow must guarantee Calendar freshness:
1. Calendar card action stores structured calendar context: `view`, `date`, `team_id`, `assignee_id`.
2. Task Detail schedule save sends `PATCH /tasks/:taskId` with `version`, `start_at`, and/or `due_at`.
3. On success, UI offers `Return to Calendar` and reconstructs the same-workspace Calendar URL from that preserved context.
4. If any `return_to` mechanism exists in implementation, it must only accept the canonical Calendar path for the same workspace and must not permit external or open redirects.
5. After navigation, Calendar explicitly refetches/revalidates the projection using the normal application data-refresh mechanism. Browser Back is not the freshness mechanism.

Validation:
- Server enforces `start_at <= due_at` when both exist.
- Workspace timezone conversion remains canonical for `datetime-local` inputs.
- Start-only tasks remain unsupported in current projections.
- Deadline-only tasks (`start_at = null`, `due_at != null`) remain supported.
- Version conflict uses standard `VERSION_CONFLICT` reload UX.

Accessibility:
- Reschedule action is a real button/link with accessible name.
- Edit mode focus lands on first schedule field.
- Save/conflict banners announced via live region.

### 2.7 Field Worker Operational UX

**Gap:** My Work exists, but no one-tap server-authoritative quick status action exists.

Design principles:
- Do not encode workflow rules in React.
- Server-provided transition list is authoritative.
- Preserve version checks and `VERSION_CONFLICT` handling.
- Avoid N+1 prefetch.

Interaction:
1. My Work card renders task summary and a generic `Status action` button.
2. When user invokes quick action, web lazily fetches:
   - `GET /workspaces/:workspaceId/tasks/:taskId`
   - `GET /workspaces/:workspaceId/tasks/:taskId/available-transitions`
3. UI presents server-provided transitions.
   - If exactly one transition exists, button label may use friendly text derived from transition name/code.
   - If multiple transitions exist, show accessible action menu.
4. User selects transition.
5. Web sends:

```http
POST /api/v1/workspaces/:workspaceId/tasks/:taskId/transitions
```

with:

```json
{
  "to_status_id": "status_uuid",
  "version": 3
}
```

6. On success:
   - Refetch My Work summary.
   - Refresh card state.
   - Announce success.
7. On `VERSION_CONFLICT`:
   - Show conflict banner/action sheet state.
   - Offer `Reload latest`.

Mobile-first task flow:

```text
My Work
→ Today / Upcoming / Overdue
→ Task card
→ Status action / Details
→ Allowed server transition
→ Completion feedback
```

No separate Field Worker business model.

### 2.8 Task Search / Filter Completion

**Gap:** API implements many canonical filters, but Task List UI exposes/preserves them inconsistently. `overdue=true` is the only missing convenience filter candidate.

Current `TaskQueryDto` fields:

```text
limit
sort
q
status_id
priority
team_id
assignee_id
bucket
due_from
due_to
cursor
```

Already implemented canonical backend behavior:
- `bucket=active`:
  - `deleted_at IS NULL`
  - current status is non-terminal
  - current status category is not `CANCELLED`
- `bucket=completed`:
  - `completed_at IS NOT NULL`
- `status_id` single status filter.
- comma-separated `priority` filter.
- `team_id` filter.
- `assignee_id` filter.
- `due_from` / `due_to` range.
- cursor pagination.
- supported sort options.

Phase 9 UI must expose/preserve:
- task key/title search (`q`).
- `status_id` selector, not invented status array.
- priority filter using existing comma-separated API contract.
- assignee filter.
- team filter.
- due range (`due_from`, `due_to`).
- `bucket=active|completed` tabs.
- sort.
- pagination cursor behavior.
- URL state roundtrip on refresh/navigation/back.

Optional backend addition:

```http
GET /tasks?overdue=true
```

Only `overdue=true` is needed. `overdue=false` adds no useful UI semantic for Phase 9.

Canonical overdue predicate:

```sql
deleted_at IS NULL
AND current status is non-terminal
AND current status category <> 'CANCELLED'
AND due_at < evaluation_at
```

Implementation must resolve exactly once per Task List request: `evaluationAt = ReportingClock.now()`, then pass that instant into the overdue predicate. Do not introduce a separate wall-clock source or scatter `NOW()`/`new Date()` calls through query code; this preserves Phase 8 deterministic test behavior.

Saved views remain excluded.

---

## 3. Settings Route Hierarchy

Use exactly:

```text
/workspaces/:workspaceId/settings
/workspaces/:workspaceId/settings/profile
/workspaces/:workspaceId/settings/workspace
/workspaces/:workspaceId/settings/members
/workspaces/:workspaceId/settings/teams
```

Routing:

```text
/workspaces/:workspaceId/settings
→ /workspaces/:workspaceId/settings/profile
```

Navigation:
- Add `Settings` to desktop sidebar and mobile drawer.
- Settings shell contains tabs.
- Non-admin users see Profile only.
- Direct access to admin tabs by non-admins receives forbidden handling, not hidden failure.

---

## 4. API / Schema Implications

### 4.1 Database Schema

The currently approved Phase 9 design requires zero database schema migrations. Phase 9 still requires API and Web changes.

Evidence:
- `users` already has profile/preference fields.
- `workspaces` already has name/timezone/activity fields.
- `workspace_memberships` already has status/role relationship.
- `roles` already contains workspace role model.
- `teams` already has `manager_user_id` and `is_active`.
- `team_memberships` already supports active membership via `left_at`.
- `tasks` and `task_assignees` already support required schedule/version/assignment semantics.

Do not add UI-state tables. Do not create parallel admin tables. PostgreSQL remains canonical.

### 4.2 API Additions / Extensions

Required:
- ADMIN-only account provisioning endpoint for identity only, with temporary credentials and no membership creation.
- `PATCH /api/v1/me`.
- `PATCH /api/v1/workspaces/:workspaceId`.
- `POST /api/v1/workspaces/:workspaceId/members`.
- `PATCH /api/v1/workspaces/:workspaceId/members/:userId`.
- Extend existing team update to expose `is_active` if archive/restore is not already supported.
- Optionally add `overdue=true` to task list query.
- Add/verify server-side `start_at <= due_at` validation for task create/update.

Prefer extending existing canonical endpoints over parallel endpoints.

### 4.3 API Contract Drift to Preserve/Resolve

Implementation planning must explicitly account for differences between current code and documentation:

| Concern | Current code | Canonical/spec direction | Phase 9 decision |
|---|---|---|---|
| Task status filter | `status_id` | Some docs imply status filter generically | Preserve `status_id` unless API spec/code requires migration. |
| Task bucket | Already implemented | Required as canonical filter | Do not redesign/add backend; expose in UI. |
| Overdue filter | Not implemented in task list | API spec includes `overdue=true` | Add only `overdue=true` convenience if still justified. |
| Member role field | API spec uses `role` | No current member mutation API | Use `role`. |
| Member removal | API spec uses PATCH status `REMOVED` | No current delete API | Use PATCH lifecycle; no redundant DELETE. |
| Profile name | DB uses `name`; web public DTO uses `full_name` | API spec may expose profile DTO | Use request contract intentionally; map cleanly server-side. |
| Avatar | DB has `image`; current public response may be `avatar_url` | No upload/storage | Display existing; no upload. |

---

## 5. Authorization Model

Server-side authorization remains canonical. React may hide unavailable UI but must not enforce business rules.

| Capability | ADMIN | MANAGER | MEMBER | FIELD_WORKER |
|---|:---:|:---:|:---:|:---:|
| Provision new account identity | Yes | No | No | No |
| Public account provisioning | No | No | No | No |
| Login/logout/session | Yes | Yes | Yes | Yes |
| Update own profile | Yes | Yes | Yes | Yes |
| View workspace settings | Yes | No | No | No |
| Update workspace settings | Yes | No | No | No |
| List members | Yes | Yes | Yes | Yes |
| Add/update member lifecycle | Yes | No | No | No |
| List teams | Yes | Yes | Yes | Yes |
| Create/edit/archive teams | Yes | No | No | No |
| Assign/clear team manager | Yes | No | No | No |
| Manage team members | Yes | No | No | No |
| Create task | Yes | Yes | Yes | Yes |
| Assign/reassign task | Yes | Yes | Yes | No |
| Transition task status | Yes | Yes | Yes | Yes |
| Delete task | Yes | Yes | No | No |
| Manager dashboard | All workspace/team scope | Managed active teams only | No | No |

Membership mutations must additionally preserve:
- At least one `ACTIVE ADMIN`.
- Active team managers remain valid.

---

## 6. Edge Cases

### Profile
- Invalid timezone rejected.
- Locale selection clearly described as formatting/preference metadata unless full app localization exists.
- Missing avatar uses initials placeholder.
- Email cannot be changed.

### Onboarding
- Provisioned user with no workspace sees no-workspace state.
- Add-member by email fails clearly if account does not exist.
- No silent workspace creation.
- No email invitation token or delivery.

### Membership
- Cannot leave workspace with zero active admins.
- Cannot demote/suspend/remove user who manages active teams.
- `INVITED` status remains representable even if Phase 9 does not create it.
- Removed/suspended members excluded from active assignee/team-add selectors.
- Historical tasks/assignments are preserved.

### Teams
- Archived teams cannot receive new members until restored.
- Existing archived-team task references are shown as archived and preserved.
- Reassignment to active team is allowed where authorized.
- Team name duplicate errors shown inline.
- Manager clearing is explicit.

### Task Assignment
- Zero assignees remains valid per current API.
- Max one primary.
- Primary must be selected assignee.
- Server rejects inactive/cross-workspace assignee.

### Calendar
- Deadline-only tasks remain supported.
- Start-only tasks remain unsupported in current projections.
- Calendar refetch is explicit after successful schedule mutation.
- Version conflict reload path avoids overwrite.

### Field Worker
- Quick action loads transitions on demand.
- If no available transitions exist, show disabled `No available actions` state.
- If task changed after card load, conflict path reloads latest.

### Task Filters
- Unknown query params ignored or normalized.
- Invalid IDs show validation error or reset UI state.
- Pagination cursor resets when filters change.
- URL remains source of truth for list filters.

---

## 7. Responsive & Accessibility Requirements

All Phase 9 screens must include:
- Loading, empty, success, error, forbidden, and disabled states.
- Keyboard navigation for tabs, dialogs, menus, comboboxes, checkboxes, radio groups, date/time inputs.
- Focus management on modal open/close and error states.
- Screen-reader labels for icon-only actions.
- Touch targets >= 44px for mobile primary actions.
- Mobile layout:
  - Settings tabs collapse to stacked pills or horizontal scroll.
  - Member/team tables become cards/lists.
  - Filters collapse into drawer or stacked controls.
  - Task create/edit modals become full-screen or near-full-screen where needed.
- No drag-only interactions.

---

## 8. Testing Strategy

### 8.1 Database/API Coverage

Add tests for:

1. **Account provisioning**
   - ADMIN provisions identity only with temporary credential.
   - Provisioned user has no workspace access until added.
   - Login works before membership exists and lands on `No workspace access yet`.
   - Password change replaces the temporary credential; old password no longer authenticates.

2. **Profile**
   - `PATCH /me` updates name/timezone/locale.
   - Invalid timezone/locale rejected.
   - Email cannot be changed through profile patch.

3. **Workspace admin**
   - ADMIN updates workspace name/timezone.
   - MANAGER/MEMBER/FIELD_WORKER receive 403.

4. **Membership lifecycle**
   - ADMIN adds existing account by email.
   - Non-existent email returns account-not-found.
   - PATCH updates role/status using canonical `role` and `status`.
   - `INVITED`, `ACTIVE`, `SUSPENDED`, `REMOVED` vocabulary accepted/represented per canonical contract.
   - Last-active-admin invariant enforced atomically.
   - Managed-active-team manager cannot be demoted/suspended/removed until manager assignment cleared/reassigned.

5. **Team admin**
   - Create/edit team.
   - Assign manager only if active role `ADMIN`/`MANAGER`.
   - Clear manager.
   - Archive/restore through `is_active`.
   - Reject adding member to archived team.

6. **Manager dashboard scope**
   - Assignment changes manager dashboard scope.
   - Archived teams are excluded from manager scope.

7. **Task filters**
   - Existing `bucket=active` and `bucket=completed` regression tests.
   - `status_id` filter regression.
   - `overdue=true` if added, using one captured evaluation instant and canonical operational-active predicate.

8. **Schedule validation/concurrency**
   - `start_at <= due_at` enforced on create/update when both provided.
   - Schedule update requires version.
   - Stale version returns `VERSION_CONFLICT`.

### 8.2 Web Unit / Component Coverage

Add tests for:
- Settings route/tab visibility by role.
- Profile form loading/save/error states.
- Workspace settings forbidden state.
- Member list search, add-member dialog, lifecycle mutation, conflict banners.
- Team list active/archived views, manager selector, archived-team behavior.
- Multi-assignee picker uniqueness and primary selection.
- Task filter URL roundtrip for `q`, `status_id`, `priority`, `team_id`, `assignee_id`, `bucket`, `due_from`, `due_to`, sort, cursor reset.
- My Work quick action lazy-load behavior.
- Version conflict banner and reload behavior.

### 8.3 Playwright E2E Coverage

E2E must include at least:

1. **Admin edits workspace settings**
   - Admin logs in, opens settings, updates workspace name/timezone, sees persistence.

2. **Admin manages member**
   - Admin provisions brand-new user identity only with temporary credential.
   - User logs in and sees `No workspace access yet` before membership.
   - Admin adds that user by email.
   - Admin changes role/status.
   - Last-active-admin and managed-team conflict paths covered.

3. **Admin creates/updates team**
   - Create team.
   - Edit name/description.
   - Archive/restore.

4. **Admin assigns manager**
   - Promote/add manager.
   - Assign to team.
   - Clear/reassign manager.

5. **Manager dashboard scope reflects assignment**
   - Manager sees assigned team work.
   - Manager loses scope after clear/archive.

6. **User creates task with multiple assignees**
   - Select two active members.
   - Mark one primary.
   - Verify detail display.

7. **Calendar task is rescheduled**
   - Open Calendar.
   - Invoke Reschedule.
   - Task detail opens in schedule edit mode.
   - Save new due/start.
   - Return to Calendar with guaranteed refetch.
   - Verify task appears on new date.

8. **Field Worker completes work through mobile flow**
   - Mobile viewport.
   - My Work -> task card -> quick action -> server transition -> completion feedback.

9. **Task search/filter survives navigation**
   - Apply search, `status_id`, assignee, team, due range, bucket, sort.
   - Navigate away/back.
   - URL and UI state preserved.

Regression gates:
- Existing Phase 0–8 API tests.
- Existing clean DB tests.
- Existing Playwright flows.
- Lint, typecheck, build.
- Role/isolation tests for cross-workspace references.
- Keyboard/accessibility tests for settings, dialogs, filters, quick actions.

---

## 9. Migration & Compatibility Concerns

- **Database schema migrations:** none required by current approved Phase 9 design.
- **Data migration:** none required.
- **API/Web changes:** required; zero database migrations does not mean zero implementation work.
- **Existing memberships:** preserve existing status values. If legacy data only contains `ACTIVE`, no migration needed.
- **Existing teams:** existing `manager_user_id` values remain valid; lifecycle mutation rules prevent future invalidation.
- **Existing tasks assigned to archived teams:** preserve references.
- **API compatibility:** Existing endpoints remain backward-compatible. New endpoints fill missing canonical API surface. Existing `bucket` semantics must not regress.
- **Task list pagination:** filter changes reset cursor.
- **Calendar refetch:** must not rely solely on browser back/remount behavior.

---

## 10. Implementation Risks

1. **Account provisioning security:** Better Auth sign-up exists as library capability, but public self-registration without email verification is unsafe for this pilot. Phase 9 uses ADMIN-only identity provisioning and must protect temporary credentials from logs/retrieval.
2. **API/docs drift:** Current code uses `status_id` and `bucket`; docs sometimes describe generic status/overdue filters. Implementation must preserve actual contracts unless deliberately changed.
3. **Membership invariants:** Last-active-admin and managed-team-manager constraints must be transactional. Non-atomic checks risk race conditions.
4. **Field Worker quick actions:** My Work summary lacks version/transitions. Lazy detail+transition fetch avoids N+1 but needs careful loading state.
5. **Calendar freshness:** Browser history alone is insufficient. Success navigation must trigger explicit refetch.
6. **Archived-team UX:** Operators must see archived historical references without accidentally selecting archived teams for new work.
7. **No business logic duplication in React:** React can format labels and hide controls, but server validates roles, transitions, membership, team scope, and task constraints.

---

## 11. Explicit Exclusions

Phase 9 excludes:
- Approval.
- Comments.
- Mentions.
- Workflow Configuration.
- Attachments.
- Notification preferences.
- Email/push delivery.
- Password reset/email verification.
- Historical KPI/export/scheduled reporting.
- Saved views.
- `CUSTOM` recurrence.
- Start-only Calendar projection.
- Offline mode.
- Production infrastructure.
- CI/CD/deployment automation.
- Phase 10+ work.

---

## 12. Self-Review Against Canonical Inputs

Reviewed against:
- Current master repository behavior.
- Final Master Outstanding / Gap Audit.
- API Specification.
- ERD.
- Wireframe/UI Specification.
- Technical Architecture.
- Phase 8 reporting/task-filter semantics.

Corrections applied:
- `bucket=active|completed` reclassified as existing canonical backend functionality.
- `status_id` preserved as current status filter contract.
- `overdue=true` limited to optional missing convenience filter with canonical operational-active predicate and single evaluation instant.
- Membership statuses restored to `INVITED`, `ACTIVE`, `SUSPENDED`, `REMOVED`.
- Member removal aligned to `PATCH { status: "REMOVED" }`, no redundant delete endpoint.
- Member role request field aligned to API Spec `role`.
- Account provisioning locked to ADMIN-only identity creation with a high-entropy temporary password revealed exactly once; public self-registration excluded without email verification.
- Team manager invariant enforced before role/status/removal changes.
- Last-active-admin invariant widened to every membership mutation.
- Field Worker quick status made server-authoritative via available transitions.
- Profile avatar/product-edition language removed.
- Locale described as preference metadata unless full localization exists.
- Calendar refetch made explicit after successful schedule mutation.
- Archived-team behavior defined for existing task references and selectors.
- Settings route hierarchy normalized.
- Schema conclusion narrowed: current approved Phase 9 design requires zero schema migrations.

---

## 13. Final Design Position

Phase 9 closes Gate A P0 operator usability by making existing canonical capabilities operable by real administrators, managers, members, and field workers without manual database intervention.

It does this by adding minimal Settings/Admin UX and missing API surfaces around already-existing domain concepts, while preserving PostgreSQL as canonical source, server-side authorization, workspace isolation, optimistic concurrency, Phase 0–8 behavior, and all explicit Phase 10+ exclusions.
