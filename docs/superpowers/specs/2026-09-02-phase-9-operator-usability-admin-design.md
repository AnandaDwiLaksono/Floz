# Phase 9 Design Proposal — P0 Operator Usability & Administration

**Document status:** PROPOSAL / AWAITING APPROVAL  
**Target phase:** Phase 9  
**Gate label:** MUST BEFORE GATE A  
**Baseline commit:** `fc76fbc` (canonical `master`)  
**Input:** `docs/implementation/FLOZ_MASTER_GAP_AUDIT.md`  

---

## 1. Executive Summary & Current State Reconstruction

Floz has achieved a robust core operational foundation across Phases 0–8 (authentication, workspace isolation, task workflow/history/concurrency, Kanban, Calendar read projection, recurring tasks with worker outbox, notification center, My Work, member & manager dashboards, and KPI reporting).

However, **Gate A (Core MVP/P0 Complete)** remains blocked because key operational and administrative workflows currently require manual database manipulation or developer intervention.

### Reconstructed Current State & Verified Gaps

| Domain | Implemented Baseline | Verified Gap | Required Phase 9 Scope |
|---|---|---|---|
| **1. Profile & Preferences** | `users` table has `name`, `image`, `timezone`, `locale`, `is_active`. `GET /me` returns user info. | No `PATCH /me` endpoint. No web settings/profile page. Avatar is hardcoded `null`. | Add `PATCH /me`, build Profile Settings UI with name, timezone, locale, authenticated email display, avatar placeholder. |
| **2. Workspace Admin** | `workspaces` table has `name`, `slug`, `timezone`, `is_active`. `GET /workspaces/:id` returns workspace. | No `PATCH /workspaces/:id` endpoint. No workspace settings page. | Add `PATCH /workspaces/:id` (ADMIN only), build Workspace Settings UI (name, timezone). |
| **3. Membership Admin** | `workspace_memberships` table has `role_id`, `status`. `GET /members` lists members. | No endpoint to add, update role, suspend/activate, or remove members. No member management UI. | Add `POST /members` (add existing account by email), `PATCH /members/:uid` (role/status), `DELETE /members/:uid`. Build Member Management UI. |
| **4. Team Admin & Manager** | `teams` has `name`, `description`, `manager_user_id`, `is_active`. Team CRUD and team member endpoints exist in API. | No team management UI. `teams.manager_user_id` cannot be managed by operators in UI. Team archive toggle not exposed. | Build Teams & Team Detail Admin UI (create, edit, archive toggle, manager assignment select, member add/remove). |
| **5. Multi-Assignee Task Creation** | DB `task_assignees` supports many assignees with max 1 primary. API accepts `assignees: [...]`. Detail edit supports assignment replacement. | Web task create form only has single "Primary Assignee" select and emits 1-item array. | Redesign task create form assignee picker: multi-member selection + zero/one primary selector. |
| **6. Calendar Edit / Reschedule** | Month/Week/Day projection, range calculation, timezone grouping, deadline-only support, and create-from-calendar exist. | Clicking calendar task only navigates to task page; no contextual schedule update affordance. | Add explicit "Reschedule" / "Edit Schedule" action on calendar event cards deep-linking to task detail modal in edit mode; ensure calendar projection refetches on return. |
| **7. Field Worker Operational UX** | My Work lists Today / Upcoming / Overdue. Responsive layout and drilldown exist. | No quick-status action on task cards (requires full task detail modal navigation). No mobile-optimized task action flow. | Add allowed quick-status transition buttons directly on My Work cards; mobile-first execution interaction. |
| **8. Task Search & Filter Completion** | API `tasks.list` supports `q`, `status`, `priority`, `team_id`, `assignee_id`, `due_from`, `due_to`, `sort`. UI has partial filters. | Web UI lacks assignee filter, due range filters, overdue toggle, active/completed bucket tabs. Search `q` lacks debounce. Backend lacks explicit `overdue` and `bucket` query handling. | Complete Task List filter bar with assignee, due date, overdue toggle, bucket tabs; debounce search; add `overdue` & `bucket` query params in API. Preserve filter state in URL. |

