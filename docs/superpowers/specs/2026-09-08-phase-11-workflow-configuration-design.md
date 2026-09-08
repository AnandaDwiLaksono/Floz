# Phase 11: Workflow Configuration Design

**Status**: DRAFT DESIGN / AWAITING APPROVAL

## 1. Current State Reconstructed
Phase 10 is complete, accepted, and published (master HEAD: `0cc52c0`). The Floz platform relies on task workflows across Tasks, Kanban, Calendar, Recurrence Rules, Dashboard KPIs, and Approvals.

Currently in implementation:
- **Workflows (`workflows`)**: Table supports workspace isolation (`workspace_id`), optional team scope (`team_id`), `code`, `name`, `description`, `is_default`, `is_active`, and `created_by`. Currently, a single default workflow is statically seeded per workspace. Unique constraints exist on `(workspace_id, code)` and `(workspace_id, name)`.
- **Statuses (`task_statuses`)**: Scoped to a workflow via `workflow_id`, with `code`, `name`, `category` (`TODO`, `IN_PROGRESS`, `DONE`, `CANCELLED`), `position`, `is_initial`, and `is_terminal`. Unique constraint on `(workflow_id, code)`.
- **Transitions (`workflow_transitions`)**: Directed edges `(from_status_id, to_status_id)` scoped to `workflow_id` with `requires_permission` flag. Unique constraint on `(workflow_id, from_status_id, to_status_id)`.
- **Task Assignment**: Tasks store `workflow_id` and `status_id`. Task transitions are validated server-side against `workflow_transitions`. Foreign keys in `tasks` and `task_history` prevent hard deletion of referenced `task_statuses`.
- **Recurrence Integration**: `recurrence_rules` store a JSON `template_snapshot` containing `workflow_id`, `status_id`, and `team_id`.
- **Reporting & KPIs**: `reporting-core.ts` and `dashboard.ts` rely on `task_statuses.category` and `is_terminal` flags. Tasks with `category = 'DONE'` set `completed_at = NOW()`; non-DONE clears `completed_at`. Tasks with `category = 'CANCELLED'` are excluded from operational active and KPI calculations.

## 2. Problem / Goal
Floz requires workspace-admin configurable workflow structures (workflows, statuses, and transition rules) without breaking existing task transitions, historical audit records (`task_history`), recurring task generation, or dashboard reporting.

## 3. Scope Definition

### P0 Scope (MVP)
1. **Workflow Lifecycle**: Create (atomic aggregate), read, update metadata, set default, archive, and restore workflows.
2. **Status Lifecycle**: Add status, update properties (name, category), set initial status, reorder active statuses, archive, and restore statuses.
3. **Transition Configuration**: Bulk replace transition pairs for a workflow using a matrix/list model while preserving `requires_permission` on retained edges.
4. **Aggregate Concurrency Control**: Optimistic versioning (`workflows.version`) covering the entire workflow configuration aggregate.
5. **Runtime Compatibility & Archival**: Tasks in archived statuses remain readable and can transition OUT to active targets; transitions INTO archived statuses are prohibited.
6. **Recurrence Safety**: Prevent archiving workflows or statuses actively referenced by enabled recurrence rules.
7. **Web UI**: Settings interface at `/workspaces/:workspaceId/settings/workflows` with desktop transition matrix, mobile accordion list, keyboard-accessible reordering, and conflict handling.

### Deferred Scope
- Role-gated transition permission editing (`workflow_transitions.requires_permission` UI editing). Existing `requires_permission` values are preserved during bulk transition replacement, but editing is deferred.
- Automated transition triggers (e.g., auto-transitioning task on approval decision).
- Conditional transition rules (e.g., blocking transition if subtasks or approvals are pending).
- Cross-workspace workflow sharing or global workflow templates.

### Explicit Non-Goals
- Modifying immutable historical `task_history` rows.
- Visual node-and-wire canvas editor (matrix grid and structured list provide safer, accessible P0 UX).

---

## 4. Reconciled Domain Contracts & Invariants

