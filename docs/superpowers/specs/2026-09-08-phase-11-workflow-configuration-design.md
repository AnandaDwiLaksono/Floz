# Phase 11: Workflow Configuration Design

**Status**: DRAFT DESIGN / AWAITING APPROVAL

## 1. Current State Reconstructed
Phase 10 is complete, accepted, and published (master HEAD: `0cc52c0`). The Floz platform relies on task workflows across Tasks, Kanban, Calendar, Recurrence Rules, Dashboard KPIs, and Approvals.

Currently in implementation:
- **Workflows (`workflows`)**: Table supports workspace isolation (`workspace_id`), optional team scope (`team_id`), `code`, `name`, `description`, `is_default`, `is_active`, and `created_by`. Currently, a single default workflow is statically seeded per workspace.
- **Statuses (`task_statuses`)**: Scoped to a workflow via `workflow_id`, with `code`, `name`, `category` (`TODO`, `IN_PROGRESS`, `DONE`, `CANCELLED`), `position`, `is_initial`, and `is_terminal`. Unique constraint on `(workflow_id, code)`.
- **Transitions (`workflow_transitions`)**: Directed edges `(from_status_id, to_status_id)` scoped to `workflow_id` with `requires_permission` flag. Unique constraint on `(workflow_id, from_status_id, to_status_id)`.
- **Task Assignment**: Tasks store `workflow_id` and `status_id`. Task transitions are validated server-side against `workflow_transitions`. Foreign keys in `tasks` and `task_history` prevent hard deletion of referenced `task_statuses`.
- **Recurrence Integration**: `recurrence_rules` store a JSON `template_snapshot` containing `workflow_id`, `status_id`, and `team_id`.
- **Reporting & KPIs**: `reporting-core.ts` and `dashboard.ts` rely on `task_statuses.category` and `is_terminal` flags. Tasks with `category = 'DONE'` set `completed_at = NOW()`; non-DONE clears `completed_at`. Tasks with `category = 'CANCELLED'` are excluded from operational active and KPI calculations.

## 2. Problem / Goal
Floz requires workspace-admin configurable workflow structures (workflows, statuses, and transition rules) without breaking existing task transitions, historical audit records (`task_history`), recurring task generation, or dashboard reporting.

## 3. Scope Definition

### P0 Scope (MVP)
1. **Workflow Management**: Create, read, update, set default, and archive workflows.
2. **Status Management**: Add, update, reorder, and soft-delete/archive statuses within a workflow.
3. **Transition Configuration**: Define valid transition pairs between statuses using a matrix/list model.
4. **Aggregate Concurrency Control**: Optimistic versioning (`workflow.version`) covering the entire workflow configuration aggregate.
5. **Runtime Compatibility & Archival**: Allow tasks in archived statuses/workflows to remain readable and transition OUT to active targets, while prohibiting new tasks or incoming transitions to archived statuses.
6. **Recurrence Safety**: Prevent archiving workflows or statuses actively referenced by enabled recurrence rules.
7. **Web UI**: Settings interface at `/workspaces/:workspaceId/settings/workflows` with responsive matrix/list views and keyboard-accessible reordering.

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
  - Task Creation Resolution: If `workflow_id` is omitted in task creation, resolve to team-level active default if `team_id` is specified and has a team default; otherwise fall back to workspace-level active default.
- **Team Scope Immutability**: `workflows.team_id` is immutable after workflow creation in Phase 11.

### B. Workflow Aggregate Concurrency Control
- `workflows.version`: Integer column defaulting to `1`.
- **Aggregate Mutation Rules**: Any mutation to workflow metadata, status creation/update/reorder/archive, or transition graph MUST:
  1. Accept expected `version` in payload.
  2. Execute pessimistic transaction locking order:
     ```text
     SELECT ... FROM workspaces WHERE id = :workspaceId FOR UPDATE (if default/scope invariants touched)
     -> SELECT ... FROM workflows WHERE id = :workflowId AND workspace_id = :workspaceId FOR UPDATE
     -> SELECT ... FROM task_statuses WHERE workflow_id = :workflowId FOR UPDATE
     -> Perform mutation & invariant checks
     -> UPDATE workflows SET version = version + 1, updated_at = NOW() WHERE id = :workflowId AND version = :expectedVersion
     ```
  3. If version update returns 0 rows, rollback and throw `409 VERSION_CONFLICT` with `{ current_version: workflow.version }`.