---

## 2. Explicit Architecture & Operational Decisions

### 2.1 Settings & Administration Information Architecture (IA)

- **Navigation:** Add a `Settings` navigation item to `Shell` sidebar and mobile drawer.
- **Route Hierarchy:**
  - `/workspaces/:workspaceId/settings` -> redirects to `/settings/profile`
  - `/workspaces/:workspaceId/settings/profile` — Profile & personal preferences (accessible to **all active members**).
  - `/workspaces/:workspaceId/settings/workspace` — Workspace identity & timezone (accessible to **ADMIN only**; hidden/gated with 403 for others).
  - `/workspaces/:workspaceId/settings/members` — Member directory, role management, status toggle, add member (accessible to **ADMIN only**).
  - `/workspaces/:workspaceId/settings/teams` — Team list, create team, archive toggle, manager assignment, team members (accessible to **ADMIN only**).
- **Sub-navigation:** Clean tabbed navigation inside the Settings shell: `[Profile] [Workspace] [Members] [Teams]`. Non-admin users only see the `[Profile]` tab.

### 2.2 Authorization & Role Policy (ADMIN vs MANAGER vs MEMBER vs FIELD_WORKER)

| Action | ADMIN | MANAGER | MEMBER | FIELD_WORKER | Notes |
|---|:---:|:---:|:---:|:---:|---|
| **View Profile / Update Profile (`/me`)** | Yes | Yes | Yes | Yes | Own profile only |
| **View Workspace Settings** | Yes | No | No | No | Gated by `admin(req, wid)` |
| **Update Workspace Settings** | Yes | No | No | No | Gated by `admin(req, wid)` |
| **List Workspace Members** | Yes | Yes | Yes | Yes | Needed across app for assignees |
| **Add Member (by email)** | Yes | No | No | No | Gated by `admin(req, wid)` |
| **Update Member Role / Status** | Yes | No | No | No | Gated by `admin(req, wid)` |
| **Remove Member** | Yes | No | No | No | Gated by `admin(req, wid)` |
| **List Teams** | Yes | Yes | Yes | Yes | Needed for filter dropdowns |
| **Create / Edit / Archive Team** | Yes | No | No | No | Gated by `admin(req, wid)` |
| **Assign Team Manager** | Yes | No | No | No | Target must be `ADMIN` or `MANAGER` |
| **Add / Remove Team Members** | Yes | No | No | No | Gated by `admin(req, wid)` |
| **Create Task** | Yes | Yes | Yes | Yes | Any active member |
| **Assign / Reassign Task** | Yes | Yes | Yes | No | `TaskPolicy.canAssign` excludes FIELD_WORKER |
| **Mutate Task Status (Transitions)** | Yes | Yes | Yes | Yes | `TaskPolicy.canMutate` |
| **Delete Task (Soft Delete)** | Yes | Yes | No | No | `TaskPolicy.canDelete` |
| **Manager Dashboard & KPI Scoping** | Yes (all) | Yes (managed) | No | No | Scoped to `teams.manager_user_id == user.id` |

### 2.3 User Account Lifecycle vs Workspace Membership Lifecycle

- **User Account (`users.isActive`):** Owned by authentication layer (Better Auth). If `isActive === false`, the user is denied at global session guard with `403 ACCOUNT_INACTIVE`. Global deactivate is an out-of-band/system action.
- **Workspace Membership (`workspace_memberships.status`):** Workspace-scoped lifecycle with three canonical statuses:
  - `ACTIVE`: Normal member access, can log into workspace, be assigned tasks, transition tasks.
  - `SUSPENDED`: Temporarily deactivated in this workspace. `member(req, wid)` guard throws `403 MEMBERSHIP_SUSPENDED`. Excluded from active assignee selectors and team member selectors. Existing task assignments remain intact for audit history.
  - `REMOVED`: Soft-deleted membership (`left_at` or `status = 'REMOVED'`). Denied workspace access.
- **Self-Demotion / Last Admin Guard:** An administrator cannot remove themselves or demote their own role if they are the last remaining `ACTIVE` administrator in the workspace.