### A. Workflow & Team Scoping Rules
- `workflows.team_id = NULL`: Workspace-level workflow. Available to all tasks in the workspace.
- `workflows.team_id = <team_uuid>`: Team-scoped workflow. Available ONLY to tasks assigned to that specific team (`tasks.team_id = <team_uuid>`).
- **Task Assignment Validity**:
  - Task with `team_id = NULL`: Must use a workspace-level workflow (`workflows.team_id = NULL`).
  - Task with `team_id = X`: May use a workspace-level workflow (`workflows.team_id = NULL`) OR a team-scoped workflow (`workflows.team_id = X`). Using a workflow assigned to another team (`workflows.team_id = Y`) throws `422 WORKFLOW_SCOPE_MISMATCH`.
- **Default Resolution**:
  - Exactly one ACTIVE workspace-level default (`team_id IS NULL AND is_default = true AND is_active = true`).
  - At most one ACTIVE team default per team (`team_id = X AND is_default = true AND is_active = true`).
  - Task Creation Resolution: If `workflow_id` is omitted in task creation, resolve to team-level active default if `team_id` is specified and has an active team default; otherwise fall back to workspace-level active default.
- **Team Scope Immutability**: `workflows.team_id` is immutable after workflow creation in Phase 11.

### B. Workflow Aggregate Concurrency Control
- `workflows.version`: Integer column defaulting to `1`.
- **Aggregate Mutation Rules**: Any mutation to workflow metadata, status creation/update/reorder/archive, initial status, or transition graph MUST:
  1. Accept expected `version` in payload.
  2. Execute pessimistic transaction locking order:
     ```text
     SELECT ... FROM workspaces WHERE id = :workspaceId FOR UPDATE (if default/scope invariants touched)
     -> SELECT ... FROM workflows WHERE id IN (:affectedWorkflowIds) ORDER BY id ASC FOR UPDATE
     -> SELECT ... FROM task_statuses WHERE workflow_id = :workflowId FOR UPDATE
     -> Perform mutation & invariant checks
     -> UPDATE workflows SET version = version + 1, updated_at = NOW() WHERE id = :workflowId AND version = :expectedVersion
     ```
  3. If version update returns 0 rows, rollback and throw `409 VERSION_CONFLICT` with `{ error: { code: 'VERSION_CONFLICT', message: 'Workflow modified by another user.', details: [{ current_version: workflow.version }] } }`.

### C. Explicit Set-Default Lifecycle & Team Default Semantics
- **Endpoint**: `POST /api/v1/workspaces/:workspaceId/workflows/:workflowId/set-default`
  - Body: `{ version: number }`
- **Transaction Semantics**:
  1. Acquire workspace row lock `FOR UPDATE`.
  2. Identify requested workflow and current active default workflow within the same scope (`team_id IS NULL` for workspace default, or `team_id = X` for team default).
  3. If target is already the active default (`is_default = true` and `is_active = true`): return target workflow as a deterministic no-op without mutation or version bump.
  4. Lock affected workflow rows in deterministic ID order (`ORDER BY id ASC FOR UPDATE`).
  5. Validate expected `version` on target workflow.
  6. Verify target workflow is active (`is_active = true`).
  7. If a previous default exists:
     `UPDATE workflows SET is_default = false, version = version + 1, updated_at = NOW() WHERE id = :previousDefaultId`
  8. `UPDATE workflows SET is_default = true, version = version + 1, updated_at = NOW() WHERE id = :workflowId`
  9. COMMIT and return updated workflow.
- **Archive / Restore of Defaults**:
  - Active workspace-level default (`team_id IS NULL`): CANNOT be archived (`is_active = false`). Attempt throws `409 CANNOT_ARCHIVE_DEFAULT_WORKFLOW`.
  - Team-scoped default workflow (`team_id = X`):
    - **Archiving**: Allowed. Atomically sets `is_active = false, is_default = false, version = version + 1`. Team task creation automatically falls back to workspace default.
    - **Restoring**: Restores with `is_active = true, is_default = false, version = version + 1`. Restoring a workflow never silently reclaims default status.

### D. Explicit Set-Initial Lifecycle & Status Invariants
- **Endpoint**: `POST /api/v1/workspaces/:workspaceId/workflows/:workflowId/statuses/:statusId/set-initial`
  - Body: `{ version: number }`