### C. Default & Initial-Status Invariants
- **Initial Status Rules**:
  - Exactly one ACTIVE status per active workflow MUST have `is_initial = true`.
  - Initial status MUST have `is_terminal = false` and `category IN ('TODO', 'IN_PROGRESS')`.
  - Initial status CANNOT be archived (`is_active = false`).
  - Setting a new initial status automatically unsets `is_initial = false` on the previous initial status within the same transaction.
- **Default Workflow Rules**:
  - Exactly one ACTIVE workspace-level workflow (`team_id IS NULL`) MUST have `is_default = true`.
  - Setting a new workspace default automatically unsets `is_default = false` on the previous default workflow.
  - Active workspace default workflow CANNOT be archived (`is_active = false`). Attempting to archive the active workspace default returns `409 CANNOT_ARCHIVE_DEFAULT_WORKFLOW`.

### D. Status Identity & Ordering
- **Code & Name Invariants**:
  - `code`: Uppercase string `[A-Z0-9_]{2,32}`, unique per workflow (`UNIQUE(workflow_id, code)`). **Immutable** after creation.
  - `name`: Max 64 chars, trimmed. Case-insensitively unique per workflow (`UNIQUE(workflow_id, LOWER(name))`). Editable.
- **Position & Ordering**:
  - Active statuses (`is_active = true`) are assigned contiguous 1-based integers (`position = 1..N`).
  - Status reorder endpoint (`PUT /:workflowId/statuses/reorder`) receives an ordered array of `status_ids`, validates that all IDs belong to the workflow and are active, updates positions to `1..N`, and bumps `workflow.version`.
  - Archived statuses (`is_active = false`) are assigned `position = 9999` and excluded from standard reordering.

### E. Status Archival & Runtime Behavior
- **Archival Persistence**: Statuses use soft-delete (`is_active BOOLEAN NOT NULL DEFAULT true`). Hard deletion of `task_statuses` is strictly forbidden to preserve FK integrity with `tasks` and `task_history`.
- **Runtime Transition Policy**:
  - `from_status` (source): MAY be archived (`is_active = false`). Existing tasks in an archived status can escape!
  - `to_status` (target): MUST be active (`is_active = true`). Transitions INTO archived statuses throw `422 ATTEMPTED_INACTIVE_TARGET`.
  - Available Transitions API (`GET /tasks/:id/transitions`): Returns only target statuses where `to_status.is_active = true`.
- **Kanban Board Projection**:
  - Columns are rendered for all active statuses (`is_active = true`).
  - If tasks in the current filter occupy an archived status, a dynamic "Archived: [Status Name]" column is appended to the right of the board.
  - Archived columns are visually flagged with an "Archived" badge and read-only drop target. Cards inside it show valid escape dropdown options to active statuses, but dragging cards into an archived column is prevented.
- **Task List, My Work, Calendar, Dashboards**: Display the status normally, appending an "(Archived)" badge if `is_active = false`.

### F. Workflow Archival & Recurrence Safety
- **Workflow Archival**: Soft-delete via `workflows.is_active = false`.
- **Existing Tasks**: Tasks assigned to an archived workflow remain readable and can continue transitioning between active statuses in that workflow.
- **New Tasks**: Cannot select or inherit an archived workflow.
- **Recurrence Safety Check**:
  - Before archiving a workflow or status, check active `recurrence_rules` (`workspace_id = :workspaceId AND is_active = true`).
  - If any active recurrence rule references the workflow (`template_snapshot->>'workflow_id' = :workflowId`) or status being archived (`template_snapshot->>'status_id' = :statusId`), the archive operation is BLOCKED.
  - Throws `409 RECURRENCE_DEPENDENCY_CONFLICT` with body `{ conflicting_rule_ids: string[], message: 'Active recurrence rules reference this workflow/status.' }`.