### 2.4 Onboarding Semantics: Add Existing Account by Email

- **Decision:** Floz operates on the free bootstrap topology without email dispatch infrastructure (Resend is optional/future).
- **Semantics:** "Add Member" takes `email` and `role_id` (or `role_code`):
  1. API searches `users` by normalized email (`LOWER(email)`).
  2. If user does not exist: returns `404 USER_NOT_FOUND` with message `"No registered account found with this email. The user must create an account first."`
  3. If user exists and already has active membership in workspace: returns `409 ALREADY_MEMBER`.
  4. If user exists and was previously suspended/removed: reactivates membership and updates role.
  5. If user exists and has no membership: inserts `workspace_memberships` row with status `ACTIVE`.
- **True Invitation (Email tokens):** Explicitly excluded until Gate B / Gate C email infrastructure.

### 2.5 Team Archive & Deactivation Behavior

- **Mechanism:** Uses existing canonical `teams.isActive: boolean` column.
- **Archive Action:** Sets `is_active = false`.
- **Effects:**
  - Archived teams are excluded from task create/edit team dropdowns.
  - Archived teams are excluded from active filter dropdowns by default.
  - Excluded from Manager Dashboard scope (`managerDashboard` endpoint already checks `team.isActive`).
  - Existing tasks linked to archived teams retain their `team_id` (foreign key intact, historical integrity preserved).
  - Admin Teams UI provides a toggle: `"Show active teams"` vs `"Show archived teams"` with a 1-click `"Restore team"` action.

### 2.6 Manager Assignment & Manager Dashboard Scope

- **Mechanism:** Uses existing canonical `teams.managerUserId: uuid` column (indexed by `teams_workspace_manager_idx`).
- **Validation:** When `manager_user_id` is provided (not null):
  1. Target user must be an active member of the same workspace (`workspace_memberships.status = 'ACTIVE'`).
  2. Target user's workspace role must be `MANAGER` or `ADMIN`. (Assigning `MEMBER` or `FIELD_WORKER` returns `400 INVALID_MANAGER`).
- **Clear Manager:** Passing `manager_user_id: null` clears the assignment.
- **Reporting Integration:** Changing `teams.manager_user_id` immediately updates `GET /workspaces/:id/dashboard/manager` and `GET /workspaces/:id/reports/kpis` for that manager without requiring cache invalidation (since reporting queries are live PostgreSQL projections).

### 2.7 Multi-Assignee Task Creation UX

- **Form Redesign:** Replace single `<select id="primary_assignee">` with a multi-assignee selector:
  - List of active workspace members with checkboxes.
  - When members are checked, they appear as selected badge chips.
  - A "Primary" selector (radio button / star icon) allows designating at most one of the selected members as `is_primary: true`.
  - Deselecting a member who is marked primary automatically unsets the primary assignment.
  - Zero assignees is valid (`assignees = []`).
  - Multiple assignees without a primary is valid (`assignees = [{ user_id, is_primary: false }, ...]`).
- **Payload:** Emits canonical `assignees: Array<{ user_id: string; is_primary: boolean }>`.
- **Validation:** Client-side check ensures at most one item has `is_primary === true` and all `user_id`s are unique.

### 2.8 Calendar Rescheduling Interaction

- **Decision:** Click-only contextual reschedule flow reusing existing Task Detail modal with optimistic concurrency.
- **Interaction Flow:**
  1. Calendar event card displays a clear, accessible `"Edit / Reschedule"` action button (plus clicking the card title).
  2. Action navigates to `/workspaces/:workspaceId/tasks?selected_task_id=:taskId&edit_schedule=1`.
  3. Tasks page detects `selected_task_id` + `edit_schedule=1`, automatically opens Task Detail modal in Edit Mode, and sets keyboard focus to `Start Date` / `Due Date` fields.
  4. Operator adjusts `start_at` / `due_at` and clicks `"Save Changes"`.
  5. Request sends `PATCH /workspaces/:workspaceId/tasks/:taskId` with updated dates and current `version`.
  6. On success, navigating back to Calendar remounts the view and refetches the live range projection.
