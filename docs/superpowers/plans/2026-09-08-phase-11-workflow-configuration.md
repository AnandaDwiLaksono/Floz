# Phase 11: Workflow Configuration Implementation Plan

**Status**: DRAFT IMPLEMENTATION PLAN / AWAITING APPROVAL

## Overview
Phase 11 implements workspace-admin configurable workflow structures for Floz. It transitions the application from a statically seeded default workflow to a dynamic multi-workflow model supporting custom statuses, category-derived terminal semantics, and matrix-based transition graphs. The implementation guarantees complete backward compatibility with existing `task_history` records, recurring task templates, and Dashboard KPI projections through soft-delete (archive) semantics and strict database invariants.

---

## Task & Checkpoint Breakdown

### Checkpoint A: Database Migration & Workflow Domain Invariants

#### Task 1: Drizzle Schema Modifications & Preflight Migration Safety
- **Objective**: Apply additive schema modifications for Phase 11 and add preflight invariant verification to prevent data corruption on existing databases.
- **Exact Expected Files/Modules**:
  - `database/src/schema.ts`
  - Next Drizzle migration generated under `database/drizzle/` (generated via `pnpm --filter @floz/database migration:generate`, expected prefix `0008_...sql`)
  - `database/drizzle/meta/_journal.json`
  - `database/test/workflow-migration.integration.test.ts`
- **Database Behavior**:
  - Add `version INTEGER NOT NULL DEFAULT 1` to `workflows`.
  - Add `is_active BOOLEAN NOT NULL DEFAULT true` to `task_statuses`.
  - Add `CREATE UNIQUE INDEX task_statuses_workflow_name_lower_idx ON task_statuses (workflow_id, LOWER(name));`.
  - Add Partial Unique Index: `workflows(workspace_id)` where `team_id IS NULL AND is_default = true AND is_active = true`.
  - Add Partial Unique Index: `workflows(workspace_id, team_id)` where `team_id IS NOT NULL AND is_default = true AND is_active = true`.
  - Add Partial Unique Index: `task_statuses(workflow_id)` where `is_initial = true AND is_active = true`.
  - **Preflight Verification**: Integration test runs preflight checks verifying:
    1. Zero duplicate `LOWER(name)` per workflow in `task_statuses`.
    2. At most one active workspace default in `workflows`.
    3. At most one active team default per `(workspace_id, team_id)` in `workflows`.
    4. At most one active initial status per workflow in `task_statuses`.
    If invariant violations are detected in preflight, the migration gate throws an error without altering or deleting operational records.
- **API/Runtime Behavior**: None.
- **Authorization**: N/A (Database layer).
- **Transaction Boundary**: Schema DDL executed within Drizzle migration transaction.
- **Concurrency Behavior**: Preflight queries and index creation run during migration setup.
- **UI Behavior**: None.
- **Tests to Add/Update**:
  - `database/test/workflow-migration.integration.test.ts`: Test migration application on clean DB and on pre-populated database with seeded workflows; test that partial unique constraints reject manual duplicate inserts.
- **Exact Focused Verification Commands**:
  - `pnpm --filter @floz/database test -- workflow-migration.integration.test.ts`
- **Expected Forward Commit Boundary/Message**:
  - `feat(database): add Phase 11 workflow configuration schema and migration (Task 1)`
- **Explicit Non-Goals**: No data rewriting or automatic reassignment of invalid existing records.
- **Rollback/Recovery Considerations**: Schema additions are purely additive with non-null defaults (`version=1`, `is_active=true`). Can rollback by dropping the added indexes and columns if needed.
- **Evidence Required at Checkpoint Review**: Clean migration output, journal record matching generated SQL, and passing integration test verifying partial unique indexes.

---

#### Task 2: Aggregate Concurrency & Locking Repository Primitives
- **Objective**: Implement reusable database transaction helpers for pessimistic hierarchical locking and aggregate version verification across workflow entities.
- **Exact Expected Files/Modules**:
  - `database/src/workflow-core.ts`
  - `database/src/index.ts`
  - `database/test/workflow-concurrency.integration.test.ts`
- **Database Behavior**:
  - Helper `lockWorkflowAggregateTx(sql, workspaceId, workflowId, expectedVersion)`:
    1. Locks workflow row `SELECT id, version, is_active, is_default, team_id FROM workflows WHERE id = :workflowId AND workspace_id = :workspaceId FOR UPDATE`.
    2. Throws `VERSION_CONFLICT` if `current.version !== expectedVersion`.
    3. Locks all statuses `SELECT id, is_initial, is_active, position FROM task_statuses WHERE workflow_id = :workflowId ORDER BY position ASC, id ASC FOR UPDATE`.
    4. Returns current aggregate state.
  - Helper `bumpWorkflowVersionTx(sql, workflowId, expectedVersion)`:
    Executes `UPDATE workflows SET version = version + 1, updated_at = NOW() WHERE id = :workflowId AND version = :expectedVersion`. Throws `VERSION_CONFLICT` if zero rows updated.
  - Helper `lockWorkspaceForWorkflowDefaultTx(sql, workspaceId)`:
    Executes `SELECT id FROM workspaces WHERE id = :workspaceId FOR UPDATE`.