- **Transaction Semantics**:
  1. Lock workflow row `FOR UPDATE` and validate expected `version`.
  2. Lock status rows for workflow `FOR UPDATE`.
  3. Verify target status exists, belongs to workflow, `is_active = true`, `is_terminal = false`, and `category IN ('TODO', 'IN_PROGRESS')`.
  4. If target is already `is_initial = true`, return target status as a deterministic no-op without version bump.
  5. `UPDATE task_statuses SET is_initial = false WHERE workflow_id = :workflowId AND is_initial = true`
  6. `UPDATE task_statuses SET is_initial = true WHERE id = :statusId`
  7. `UPDATE workflows SET version = version + 1, updated_at = NOW() WHERE id = :workflowId`
  8. COMMIT and return updated status with new workflow version.
- **Initial Status Invariants**:
  - Exactly one ACTIVE status per active workflow MUST have `is_initial = true`.
  - Initial status CANNOT be archived (`is_active = false`). Attempt throws `409 CANNOT_ARCHIVE_INITIAL_STATUS`.

### E. Status Identity, Ordering & Category/Completion Mutation
- **Code & Name Invariants**:
  - `code`: Normalized uppercase string `[A-Z0-9_]{2,32}`, unique per workflow (`UNIQUE(workflow_id, code)`). **Immutable** after creation.
  - `name`: Max 64 chars, trimmed. Case-insensitively unique per workflow (`UNIQUE(workflow_id, LOWER(name))`). Editable.
- **Position & Reordering**:
  - Active statuses (`is_active = true`) have contiguous positions `1..N`.
  - Endpoint `PUT /:workflowId/statuses/reorder` receives `{ version: number, status_ids: string[] }`.
  - Validates that `status_ids` contains exactly all active status IDs for the workflow.
  - Updates positions atomically to `1..N` and bumps `workflow.version`.
  - Archived statuses have `position = 9999` and are excluded from standard reordering.
- **Category & Terminal Mapping**:
  - Server automatically derives `is_terminal` from `category`:
    - `TODO` -> `is_terminal = false`
    - `IN_PROGRESS` -> `is_terminal = false`
    - `DONE` -> `is_terminal = true`
    - `CANCELLED` -> `is_terminal = true`
  - UI presents `category`; server sets corresponding `is_terminal`.
  - **Category Mutation Safety**: A status's `category` can be changed on `PATCH .../statuses/:statusId` ONLY IF:
    - Zero active tasks reference the status (`SELECT COUNT(*) FROM tasks WHERE status_id = :statusId AND deleted_at IS NULL` == 0).
    - Zero active recurrence rules reference the status (`SELECT COUNT(*) FROM recurrence_rules WHERE workspace_id = :workspaceId AND is_active = true AND template_snapshot->>'status_id' = :statusId` == 0).
    - If referenced, throws `409 STATUS_CATEGORY_IN_USE` ("Cannot change category of a status currently referenced by tasks or active recurrence rules.").
  - **Task Completion Runtime Invariants**:
    - Transition to `category = 'DONE'` sets `completed_at = NOW()` and logs `COMPLETED`.
    - Transition from `category = 'DONE'` to non-DONE status sets `completed_at = NULL` and logs `REOPENED`.
    - Transition between other statuses logs `STATUS_CHANGED`.
    - Operational active reporting and KPI calculations exclude `category = 'CANCELLED'`.

### F. Status Archival & Transition Persistence Semantics
- **Archival Operation (`POST .../statuses/:statusId/archive`)**:
  - Sets `task_statuses.is_active = false, position = 9999`.
  - Bumps `workflow.version`.
  - **Retains all rows in `workflow_transitions`**. Existing transition records are NOT deleted.
- **Transition Graph Runtime & Configuration Rules**:
  - Outgoing edges from archived source: Retained and active. Existing tasks in an archived status can escape to active targets.
  - Incoming edges to archived target: Retained in database but dormant.
  - **Runtime Transition Execution (`POST .../tasks/:id/transition`)**: Transitioning into an inactive target status fails with canonical `400 INVALID_TRANSITION`.
  - **Workflow Configuration API**: Attempting to add a NEW edge pointing to an archived target fails with `422 INACTIVE_TRANSITION_TARGET`.
  - **Transition Bulk Replacement (`PUT .../transitions`)**:
    - Retained edges preserve their existing `requires_permission` metadata.
    - New edges default `requires_permission = false`.
    - Self-loops (`from_status_id === to_status_id`) are rejected with `422 SELF_LOOP_NOT_ALLOWED`.
- **Status Restoration (`POST .../statuses/:statusId/restore`)**:
  - Sets `task_statuses.is_active = true, position = activeCount + 1`.
  - Retained incoming edges automatically become active again.