- **Drag-to-Reschedule:** Explicitly excluded (per Wireframe open decision L743, accessibility guidelines, and YAGNI).
- **Start-Only Limitation:** Preserved (projection excludes tasks with `start_at != null && due_at == null`).

### 2.9 Version Conflict UX (Optimistic Concurrency)

- **Trigger:** Server returns `409 Conflict` with error code `VERSION_CONFLICT`.
- **UI Treatment:**
  - Standardized across Task Detail, Schedule Edit, Assignment Replacement, and Quick-Status Transitions.
  - Prominent amber banner: `"Conflict: This task was modified by another operator. Please reload latest state."`
  - Explicit `"Reload Latest"` button that immediately refetches fresh task data, updates the local form/state, and bumps the tracked `version`.
  - Disables save button until fresh state is loaded to prevent accidental overwrites.

### 2.10 Field Worker Quick-Status Interaction

- **Mobile-First UX on My Work (`/workspaces/:workspaceId/my-work`):**
  - Task cards in "Due today", "Upcoming", and "Overdue" sections expose one-tap status transition buttons for valid next transitions (e.g., `[Start]` if TODO, `[Complete]` if IN_PROGRESS).
  - Tapping transition sends `POST /workspaces/:workspaceId/tasks/:taskId/transitions` with `{ to_status_id, version }`.
  - If multiple valid transitions exist, a compact action sheet / dropdown appears with touch targets >= 44px.
  - Immediate optimistic/local UI update with refetch of My Work summary.
  - Tapping the card title/body opens essential task details with a direct link to full task list.

### 2.11 Task Search & Filter Completion

- **Audit of Implemented vs Missing:**
  - *API Supported:* `q` (title/key), `status` (array), `priority` (array), `team_id`, `assignee_id`, `due_from`, `due_to`, `sort`.
  - *API Gaps to close:* Add `overdue: boolean` and `bucket: 'active' | 'completed'` filter parameters to `TaskService.list` SQL WHERE clause.
  - *UI Gaps to close:*
    - Add `Assignee` filter dropdown (populated with active members).
    - Add `Due Date Range` picker (`due_from`, `due_to`).
    - Add `Overdue Only` checkbox/toggle.
    - Add `Active` vs `Completed` tab selector (mapping to `bucket=active` / `bucket=completed`).
    - Add 300ms debounce to search query input (`q`) to prevent rapid router pushes per keystroke.
    - Synchronize all filter controls bidirectionally with URL query parameters so filters survive refresh and back-navigation.

---

## 3. Detailed API & Schema Specifications

### 3.1 Schema Changes

**Evidence:** Inspection of `database/src/schema.ts` confirms that all required columns, foreign keys, and indexes already exist in the database:
- `users`: `id`, `email`, `name`, `image`, `timezone`, `locale`, `is_active`.
- `workspaces`: `id`, `name`, `slug`, `timezone`, `is_active`.
- `workspace_memberships`: `id`, `workspace_id`, `user_id`, `role_id`, `status`, `joined_at`.
- `roles`: `id`, `code` (`ADMIN`, `MANAGER`, `MEMBER`, `FIELD_WORKER`), `name`.
- `teams`: `id`, `workspace_id`, `name`, `description`, `manager_user_id`, `is_active`.
- `team_memberships`: `id`, `team_id`, `user_id`, `membership_role`, `joined_at`, `left_at`.
- `tasks`: `id`, `version`, `start_at`, `due_at`, `priority`, `team_id`, `status_id`.
- `task_assignees`: `id`, `task_id`, `user_id`, `is_primary`.

**Conclusion:** **ZERO new database tables or schema migrations required.** Existing database structures are 100% sufficient.

### 3.2 Required New & Extended API Endpoints

#### Profile & Personal Preferences
- **`PATCH /api/v1/me`**
  - *Auth:* Authenticated user.
  - *Request Body:* `{ full_name?: string; timezone?: string; locale?: string; avatar_url?: string | null }`
  - *Validation:* `timezone` must be valid IANA identifier; `locale` must be supported string (`id-ID`, `en-US`); `full_name` min 1 char.
  - *Response:* `200 OK` `{ data: PublicUserDto }`