- **API/Runtime Behavior**: Reusable in API service layer.
- **Authorization**: N/A (Database helper layer).
- **Transaction Boundary**: All locking helpers run inside caller's `sql.begin(async (tx) => ...)` transaction.
- **Concurrency Behavior**: Deterministic locking sequence prevents deadlocks (`workspaces` -> `workflows` sorted by ID -> `task_statuses`).
- **UI Behavior**: None.
- **Tests to Add/Update**:
  - `database/test/workflow-concurrency.integration.test.ts`: Test parallel transactions attempting to lock and bump versions, proving exact version increment and `VERSION_CONFLICT` rejection on stale versions.
- **Exact Focused Verification Commands**:
  - `pnpm --filter @floz/database test -- workflow-concurrency.integration.test.ts`
- **Expected Forward Commit Boundary/Message**:
  - `feat(database): add workflow aggregate locking and concurrency primitives (Task 2)`
- **Explicit Non-Goals**: HTTP routing or DTO validation.
- **Rollback/Recovery Considerations**: Helper module is isolated and consumed only by subsequent tasks.
- **Evidence Required at Checkpoint Review**: Concurrency test logs demonstrating lock serializability and version mismatch rejection.

**STOP CONDITION (Checkpoint A)**: Migration generated and applied clean on disposable DB; preflight safety tests pass; concurrency primitives pass serializability tests.

---

### Checkpoint B: Configuration API, Recurrence Guard & Concurrency Lifecycle

#### Task 3: Workflow CRUD & Atomic Creation
- **Objective**: Expose ADMIN-only workflow list, detail, metadata update, and atomic workflow creation endpoints.
- **Exact Expected Files/Modules**:
  - `apps/api/src/workflow.dto.ts`
  - `apps/api/src/workflow.service.ts`
  - `apps/api/src/floz.controller.ts`
  - `apps/api/src/app.module.ts`
  - `apps/api/test/workflow-api.test.ts`
- **Database Behavior**:
  - `POST /workflows` transaction:
    1. Validates unique `(workspace_id, code)` and `(workspace_id, name)`.
    2. Inserts `workflows` row (`is_active = true, is_default = false, version = 1`).
    3. Validates status set (exactly one `is_initial = true`, at least one terminal `DONE`/`CANCELLED`, unique codes `[A-Z0-9_]{2,32}`, unique lower names).
    4. Inserts `task_statuses` rows with contiguous positions `1..N`.
    5. Validates transitions (no self-loops `422 SELF_LOOP_NOT_ALLOWED`, transition codes map strictly to submitted status codes).
    6. Inserts `workflow_transitions` rows with `requires_permission = false`.
    7. Entire transaction rolls back on any error; zero partial rows created.
- **API/Runtime Behavior**:
  - `GET /api/v1/workspaces/:workspaceId/workflows`: Active member read access. Returns workflow list with statuses.
  - `GET /api/v1/workspaces/:workspaceId/workflows/:workflowId`: Detailed tree (statuses + transition matrix).
  - `POST /api/v1/workspaces/:workspaceId/workflows`: Creates workflow atomically. `is_default` cannot be passed in body.
  - `PATCH /api/v1/workspaces/:workspaceId/workflows/:workflowId`: Updates `name`, `description`. Rejects `code` and `is_default`. Requires `version`.
- **Authorization**: `ADMIN` role required for `POST` and `PATCH`. `MEMBER`/`MANAGER`/`FIELD_WORKER` have read access only.
- **Transaction Boundary**: `POST` and `PATCH` execute in isolated transactions with workflow lock.
- **Concurrency Behavior**: `PATCH` validates `version` before update and increments `version = version + 1`.
- **UI Behavior**: None.
- **Tests to Add/Update**:
  - `apps/api/test/workflow-api.test.ts`: Test atomic creation success; test creation rollback on invalid transition codes or missing initial status; test non-ADMIN receiving `403 FORBIDDEN`.
- **Exact Focused Verification Commands**:
  - `pnpm --filter @floz/api test -- workflow-api.test.ts`
- **Expected Forward Commit Boundary/Message**:
  - `feat(api): add workflow atomic creation, list, detail, and metadata endpoints (Task 3)`
- **Explicit Non-Goals**: Default switching (handled in Task 4).
- **Rollback/Recovery Considerations**: Standard NestJS controller and service additions.
- **Evidence Required at Checkpoint Review**: Passing API tests covering role authorization, atomic rollback, and code immutability.

---

#### Task 4: Workflow Default Switching & Recurrence-Safe Archival
- **Objective**: Implement explicit `set-default`, `archive`, and `restore` endpoints for workflows, enforcing recurrence template safety.
- **Exact Expected Files/Modules**:
  - `apps/api/src/workflow.service.ts`
  - `apps/api/src/floz.controller.ts`
  - `apps/api/src/error.filter.ts`
  - `apps/api/test/workflow-lifecycle.integration.test.ts`