### G. Workflow Archival & Recurrence Safety
- **Workflow Archival (`POST .../workflows/:workflowId/archive`)**:
  - Sets `workflows.is_active = false`, bumps `version`.
  - Existing tasks assigned to the workflow remain readable and can continue transitioning between active statuses in that workflow.
  - New tasks cannot select or default to an archived workflow.
- **Recurrence Rule Conflict Checking**:
  - Before archiving any workflow or status, check active `recurrence_rules` (`workspace_id = :workspaceId AND is_active = true`).
  - If any active recurrence rule references the workflow (`template_snapshot->>'workflow_id' = :workflowId`) or status (`template_snapshot->>'status_id' = :statusId`), the archive operation is BLOCKED.
  - Throws `409 RECURRENCE_DEPENDENCY_CONFLICT` with `{ error: { code: 'RECURRENCE_DEPENDENCY_CONFLICT', message: 'Active recurrence rules reference this workflow or status.', details: [{ rule_ids: [...] }] } }`.

### H. Kanban & Web Surface Behavior
- **Kanban Board**:
  - Columns rendered for all active statuses (`is_active = true`) in position order.
  - If current filtered tasks occupy an archived status, a dynamic "Archived: [Status Name]" column is appended to the right.
  - The archived column is visually marked with an "Archived" badge and cannot accept dropped cards.
  - Cards in the archived column display valid dropdown escape transitions to active statuses.
- **Task List, Calendar, My Work, Dashboards**: Display status name normally with an "(Archived)" badge if `is_active = false`.

---

## 5. Database Schema Modifications

```sql
-- 1. Add version column for aggregate concurrency control on workflows
ALTER TABLE workflows ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

-- 2. Add is_active column for soft-delete/archival on task_statuses
ALTER TABLE task_statuses ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;

-- 3. Add case-insensitive unique index on status name per workflow
CREATE UNIQUE INDEX task_statuses_workflow_name_lower_idx ON task_statuses (workflow_id, LOWER(name));

-- 4. Partial unique index: at most one active workspace-level default workflow
CREATE UNIQUE INDEX workflows_active_workspace_default_idx ON workflows (workspace_id)
  WHERE team_id IS NULL AND is_default = true AND is_active = true;

-- 5. Partial unique index: at most one active team-level default workflow per team
CREATE UNIQUE INDEX workflows_active_team_default_idx ON workflows (workspace_id, team_id)
  WHERE team_id IS NOT NULL AND is_default = true AND is_active = true;

-- 6. Partial unique index: at most one active initial status per workflow
CREATE UNIQUE INDEX task_statuses_active_initial_idx ON task_statuses (workflow_id)
  WHERE is_initial = true AND is_active = true;
```

---

## 6. API Specifications

**Base Path**: `/api/v1/workspaces/:workspaceId/workflows`
**Authorization**: `GET` endpoints require ACTIVE workspace membership. All mutation endpoints require `ADMIN` role (`403 FORBIDDEN` for non-ADMIN).

### Endpoints
1. `GET /` : List active and optionally archived workflows.
2. `POST /` : Create workflow atomically.
   - Body: `{ name, code, description?, team_id?, is_default?, statuses: [{ code, name, category, is_initial }], transitions: [{ from_code, to_code }] }`
3. `GET /:workflowId` : Get full workflow definition with statuses and transitions.
4. `PATCH /:workflowId` : Update metadata (`name`, `description`, `version`).
5. `POST /:workflowId/set-default` : Set workflow as active default (`{ version: number }`).
6. `POST /:workflowId/archive` : Soft-delete workflow (`{ version: number }`).
7. `POST /:workflowId/restore` : Restore workflow as non-default (`{ version: number }`).
8. `POST /:workflowId/statuses` : Add a new status (`{ name, code, category, version }`).
9. `PATCH /:workflowId/statuses/:statusId` : Update status (`{ name?, category?, version }`).
10. `POST /:workflowId/statuses/:statusId/set-initial` : Set status as active initial (`{ version: number }`).
11. `POST /:workflowId/statuses/:statusId/archive` : Soft-delete status (`{ version: number }`).
12. `POST /:workflowId/statuses/:statusId/restore` : Restore status (`{ version: number }`).
13. `PUT /:workflowId/statuses/reorder` : Reorder active statuses (`{ status_ids: string[], version: number }`).
14. `PUT /:workflowId/transitions` : Bulk replace transition graph (`{ transitions: Array<{ from_status_id: string, to_status_id: string }>, version: number }`).