### G. Transition Metadata Preservation
- Transition graph pairs `(from_status_id, to_status_id)` maintain the existing `requires_permission` column.
- Bulk transition replacement (`PUT /:workflowId/transitions`):
  - Retained pairs: Preserve existing `requires_permission` value.
  - New pairs: Default `requires_permission = false`.
  - Removed pairs: Deleted from `workflow_transitions`.
- Invariants: Self-loops (`from_status_id = to_status_id`) are forbidden (`422 SELF_LOOP_NOT_ALLOWED`). Cycles and unreachable statuses are permitted.

### H. Category, `is_terminal`, and Completion Alignment
- **Canonical Status Categories**: `TODO`, `IN_PROGRESS`, `DONE`, `CANCELLED`.
- **Enforcement Invariants**:
  - Category `TODO` or `IN_PROGRESS` -> MUST have `is_terminal = false`.
  - Category `DONE` -> MUST have `is_terminal = true`.
  - Category `CANCELLED` -> MUST have `is_terminal = true`.
- **Task Completion Semantics**:
  - Transition to status with `category = 'DONE'` -> `completed_at = NOW()`, history event `COMPLETED`.
  - Transition from `category = 'DONE'` to non-DONE status -> `completed_at = NULL`, history event `REOPENED`.
  - Transition between other statuses -> `task_history` event `STATUS_CHANGED`.
- **Operational & KPI Alignment**: Operational active and KPI reporting filters exclude `category = 'CANCELLED'` tasks.

---

## 5. Database Schema Modifications

```sql
-- 1. Add version column for aggregate concurrency control on workflows
ALTER TABLE workflows ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

-- 2. Add is_active column for soft-delete/archival on task_statuses
ALTER TABLE task_statuses ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;

-- 3. Add case-insensitive unique index on status name per workflow
CREATE UNIQUE INDEX task_statuses_workflow_name_lower_idx ON task_statuses (workflow_id, LOWER(name));
```

No table drops or column removals. Full backward compatibility preserved.

---

## 6. API Specifications

**Base Path**: `/api/v1/workspaces/:workspaceId/workflows`
**Authorization**: `GET` endpoints require ACTIVE workspace membership. All mutation endpoints require `ADMIN` role (`403 FORBIDDEN` for non-ADMIN).

### Endpoints
1. `GET /` : List workflows (include `team_id`, `is_default`, `is_active`, `statuses`).
2. `POST /` : Create workflow atomically.
   - Body: `{ name, code, description?, team_id?, is_default?, statuses: [{ code, name, category, is_initial, is_terminal }], transitions: [{ from_code, to_code }] }`
3. `GET /:workflowId` : Get workflow details with full status list and transition matrix.
4. `PATCH /:workflowId` : Update workflow metadata (name, description, `is_default`, `version`).
5. `POST /:workflowId/archive` : Soft-delete workflow (`is_active = false`, requires `version`).
6. `POST /:workflowId/restore` : Restore workflow (`is_active = true`, requires `version`).
7. `POST /:workflowId/statuses` : Add new status (requires `version`).
8. `PATCH /:workflowId/statuses/:statusId` : Update status properties (`name`, `category`, `is_terminal`, `version`).
9. `POST /:workflowId/statuses/:statusId/archive` : Soft-delete status (`is_active = false`, requires `version`).
10. `POST /:workflowId/statuses/:statusId/restore` : Restore status (`is_active = true`, requires `version`).
11. `PUT /:workflowId/statuses/reorder` : Reorder active statuses.
    - Body: `{ version: number, status_ids: string[] }`
12. `PUT /:workflowId/transitions` : Bulk update transition graph.
    - Body: `{ version: number, transitions: Array<{ from_status_id: string, to_status_id: string }> }`