- **Database Behavior**:
  - `POST /workflows/:workflowId/set-default`:
    1. Lock workspace `FOR UPDATE`.
    2. Identify target and previous default workflow in scope (`team_id IS NULL` for workspace default, `team_id = X` for team default).
    3. Validate expected `version` on target workflow. If target is already active default AND expected `version === target.version`, return target as deterministic 200 no-op (no version bump). If `version !== target.version`, throw `409 VERSION_CONFLICT`.
    4. Lock previous and target workflow rows in deterministic order `ORDER BY id ASC FOR UPDATE`.
    5. If previous default exists: unset `is_default = false` and bump `version = version + 1`.
    6. Set target `is_default = true` and bump `version = version + 1`.
    7. Commit.
  - `POST /workflows/:workflowId/archive`:
    1. Lock workflow `FOR UPDATE`, validate `version`.
    2. If workspace default (`team_id IS NULL AND is_default = true`), throw `409 CANNOT_ARCHIVE_DEFAULT_WORKFLOW`.
    3. **Recurrence Safety Guard**: Query `SELECT id FROM recurrence_rules WHERE workspace_id = :workspaceId AND is_active = true AND template_snapshot->>'workflow_id' = :workflowId`. If matches found, throw `409 RECURRENCE_DEPENDENCY_CONFLICT` with `{ error: { code: 'RECURRENCE_DEPENDENCY_CONFLICT', message: 'Active recurrence rules reference this workflow.', details: [{ rule_ids: [...] }] } }`.
    4. If team default (`team_id IS NOT NULL AND is_default = true`), set `is_default = false`.
    5. Set `is_active = false`, bump `version = version + 1`.
  - `POST /workflows/:workflowId/restore`:
    1. Lock workflow `FOR UPDATE`, validate `version`.
    2. Set `is_active = true, is_default = false`, bump `version = version + 1`.
- **API/Runtime Behavior**:
  - Endpoints accept `{ version: number }`. Return updated workflow with new version.
- **Authorization**: ADMIN only (`403 FORBIDDEN` for non-ADMIN).
- **Transaction Boundary**: Each lifecycle operation runs in a single transaction with deterministic locking.
- **Concurrency Behavior**: Bumps versions on both previous and target default workflows during `set-default`.
- **UI Behavior**: None.
- **Tests to Add/Update**:
  - `apps/api/test/workflow-lifecycle.integration.test.ts`: Test `set-default` increments versions on both workflows; test archiving team default unsets `is_default`; test restoring does not reclaim default; test active recurrence rule blocks workflow archival (`409 RECURRENCE_DEPENDENCY_CONFLICT`); test workspace default cannot be archived (`409 CANNOT_ARCHIVE_DEFAULT_WORKFLOW`).
- **Exact Focused Verification Commands**:
  - `pnpm --filter @floz/api test -- workflow-lifecycle.integration.test.ts`
- **Expected Forward Commit Boundary/Message**:
  - `feat(api): implement workflow set-default, archive, restore, and recurrence dependency guards (Task 4)`
- **Explicit Non-Goals**: Status-level manipulation.
- **Rollback/Recovery Considerations**: Standard transactional service updates.
- **Evidence Required at Checkpoint Review**: Integration test proving two-workflow version bumps, recurrence block, and team default fallback.

---

#### Task 5: Status Lifecycle, Compacting Reorder & Dormant Transition Preservation
- **Objective**: Implement status create, update, `set-initial`, archive, restore, reorder, and bulk transition replacement with dormant edge preservation and recurrence guards.
- **Exact Expected Files/Modules**:
  - `apps/api/src/workflow.service.ts`
  - `apps/api/src/floz.controller.ts`
  - `apps/api/test/workflow-status.integration.test.ts`
- **Database Behavior**:
  - `POST /statuses`: Add status at `position = activeCount + 1`, derive `is_terminal` from `category`, bump `workflow.version`.
  - `PATCH /statuses/:statusId`: Update `name` or `category`. If `category` changes: query active tasks (`SELECT COUNT(*) FROM tasks WHERE status_id = :id AND deleted_at IS NULL`) and active recurrence rules (`SELECT COUNT(*) FROM recurrence_rules WHERE workspace_id = :workspaceId AND is_active = true AND template_snapshot->>'status_id' = :id`). If count > 0, throw `409 STATUS_CATEGORY_IN_USE`. Derive new `is_terminal`, bump `workflow.version`.
  - `POST /statuses/:statusId/set-initial`: Validate `version`. If already initial and version matches, return no-op. Unset previous `is_initial = false`, set target `is_initial = true`, bump `workflow.version`.
  - `POST /statuses/:statusId/archive`:
    1. Validate `version`. If `is_initial = true`, throw `409 CANNOT_ARCHIVE_INITIAL_STATUS`.
    2. **Recurrence Safety Guard**: Check active recurrence rules referencing `template_snapshot->>'status_id' = :statusId`. If found, throw `409 RECURRENCE_DEPENDENCY_CONFLICT`.
    3. Set target status `is_active = false, position = 9999`.
    4. **Position Compaction**: Query remaining active statuses in workflow `ORDER BY position ASC, id ASC`, update their positions to contiguous `1..N`.
    5. Retain all incoming/outgoing `workflow_transitions` rows in database.
    6. Bump `workflow.version = version + 1`.
  - `POST /statuses/:statusId/restore`:
    Set `is_active = true, position = activeCount + 1`, bump `workflow.version = version + 1`. Retained dormant incoming transitions become active.
  - `PUT /statuses/reorder`:
    Validate `status_ids` contains exactly all active status IDs for workflow. Update positions to `1..N`, bump `workflow.version`.
  - `PUT /transitions`:
    1. Lock workflow and statuses `FOR UPDATE`, validate `version`.
    2. Validate no self-loops (`422 SELF_LOOP_NOT_ALLOWED`) and no edges to inactive targets (`422 INACTIVE_TRANSITION_TARGET`).
    3. Query existing transitions. Extract dormant incoming edges where `to_status.is_active = false`.
    4. Delete only existing active-target edges (`to_status.is_active = true`). Retain dormant incoming edges.
    5. Insert/retain submitted active-target edges, preserving `requires_permission` on retained edges and defaulting `requires_permission = false` on newly added edges.
    6. Bump `workflow.version = version + 1`.