### Error Contracts
- `400 VALIDATION_ERROR`: Invalid field formats or invalid transition graph constraints.
- `400 INVALID_TRANSITION`: Task transition runtime error when attempting an invalid or inactive target status transition.
- `403 FORBIDDEN`: Non-ADMIN attempting workflow configuration mutation.
- `404 NOT_FOUND`: Workflow or status ID not found in workspace.
- `409 VERSION_CONFLICT`: Stale aggregate `version` provided.
- `409 CANNOT_ARCHIVE_DEFAULT_WORKFLOW`: Attempt to archive active workspace default workflow.
- `409 CANNOT_ARCHIVE_INITIAL_STATUS`: Attempt to archive active initial status.
- `409 STATUS_CATEGORY_IN_USE`: Attempt to change category on a status currently referenced by tasks or active recurrence rules.
- `409 RECURRENCE_DEPENDENCY_CONFLICT`: Active recurrence rules depend on the workflow or status being archived.
- `422 WORKFLOW_SCOPE_MISMATCH`: Workflow team assignment incompatible with task or team scope.
- `422 INACTIVE_TRANSITION_TARGET`: Workflow configuration API rejected an edge to an inactive status.
- `422 SELF_LOOP_NOT_ALLOWED`: Transition where `from_status_id === to_status_id`.

---

## 7. Web UX Specification

**Route**: `/workspaces/:workspaceId/settings/workflows` (ADMIN Only)

### Layout & Components
1. **Workflow Master Selector**:
   - Header with workflow selector tabs/dropdown, active default badge, team scope badge, and "Create Workflow" button.
2. **Status Editor Section**:
   - Status cards displaying Name, Code, Category badge, Initial badge, and Terminal badge.
   - Drag handles for mouse reordering.
   - **Keyboard Accessibility**: "Move Up" and "Move Down" buttons on each card.
   - Actions: "Set as Initial", "Edit", "Archive" (with confirmation dialog).
3. **Transition Management Section**:
   - **Desktop (>=768px)**: Matrix grid. Rows = From Status, Columns = To Status. Checkbox at intersection. Disabled self-loop diagonal.
   - **Mobile / Narrow (<768px)**: Responsive accordion list grouped by "From Status". Expanding reveals toggle switches for valid target statuses.
4. **Stale State & Conflict UX**:
   - Displays toast on `409 VERSION_CONFLICT` with "Reload Configuration" button.

---

## 8. Testing Strategy

### Real PostgreSQL Concurrency & Invariant Tests
- `workflow-concurrency.integration.test.ts`:
  - Concurrent `set-default` vs `set-default` under workspace locks.
  - Concurrent `set-initial` vs `set-initial` under workflow locks.
  - Stale `version` updates triggering `409 VERSION_CONFLICT` and returning current version details.
  - Prevention of double workspace default and double team default via partial unique indexes.
  - Prevention of double active initial status via partial unique index.
- `workflow-lifecycle.integration.test.ts`:
  - Archiving team default -> workspace default fallback -> restoring as non-default.
  - Category change blocked on referenced status (`409 STATUS_CATEGORY_IN_USE`).
  - Archiving status retains dormant incoming transitions; restoring status reactivates edges.
  - Archiving workflow/status with active recurrence rules blocked (`409 RECURRENCE_DEPENDENCY_CONFLICT`).

### Web Component Tests
- `workflow-settings.test.tsx`: Test keyboard reordering, set-initial action, transition matrix toggles, and responsive list fallback.

### Playwright Real-Stack E2E Scenarios (`scripts/test-e2e.ps1`)
1. **Admin Workflow Configuration**: Admin creates workflow, sets statuses, configures transition matrix -> Task creates and transitions along matrix.
2. **Team Default Resolution**: Task created with team defaults to team workflow; task created with team having no team default falls back to workspace default.
3. **Archive Occupied Status**: Admin archives status with existing tasks -> Kanban displays read-only "Archived: [Name]" column -> Task escapes to active status -> Archived column disappears once empty.
4. **Stale Admin Conflict**: Two browser sessions edit the same workflow; second session receives `VERSION_CONFLICT` on save and reloads canonical state.
5. **Phase 0–10 Regression Suite**: All 19 existing Playwright flows pass clean.