#### Workspace Administration
- **`PATCH /api/v1/workspaces/:workspaceId`**
  - *Auth:* Workspace `ADMIN` only.
  - *Request Body:* `{ name?: string; timezone?: string }`
  - *Validation:* `name` min 1 char; `timezone` valid IANA identifier.
  - *Response:* `200 OK` `{ data: WorkspaceDto }`

#### Member Administration
- **`POST /api/v1/workspaces/:workspaceId/members`**
  - *Auth:* Workspace `ADMIN` only.
  - *Request Body:* `{ email: string; role_code: 'ADMIN' | 'MANAGER' | 'MEMBER' | 'FIELD_WORKER' }`
  - *Validation:* `email` valid format; user must exist in `users` table; user not already active member.
  - *Response:* `201 Created` `{ data: MemberDto }`
- **`PATCH /api/v1/workspaces/:workspaceId/members/:userId`**
  - *Auth:* Workspace `ADMIN` only.
  - *Request Body:* `{ role_code?: string; status?: 'ACTIVE' | 'SUSPENDED' | 'REMOVED' }`
  - *Validation:* Last active admin cannot demote self or change own status to non-ACTIVE.
  - *Response:* `200 OK` `{ data: MemberDto }`
- **`DELETE /api/v1/workspaces/:workspaceId/members/:userId`**
  - *Auth:* Workspace `ADMIN` only.
  - *Behavior:* Sets membership status to `REMOVED`. Last active admin cannot remove self.
  - *Response:* `204 No Content`

#### Team Administration
- **`PATCH /api/v1/workspaces/:workspaceId/teams/:teamId`** *(extend existing)*
  - *Auth:* Workspace `ADMIN` only.
  - *Request Body:* `{ name?: string; description?: string | null; manager_user_id?: string | null; is_active?: boolean }`
  - *Validation:* `manager_user_id` must reference active workspace member with role `ADMIN` or `MANAGER`.
  - *Response:* `200 OK` `{ data: TeamDto }`

#### Task List Filter Extensions
- **`GET /api/v1/workspaces/:workspaceId/tasks`** *(extend existing query parser)*
  - *New Query Params:*
    - `overdue?: 'true' | 'false'` -> filters `due_at < NOW() AND status.category != 'DONE'`
    - `bucket?: 'active' | 'completed'` -> `active` filters non-terminal statuses; `completed` filters `completed_at IS NOT NULL`.

---

## 4. Web UI & UX Specifications