- **API/Runtime Behavior**:
  - Expose status management endpoints under `/api/v1/workspaces/:workspaceId/workflows/:workflowId/...`.
- **Authorization**: ADMIN only for all mutations.
- **Transaction Boundary**: Single transaction per operation under workflow aggregate lock.
- **Concurrency Behavior**: Every status/transition mutation validates expected version and increments `workflow.version`.
- **UI Behavior**: None.
- **Tests to Add/Update**:
  - `apps/api/test/workflow-status.integration.test.ts`: Test position compaction on status archive; test status restore assigns position `N+1`; test category change blocked when tasks or recurrence rules exist (`409 STATUS_CATEGORY_IN_USE`); test transition replacement preserves dormant incoming edges to archived targets; test initial status archive is rejected (`409 CANNOT_ARCHIVE_INITIAL_STATUS`).
- **Exact Focused Verification Commands**:
  - `pnpm --filter @floz/api test -- workflow-status.integration.test.ts`
- **Expected Forward Commit Boundary/Message**:
  - `feat(api): add status lifecycle, compaction reordering, and transition preservation (Task 5)`
- **Explicit Non-Goals**: Task creation or execution modification.
- **Rollback/Recovery Considerations**: Standard isolated service additions.
- **Evidence Required at Checkpoint Review**: Integration test output confirming position compaction, dormant edge retention, and category lock.

**STOP CONDITION (Checkpoint B)**: All workflow and status lifecycle APIs implemented, protected by ADMIN authorization, recurrence guards, and optimistic concurrency versioning.

---

### Checkpoint C: Task Runtime, Default Resolution & Recurrence Compatibility

#### Task 6: Task Creation Dynamic Default Resolution & Team Scope Enforcement
- **Objective**: Update task creation logic to dynamically resolve team defaults and workspace defaults, rejecting cross-team workflows.
- **Exact Expected Files/Modules**:
  - `database/src/task-core.ts`
  - `apps/api/src/task.service.ts`
  - `database/test/task-workflow-resolution.integration.test.ts`
- **Database Behavior**:
  - Update `validateTaskTemplateReferences`:
    1. If `input.workflow_id` is omitted:
       - If `input.team_id` is provided, look for active team default: `SELECT id, (SELECT id FROM task_statuses WHERE workflow_id = w.id AND is_initial = true AND is_active = true LIMIT 1) as status_id FROM workflows w WHERE workspace_id = :workspaceId AND team_id = :teamId AND is_default = true AND is_active = true LIMIT 1`.
       - If no team default found (or `input.team_id` is null): look for active workspace default: `SELECT id, (SELECT id FROM task_statuses WHERE workflow_id = w.id AND is_initial = true AND is_active = true LIMIT 1) as status_id FROM workflows w WHERE workspace_id = :workspaceId AND team_id IS NULL AND is_default = true AND is_active = true LIMIT 1`.
    2. If `input.workflow_id` is provided:
       - Query workflow: `SELECT id, team_id, is_active FROM workflows WHERE id = :workflowId AND workspace_id = :workspaceId`.
       - If `!workflow || !workflow.is_active`, throw `WORKFLOW_SCOPE_MISMATCH`.
       - If `workflow.team_id != null && workflow.team_id !== input.team_id`, throw `WORKFLOW_SCOPE_MISMATCH`.
    3. If `input.status_id` is provided:
       - Validate status belongs to resolved workflow and `is_active = true`. Throw `STATUS_SCOPE_MISMATCH` if missing or inactive.
    4. Return resolved `{ workflow_id, status_id }`.
- **API/Runtime Behavior**: Task creation endpoint automatically maps tasks to the resolved workflow and active initial status.
- **Authorization**: Standard active member task creation authorization.
- **Transaction Boundary**: Runs inside `createTaskRecordTx` transaction.
- **Concurrency Behavior**: Read queries executed within creation transaction.
- **UI Behavior**: None.
- **Tests to Add/Update**:
  - `database/test/task-workflow-resolution.integration.test.ts`:
    - Task with `team_id = X` and team default -> resolves team default workflow.
    - Task with `team_id = Y` (no team default) -> resolves workspace default workflow.
    - Task with `team_id = null` -> resolves workspace default workflow.
    - Explicit cross-team workflow assignment -> throws `422 WORKFLOW_SCOPE_MISMATCH`.
    - Explicit archived workflow assignment -> throws `422 WORKFLOW_SCOPE_MISMATCH`.