### Error Contracts
- `400 VALIDATION_ERROR`: Invalid inputs (e.g. initial status marked terminal, invalid status code format).
- `403 FORBIDDEN`: Non-ADMIN attempting workflow mutation.
- `404 NOT_FOUND`: Workflow or status ID does not exist in workspace.
- `409 VERSION_CONFLICT`: Stale `version` provided (`{ error: { code: 'VERSION_CONFLICT', message: '...', details: [{ current_version: 3 }] } }`).
- `409 CANNOT_ARCHIVE_DEFAULT_WORKFLOW`: Attempt to archive the active workspace default workflow.
- `409 RECURRENCE_DEPENDENCY_CONFLICT`: Active recurrence rule depends on this workflow or status.
- `422 WORKFLOW_SCOPE_MISMATCH`: Workflow team scope incompatible with task or team assignment.
- `422 ATTEMPTED_INACTIVE_TARGET`: Attempting to set or transition to an archived status target.
- `422 SELF_LOOP_NOT_ALLOWED`: Transition `from_status_id === to_status_id`.

---

## 7. Web UX Specification

**Route**: `/workspaces/:workspaceId/settings/workflows` (ADMIN Only)

### Layout & Components
1. **Workflow Selector Header**: Dropdown to select active or archived workflows; "Create Workflow" button. Default badge shown next to active default.
2. **Status Management Section**:
   - Status cards list with drag handles for mouse users.
   - **Accessibility**: Keyboard "Move Up" / "Move Down" buttons on each status card.
   - Initial badge (`is_initial`) and Terminal badge (`is_terminal`).
   - Category selector (`TODO`, `IN_PROGRESS`, `DONE`, `CANCELLED`).
   - Archive status action with warning modal if tasks currently occupy the status.
3. **Transition Matrix Section**:
   - **Desktop Grid (>=768px)**: Matrix table with "From Status" on rows and "To Status" on columns. Checkbox at each intersection to toggle transition. Disabled checkboxes for self-loops (`from == to`).
   - **Mobile/Narrow List (<768px)**: Accordion list grouped by "From Status". Expanding a status shows a list of target statuses with accessible toggle switches.
4. **Stale Version Handling**: Displays a warning toast on `409 VERSION_CONFLICT` with an immediate "Reload Workflow" action button.

---

## 8. Testing & Verification Strategy

### Real PostgreSQL Tests
- `workflow-concurrency.integration.test.ts`: Test concurrent status edits and transition updates under `FOR UPDATE` locks, verifying `409 VERSION_CONFLICT` and version increments.
- `workflow-scope.integration.test.ts`: Verify task creation resolution across team defaults and workspace defaults, rejecting cross-team workflows (`422 WORKFLOW_SCOPE_MISMATCH`).
- `workflow-archival.integration.test.ts`:
  - Test archiving a status with active tasks: verify tasks remain readable, can transition OUT to active targets, but CANNOT accept incoming transitions (`422 ATTEMPTED_INACTIVE_TARGET`).
  - Test active recurrence dependency blocking (`409 RECURRENCE_DEPENDENCY_CONFLICT`).
  - Test blocking archival of active workspace default (`409 CANNOT_ARCHIVE_DEFAULT_WORKFLOW`).

### API Unit & Authorization Tests
- `workflow-admin-auth.test.ts`: Verify non-ADMIN role receives `403 FORBIDDEN` for all mutation endpoints.
- `workflow-validation.test.ts`: Verify initial status rules, self-loop rejections, and category/terminal invariants.

### Web Component Tests
- `workflow-editor.test.tsx`: Test keyboard reordering, transition matrix toggles, and responsive list fallback.

### Playwright E2E Scenarios (`scripts/test-e2e.ps1`)
- Scenarios covering ADMIN creating a custom workflow, configuring status transitions, creating tasks in the custom workflow, transitioning tasks through the matrix, archiving a status with active tasks, and verifying task escape capability.
- Full Phase 0–10 regression suite MUST pass clean.