### 4.1 Settings Shell & Profile Settings (`/settings/profile`)
- Header with user display info: authenticated email (read-only with badge `"Managed via Login"`), user ID.
- Form fields:
  - `Full Name` text input.
  - `Timezone` searchable select (prefilled with user's timezone or system default).
  - `Locale / Language` select (`id-ID (Bahasa Indonesia)`, `en-US (English)`).
  - `Avatar` display with placeholder initials and note `"Custom photo upload available in cloud edition"`.
- Loading spinner on save, inline green success banner on save, inline error banner on failure.

### 4.2 Workspace Settings (`/settings/workspace`)
- Accessible only to `ADMIN` (other roles see standard 403 screen or redirected).
- Form fields:
  - `Workspace Name` text input.
  - `Workspace Timezone` select (used for all reporting and calendar calculations).
  - Read-only details: Workspace Slug, Created At, Workspace ID.
- Save button with confirmation toast/banner.

### 4.3 Member Administration (`/settings/members`)
- Header with `+ Add Member` button (opens Add Member dialog).
- Member Table:
  - Columns: Name & Email, Role badge (`ADMIN`, `MANAGER`, `MEMBER`, `FIELD_WORKER`), Status badge (`ACTIVE` green, `SUSPENDED` yellow, `REMOVED` gray), Joined Date, Actions menu.
  - Search filter input by member name / email.
- Add Member Dialog:
  - Input: User Email.
  - Select: Role (`ADMIN`, `MANAGER`, `MEMBER`, `FIELD_WORKER`).
  - Explanatory note: `"User must have an existing Floz account. If they haven't registered yet, please have them sign up first."`
- Member Row Actions:
  - `Change Role` dropdown.
  - `Suspend Member` / `Reactivate Member` toggle.
  - `Remove from Workspace` with confirmation modal.
  - Last-admin protection: disable demote/remove actions on the current user if they are the sole admin.

### 4.4 Team Administration (`/settings/teams`)
- Header with `+ Create Team` button and `[Active Teams / Archived Teams]` tab toggle.
- Team Card / Table list:
  - Team Name, Description, Manager Name (or `"No manager assigned"`), Member Count, Status (`Active` / `Archived`).
  - Actions: Edit Team, Manage Members, Archive / Restore.
- Create / Edit Team Modal:
  - Team Name (required), Description (optional).
  - Manager select: list of workspace members with role `ADMIN` or `MANAGER` + `"None"`.
- Team Members Modal:
  - List current members with `Remove` button.
  - `Add Member` select from active workspace members.

### 4.5 Multi-Assignee Task Create UX (`/tasks`)
- Replace single select in task create modal with:
  - Assignees Section:
    - Member picker (multi-select / checkbox list).
    - Selected members rendered as badges.
    - Each selected member has a star icon / `"Primary"` radio to designate the primary assignee.
    - Helper text: `"Select one or more assignees. Optionally designate one as primary."`

### 4.6 Calendar Contextual Reschedule UX (`/calendar`)
- Calendar task items render title, priority, primary assignee, and a contextual `"Reschedule"` link/icon.
- Clicking `"Reschedule"` navigates to `/tasks?selected_task_id=:id&edit_schedule=1`.
- Task Detail opens in Edit Mode focusing date inputs.
- After saving changes, browser back navigation or clicking `"Return to Calendar"` returns to the calendar with updated timestamps.

### 4.7 Field Worker Quick Status Flow (`/my-work`)
- Card layout on mobile:
  - Prominent title, priority badge, due time.
  - Direct action button: `[Start Task]` (transitions TODO -> IN_PROGRESS), `[Complete Task]` (transitions IN_PROGRESS -> DONE).
  - If multiple transitions exist: compact dropdown select.
  - Tap card body: opens lightweight detail view.

### 4.8 Task List Filters (`/tasks`)
- Enhanced filter toolbar:
  - `Search` input with 300ms debounce.
  - `Status` multi/single select.
  - `Priority` select.
  - `Team` select.
  - `Assignee` select (new).
  - `Due Date` range (`From`, `To`) (new).
  - `Overdue Only` checkbox toggle (new).
  - `Active` / `Completed` tab bar (new).
  - `Sort` order select.
  - All state serialized to URL query parameters.

---

## 5. Edge Cases & Resilience

1. **Last Admin Protection:**
   - Database/API validation prevents updating status or role of the last remaining `ACTIVE` `ADMIN` in a workspace.
2. **Manager Assignment Invariant:**
   - API verifies `manager_user_id` belongs to `workspace_memberships` with status `ACTIVE` and role in `['ADMIN', 'MANAGER']`.
   - If an existing team manager has their workspace role demoted to `MEMBER` or is suspended, team management queries handle this gracefully and highlight `"Manager role invalid — please reassign"` in admin UI.
3. **Cross-Workspace Data Leakage:**
   - All member additions, team creations, and task assignments validate workspace boundaries server-side using parameterized queries.
4. **Optimistic Concurrency Collision:**
   - Any concurrent update to task fields, schedule, assignees, or status triggers `409 VERSION_CONFLICT`. UI displays reload prompt and does not overwrite remote changes.
5. **Start Date vs Due Date Order:**
   - Task create/update enforces `start_at <= due_at` when both timestamps are present.

---

## 6. Testing & Verification Strategy

### 6.1 Database & Integration Tests (`@floz/database`, `@floz/api`)
- `PATCH /me`: updates full_name, timezone, locale; validates input; rejects unauthenticated.
- `PATCH /workspaces/:id`: updates workspace name, timezone; rejects non-ADMIN (403).
- Member lifecycle:
  - `POST /members`: adds existing user by email; rejects non-existent email (404); rejects duplicate (409); rejects non-ADMIN (403).
  - `PATCH /members/:uid`: updates role; suspends member; prevents last-admin self-demotion/removal (400).
- Team admin & manager assignment:
  - `POST /teams` and `PATCH /teams/:id`: assigns valid manager; rejects member with role `MEMBER` or `FIELD_WORKER` (400); clears manager with `null`.
  - Team archive: sets `is_active = false`; verifies exclusion from manager dashboard.
- Task search/filters:
  - `GET /tasks?assignee_id=...&overdue=true&bucket=active`: verifies correct WHERE predicate generation and count.

### 6.2 Web Unit & Component Tests (`@floz/web`)
- `ProfileSettings`: renders user data, updates preferences, handles API error.
- `WorkspaceSettings`: renders workspace info, gates non-admin access.
- `MemberAdmin`: renders member list, add member form, role change, status toggle.
- `TeamAdmin`: renders team list, create/edit modal, manager select, archive toggle.
- `MultiAssigneePicker`: selecting/unselecting members, setting single primary, unsetting primary.
- `MyWorkQuickStatus`: renders allowed transition buttons, fires transition API call.
- `TaskListFilters`: debounced search, URL param serialization, assignee and date filters.

### 6.3 Playwright E2E Verification Scenarios (`apps/web/e2e/flow.spec.ts`)
1. **Admin Workspace & Profile Flow:**
   - Admin logs in -> navigates to Settings -> updates profile timezone & name -> verifies save.
   - Admin navigates to Workspace Settings -> updates workspace name -> verifies updated in sidebar.
2. **Admin Member Management Flow:**
   - Admin navigates to Member Settings -> adds existing user by email as `MEMBER` -> verifies listed.
   - Admin changes role to `MANAGER` -> verifies role badge updates.
   - Admin suspends member -> verifies `SUSPENDED` status badge.
3. **Admin Team Management & Manager Dashboard Flow:**
   - Admin creates new team -> assigns the newly promoted `MANAGER` as team manager.
   - Manager logs in -> opens Manager Dashboard -> verifies newly assigned team is in scope.
4. **Multi-Assignee Task Creation Flow:**
   - Operator creates task -> selects 2 assignees -> marks 1 as primary -> submits.
   - Task detail modal verifies both assignees listed with primary highlighted.
5. **Calendar Reschedule Flow:**
   - User opens Calendar -> clicks "Reschedule" on task -> opens detail in edit mode -> changes due date -> saves -> returns to Calendar -> verifies task shifted to new date.
6. **Field Worker Quick Status Flow:**
   - Field worker logs in -> opens My Work -> clicks `[Start Task]` quick action -> verifies card moves to IN_PROGRESS.
7. **Task Search & Filter Navigation Flow:**
   - User filters task list by Assignee and Overdue -> navigates away to Dashboard -> clicks back -> verifies filter state preserved in URL.

---

## 7. Explicit Exclusions (Preserved for Phase 10+)

The following capabilities are strictly excluded from Phase 9 to maintain sharp focus on P0 Operator Usability:
- Approval workflows, requests, and `pending_approvals` (Phase 10).
- Comments, mentions, and activity feed (Phase 10).
- Workflow and custom status configuration (Phase 11).
- File attachments and Cloudflare R2 upload (Post-Pilot).
- Email invitation dispatch & password reset emails (Requires email infrastructure).
- Notification preferences UI and push notifications (Post-Pilot).
- Historical KPI snapshot tables / exports / CSV download (Post-Pilot).
- `CUSTOM` recurrence grammar (Future).
- Calendar start-only task projection (Accepted limitation).
- Production infrastructure / Docker deployment (Phase 12).

---

## 8. Migration, Compatibility & Rollback Plan

- **Database Migrations:** Zero schema migrations required. All tables and columns exist.
- **API Backward Compatibility:** All existing endpoints (`GET /members`, `GET /teams`, `POST /tasks`, etc.) retain identical response shapes and contracts. New query parameters on `GET /tasks` are strictly optional.
- **Rollback:** In the event of an issue, reverting the application code cleanly restores Phase 8 behavior without database rollback or data loss.