- **Exact Focused Verification Commands**:
  - `pnpm --filter @floz/database test -- task-workflow-resolution.integration.test.ts`
- **Expected Forward Commit Boundary/Message**:
  - `feat(task): implement dynamic workflow default resolution and team scoping (Task 6)`
- **Explicit Non-Goals**: Modifying existing task rows.
- **Rollback/Recovery Considerations**: Default resolution strictly falls back to workspace default if team default is absent.
- **Evidence Required at Checkpoint Review**: Integration test logs demonstrating team and workspace fallback resolution.

---

#### Task 7: Task Runtime Transition Enforcement & Archived Status Escape
- **Objective**: Ensure task transition execution permits escaping from archived statuses while rejecting transitions into inactive target statuses with `422 INVALID_TRANSITION`.
- **Exact Expected Files/Modules**:
  - `apps/api/src/task.service.ts`
  - `apps/api/test/task-transition-archival.integration.test.ts`
- **Database Behavior**:
  - Update `availableTransitions(workspaceId, taskId)` query in `task.service.ts`:
    - `SELECT wt.to_status_id, s.code, s.name FROM tasks t JOIN workflow_transitions wt ON wt.workflow_id = t.workflow_id AND wt.from_status_id = t.status_id JOIN task_statuses s ON s.id = wt.to_status_id WHERE t.workspace_id = ${workspaceId} AND t.id = ${id} AND t.deleted_at IS NULL AND s.is_active = true`. (Source status can be active or archived; target status MUST have `s.is_active = true`).
  - Update `transition(workspaceId, actorId, role, id, input)` in `task.service.ts`:
    - Ensure target status check `JOIN task_statuses s ON s.id = wt.to_status_id WHERE ... AND s.is_active = true`.
    - If unconfigured transition OR target is inactive, throws canonical `BadRequestException('INVALID_TRANSITION')` (mapped to HTTP `422 INVALID_TRANSITION` by `error.filter.ts`).
  - Completion & History invariants:
    - If `target.category === 'DONE'`, sets `completed_at = NOW()` and logs `COMPLETED`.
    - If `task.category === 'DONE' && target.category !== 'DONE'`, sets `completed_at = NULL` and logs `REOPENED`.
    - Otherwise logs `STATUS_CHANGED`.
- **API/Runtime Behavior**: Canonical `POST /api/v1/workspaces/:workspaceId/tasks/:id/transition` remains unchanged in route and contract.
- **Authorization**: Standard task mutation authorization.
- **Transaction Boundary**: Task transition runs inside row-locked transaction (`SELECT ... FROM tasks FOR UPDATE`).
- **Concurrency Behavior**: Version check `task.version !== input.version` throws `409 VERSION_CONFLICT`.
- **UI Behavior**: None.
- **Tests to Add/Update**:
  - `apps/api/test/task-transition-archival.integration.test.ts`: Test task in archived status can escape to an active target status; test transition into archived target status returns `422 INVALID_TRANSITION`; test reopening from `DONE` clears `completed_at`.
- **Exact Focused Verification Commands**:
  - `pnpm --filter @floz/api test -- task-transition-archival.integration.test.ts`
- **Expected Forward Commit Boundary/Message**:
  - `feat(task): enforce active target transitions and archived status escape (Task 7)`
- **Explicit Non-Goals**: Creating new status endpoints.
- **Rollback/Recovery Considerations**: Transition query additions are strictly scoped to checking `s.is_active = true`.
- **Evidence Required at Checkpoint Review**: Integration test proving archived status escape and inactive target rejection.

---

#### Task 8: Read Projections, Kanban Compatibility & Recurrence Guard Alignment
- **Objective**: Update read projections across Kanban, Task List, Calendar, My Work, and Dashboards so archived status references remain visible, while preventing recurrence breakage.
- **Exact Expected Files/Modules**:
  - `apps/api/src/task.service.ts`
  - `database/src/dashboard.ts`
  - `database/src/my-work.ts`
  - `apps/api/src/recurrence.service.ts`
  - `apps/api/test/kanban-archived-status.integration.test.ts`
- **Database Behavior**:
  - `task.service.ts` `kanban`:
    - Query active statuses (`WHERE workflow_id = :id AND is_active = true AND category <> 'CANCELLED' ORDER BY position ASC, id ASC`).
    - Query tasks. If any task row has `status.is_active = false`, append a synthetic column for that archived status to the right of the board.
    - Column payload includes `status: { id, code, name, category, is_active }`.
  - Dashboard and My Work queries:
    - Retain existing filter logic (`task_statuses.is_terminal = false AND task_statuses.category <> 'CANCELLED'`).
  - Recurrence template validation:
    - `recurrence.service.ts` `validateTaskTemplateReferences` verifies that template workflow and status are active.
- **API/Runtime Behavior**: Kanban response returns active columns plus dynamic occupied archived columns.
- **Authorization**: Standard workspace member read access.
- **Transaction Boundary**: Read-only queries.
- **Concurrency Behavior**: Standard read queries.
- **UI Behavior**: None.
- **Tests to Add/Update**:
  - `apps/api/test/kanban-archived-status.integration.test.ts`: Verify Kanban returns archived column when tasks occupy it, and omits archived column when empty.
- **Exact Focused Verification Commands**:
  - `pnpm --filter @floz/api test -- kanban-archived-status.integration.test.ts`
- **Expected Forward Commit Boundary/Message**:
  - `feat(task): align read projections and kanban columns with archived status states (Task 8)`
- **Explicit Non-Goals**: Modifying KPI formulas.
- **Rollback/Recovery Considerations**: Pure read projection adjustments.
- **Evidence Required at Checkpoint Review**: Test output proving dynamic Kanban column projection for archived statuses.

**STOP CONDITION (Checkpoint C)**: Task creation resolves defaults cleanly; task transitions permit archived status escape; Kanban projections show occupied archived columns; recurrence templates are safe.

---

### Checkpoint D: Web Workflow Settings UI

#### Task 9: Workflow Master List, Selector & Metadata Editor
- **Objective**: Implement the `/workspaces/:workspaceId/settings/workflows` route with workflow selection, default badges, creation modal, metadata editor, and conflict toast handling.
- **Exact Expected Files/Modules**:
  - `apps/web/app/workspaces/[workspaceId]/settings/workflows/page.tsx`
  - `apps/web/components/workflow-create-dialog.tsx`
  - `apps/web/components/workflow-metadata-card.tsx`
  - `apps/web/lib/api-client.ts`
  - `apps/web/test/workflow-settings.test.tsx`
- **Database Behavior**: Consumes Task 3 & 4 APIs.
- **API/Runtime Behavior**: Calls `GET /workflows`, `POST /workflows`, `PATCH /workflows/:id`, `POST /workflows/:id/set-default`, `POST /workflows/:id/archive`, `POST /workflows/:id/restore`.
- **Authorization**: UI displayed for ADMIN users. Displays forbidden banner or redirects non-ADMIN.
- **Transaction Boundary**: N/A (Web UI).
- **Concurrency Behavior**: On `409 VERSION_CONFLICT`, displays warning toast with "Reload Workflow" button.
- **UI Behavior**:
  - Header: Workflow switcher tabs/dropdown with `Default` badge, `Team: [Name]` badge, and `Create Workflow` button.
  - Metadata Card: Edit name, description, "Set as Default" button, "Archive Workflow" button (disabled with tooltip for workspace default).
- **Tests to Add/Update**:
  - `apps/web/test/workflow-settings.test.tsx`: Test rendering workflow switcher, triggering creation dialog, and handling `VERSION_CONFLICT` toast.
- **Exact Focused Verification Commands**:
  - `pnpm --filter @floz/web test -- workflow-settings.test.tsx`
- **Expected Forward Commit Boundary/Message**:
  - `feat(web): add workflow settings navigation, creation modal, and metadata editor (Task 9)`
- **Explicit Non-Goals**: Status cards and transition matrix (Tasks 10 & 11).
- **Rollback/Recovery Considerations**: Isolated page under settings route.
- **Evidence Required at Checkpoint Review**: Passing Web component tests for workflow switcher and metadata actions.

---

#### Task 10: Status List Editor & Accessible Keyboard Reordering
- **Objective**: Implement the status management section with status cards, category dropdown, initial/terminal badges, drag handles, accessible keyboard Move Up/Down buttons, and archive modals.
- **Exact Expected Files/Modules**:
  - `apps/web/components/workflow-status-list.tsx`
  - `apps/web/components/workflow-status-card.tsx`
  - `apps/web/components/workflow-status-dialog.tsx`
  - `apps/web/test/workflow-status-list.test.tsx`
- **Database Behavior**: Consumes Task 4 & 5 APIs.
- **API/Runtime Behavior**: Calls `POST /statuses`, `PATCH /statuses/:id`, `POST /statuses/:id/set-initial`, `PUT /statuses/reorder`, `POST /statuses/:id/archive`, `POST /statuses/:id/restore`.
- **Authorization**: ADMIN only.
- **Transaction Boundary**: N/A (Web UI).
- **Concurrency Behavior**: Sends current `workflow.version` on every mutation; handles `409 VERSION_CONFLICT`.
- **UI Behavior**:
  - Status Cards: Displays Name, Code, Category badge, Initial badge, Terminal badge.
  - Reordering: Mouse drag-handle and accessible keyboard buttons (`Move Up`, `Move Down`) emitting `PUT /statuses/reorder`.
  - Category Mutation: If server returns `409 STATUS_CATEGORY_IN_USE`, displays modal alert explaining that tasks or recurrence rules currently reference the status.
  - Archive Status: Displays confirmation dialog warning if active tasks occupy the status.
- **Tests to Add/Update**:
  - `apps/web/test/workflow-status-list.test.tsx`: Test keyboard Move Up / Move Down buttons; test "Set as Initial" action; test category in-use error display.
- **Exact Focused Verification Commands**:
  - `pnpm --filter @floz/web test -- workflow-status-list.test.tsx`
- **Expected Forward Commit Boundary/Message**:
  - `feat(web): add status editor with accessible keyboard reordering and category safety (Task 10)`
- **Explicit Non-Goals**: Transition matrix (Task 11).
- **Rollback/Recovery Considerations**: Modular components.
- **Evidence Required at Checkpoint Review**: Passing Web component tests for keyboard reordering and status actions.

---

#### Task 11: Transition Matrix & Responsive Mobile Accordion
- **Objective**: Implement the transition configuration surface with a desktop matrix grid, mobile accordion toggle list, and dormant archived-target edge protection.
- **Exact Expected Files/Modules**:
  - `apps/web/components/workflow-transition-matrix.tsx`
  - `apps/web/components/workflow-transition-mobile-list.tsx`
  - `apps/web/test/workflow-transition-matrix.test.tsx`
- **Database Behavior**: Consumes Task 5 `PUT /transitions` API.
- **API/Runtime Behavior**: Fetches transitions and submits active edge replacement payload `{ version, transitions }`.
- **Authorization**: ADMIN only.
- **Transaction Boundary**: N/A (Web UI).
- **Concurrency Behavior**: Submits `workflow.version`; displays conflict toast on `409 VERSION_CONFLICT`.
- **UI Behavior**:
  - **Desktop (>=768px)**: Matrix table. Rows = "From Status", Columns = "To Status". Checkbox at each intersection. Disabled diagonal (`from === to`). Archived targets rendered with disabled checkboxes and visual "(Archived)" badge.
  - **Mobile (<768px)**: Accordion list grouped by "From Status". Expanding reveals toggle switches for each active target status.
  - **Dormant Edge Safety**: Serializer submits only active-target edges; UI informs user that dormant edges to archived targets are preserved automatically.
- **Tests to Add/Update**:
  - `apps/web/test/workflow-transition-matrix.test.tsx`: Test matrix checkbox toggles; test mobile accordion toggle rendering; test disabled self-loop diagonal.
- **Exact Focused Verification Commands**:
  - `pnpm --filter @floz/web test -- workflow-transition-matrix.test.tsx`
- **Expected Forward Commit Boundary/Message**:
  - `feat(web): add responsive workflow transition matrix and mobile accordion editor (Task 11)`
- **Explicit Non-Goals**: Role permission editing on transitions (deferred).
- **Rollback/Recovery Considerations**: Modular component.
- **Evidence Required at Checkpoint Review**: Web component tests confirming matrix and mobile toggle functionality.

**STOP CONDITION (Checkpoint D)**: Web workflow settings fully functional, responsive, keyboard-accessible, and handling concurrency conflicts smoothly.

---

### Checkpoint E: Real-Stack Playwright E2E Validation

#### Task 12: Real-Stack Phase 11 Playwright E2E Scenarios & Regression Suite
- **Objective**: Prove the complete workflow configuration lifecycle, task progression, default resolution, archived status escape, and concurrent conflict handling in a real browser against a production stack.
- **Exact Expected Files/Modules**:
  - `apps/web/e2e/flow.spec.ts`
  - `scripts/test-e2e.ps1`
- **Database Behavior**: Real PostgreSQL database exercised through HTTP API and Next.js frontend.
- **API/Runtime Behavior**: Exercises full end-to-end stack.
- **Authorization**: Admin and Member sessions authenticated via Better Auth cookies.
- **Transaction Boundary**: Real database transactions.
- **Concurrency Behavior**: Exercises real concurrent browser session conflicts.
- **UI Behavior**:
  - **Scenario A (Custom Workflow Lifecycle)**: Admin creates custom workflow with 4 statuses (`TRIAGE`, `DEV`, `QA`, `PROD`), configures transition matrix -> User creates task -> Moves task from `TRIAGE` -> `DEV` -> `QA` -> `PROD`.
  - **Scenario B (Team Default Resolution & Fallback)**:
    - Team Alpha with configured team default workflow -> task created for Team Alpha automatically resolves to Team Alpha default workflow.
    - Team Beta without team default workflow -> task created for Team Beta automatically resolves to Workspace default workflow.
  - **Scenario C (Archived Status Escape Interaction)**:
    - Task exists in status `QA`.
    - Admin archives status `QA`.
    - User visits Kanban board: sees dynamically appended "Archived: QA" column with the task card.
    - Column drop is disabled.
    - User uses the card's escape transition dropdown to move the card to `PROD`.
    - Once empty, the "Archived: QA" column disappears on reload.
  - **Scenario D (Concurrent Admin Modification Conflict)**:
    - Admin session 1 and Admin session 2 open the same workflow editor.
    - Admin session 1 reorders statuses and saves (version bumps).
    - Admin session 2 toggles a transition and saves -> receives `VERSION_CONFLICT` toast -> clicks "Reload" -> sees updated order and current matrix.
  - **Phase 0–10 Regression**: Executes all 19 pre-existing Playwright flows.
- **Tests to Add/Update**:
  - Extend `apps/web/e2e/flow.spec.ts` with Phase 11 scenarios.
- **Exact Focused Verification Commands**:
  - `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-e2e.ps1`
- **Expected Forward Commit Boundary/Message**:
  - `test(e2e): add Phase 11 real-stack workflow configuration and regression suite (Task 12)`
- **Explicit Non-Goals**: Modifying existing Phase 0–10 E2E assertions.
- **Rollback/Recovery Considerations**: E2E harness creates and destroys isolated test workspaces.
- **Evidence Required at Checkpoint Review**: Playwright test report showing all Phase 11 scenarios and all 19 Phase 0–10 regression flows passing with 0 failures.

**STOP CONDITION (Checkpoint E)**: Real-stack E2E tests pass 100% across Phase 11 flows and Phase 0–10 regression flows.

---

### Checkpoint F: Final Verification, Documentation & Closure

#### Task 13: Canonical Multi-Gate Verification Sequence
- **Objective**: Execute the strict 8-gate verification sequence in exact order to prove repository stability before acceptance.
- **Exact Expected Files/Modules**: Verification logs across packages.
- **Verification Gates (Exact Order)**:
  1. `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-clean-db.ps1` (Clean DB migration & seeds)
  2. `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-e2e.ps1` (Playwright E2E suite)
  3. `pnpm --filter @floz/worker test:integration` (Worker regression gate; worker runtime unchanged in Phase 11)
  4. `pnpm lint` (0 errors across workspace)
  5. `pnpm typecheck` (0 errors across workspace)
  6. `pnpm test` (Root Run #1 — all packages passing)
  7. `pnpm build` (Production build of all 10 packages)
  8. `pnpm test` (Root Run #2 — independent pass)
  - Hygiene Check: `git diff --check` and `git status --short`.
  - **Restart Rule**: Any executable or configuration fix required during gates invalidates earlier runs and requires restarting from Gate 1.
- **Tests to Add/Update**: None.
- **Exact Focused Verification Commands**: Gates 1 through 8 listed above.
- **Expected Forward Commit Boundary/Message**: N/A (Gate execution).
- **Explicit Non-Goals**: Modifying code without gate restart.
- **Evidence Required at Checkpoint Review**: Gate log outputs with exit code 0, executed/passed/failed counts, package breakdowns for root tests, and clean hygiene check.

---

#### Task 14: Documentation Synchronization & External Inspection Matrix
- **Objective**: Update internal phase documentation and reconcile external canonical documents outside the Git repository.
- **Exact Expected Files/Modules**:
  - `docs/implementation/PHASE_11_REPORT.md` (Created)
  - `docs/implementation/IMPLEMENTATION_STATUS.md` (Updated)
  - `docs/implementation/CURRENT_HANDOFF.md` (Updated)
  - `docs/decisions/OPEN_DECISIONS.md` (Updated)
- **External Documentation Inspection (Under `D:\Portofolio\Floz\Documentation`)**:
  - `Technical/Floz_API_Specification.md`: UPDATE REQUIRED (document `/workflows` CRUD, `set-default`, `set-initial`, `reorder`, `transitions`, `422 INACTIVE_TRANSITION_TARGET`, `409 STATUS_CATEGORY_IN_USE`).
  - `Technical/Floz_ERD_Database_Design.md`: UPDATE REQUIRED (document migration `0008` schema fields, versioning, and partial unique indexes).
  - `Technical/Floz_Technical_Design_Architecture.md`: UPDATE REQUIRED (document workflow aggregate locking and dormant transition retention).
  - `Design/Floz_Wireframe_UI_Specification.md`: UPDATE REQUIRED (document Workflow Settings page, matrix grid, and mobile accordion).
  - `Technical/Floz_Technical_Design_Architecture_Free_Bootstrap.md`: INSPECTED — NO UPDATE REQUIRED.
  - `Product/Floz_PRD_Product_Requirements_Document.md`: INSPECTED — NO UPDATE REQUIRED.
  - `Product/Floz_Feature_Spec_Backlog.md`: INSPECTED — NO UPDATE REQUIRED.
  - `Product/Floz_Product_Documentation.md`: INSPECTED — NO UPDATE REQUIRED.
  - `Product/Floz_User_Stories.md`: INSPECTED — NO UPDATE REQUIRED.
  - `Product/Floz_User_Flow_Use_Case.md`: INSPECTED — NO UPDATE REQUIRED.
  - `Product/Floz_Product_Brief_Idea_Brief.md`: INSPECTED — NO UPDATE REQUIRED.
  - *Note*: External documents are NOT initialized in Git and NOT copied into the app repository.
- **Tests to Add/Update**: None.
- **Exact Focused Verification Commands**:
  - `git diff --check`
  - `git status --short`
- **Expected Forward Commit Boundary/Message**:
  - `docs: finalize phase 11 report, implementation status, and handoff (Task 14)`
- **Explicit Non-Goals**: Modifying external documentation Git status.
- **Rollback/Recovery Considerations**: Documentation-only commit.
- **Evidence Required at Checkpoint Review**: Complete Phase 11 Final Report, clean Git status, and external document inspection matrix.

**STOP CONDITION (Checkpoint F)**: Checkpoint F reached. Implementation stopped awaiting explicit human final acceptance before publication.
