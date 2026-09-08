# Phase 11: Workflow Configuration Design

**Status**: DRAFT DESIGN / AWAITING APPROVAL

## 1. Current State Reconstructed
Phase 10 is complete and accepted (master HEAD: `0cc52c0`). The Floz core platform supports multiple entities (Tasks, Kanban, Calendar, Recurrences, Dashboards, and Approvals) that heavily depend on task workflows.

Currently:
- **Workflows (`workflows`)**: Schema supports multiple workflows per workspace (`is_default`, `is_active`). Tasks are explicitly tied to a `workflow_id`.
- **Statuses (`task_statuses`)**: Scoped to a workflow, ordered by `position`, with explicit boolean flags for `is_initial` and `is_terminal`. They also map to a hardcoded reporting `category` (`TODO`, `IN_PROGRESS`, `DONE`, `CANCELLED`).
- **Transitions (`workflow_transitions`)**: Define a strict directed graph (`from_status_id` to `to_status_id`).
- **Enforcement**: Task transitions are strictly validated server-side by checking the `workflow_transitions` graph. Foreign keys (`tasks.status_id`, `task_history.from_status_id`, `task_history.to_status_id`) restrict hard deletion of active statuses.
- **Bootstrapping**: Workflows are currently seeded statically. There is no API or UI to modify them.

## 2. Problem / Goal
Floz needs to move away from rigid, hardcoded workflows to allow workspace administrators to define custom task lifecycles (workflows, statuses, and transitions) that fit their specific organizational processes, without breaking existing tasks, historical audits, recurring templates, or dashboard KPIs.

## 3. Proposed Phase 11 Scope

### P0 Scope (MVP)
- **Workflow Management**: CRUD operations for workspace workflows. Ability to set the default workflow.
- **Status Management**: Add, update, and reorder statuses within a workflow. Assign explicit metadata (`is_initial`, `is_terminal`, `category`).
- **Transition Management**: Matrix/graph configuration allowing admins to define valid status-to-status transitions.
- **Archival Semantics**: Soft-delete/archival for workflows and statuses to protect historical data and foreign keys.
- **Web UI**: A visual "Workflow Settings" page under Workspace Settings to manage workflows, statuses, and transitions.

### Deferred Scope
- Transition-level permission rules (e.g., "Only managers can move to QA").
- Automated transition triggers (e.g., "Move to Review when Approval is requested").
- Conditional transitions (e.g., "Cannot close if subtasks are open").
- Cross-workspace workflow templates or global workflow registry.

### Explicit Non-Goals
- Modifying the existing historical `task_history` records.
- Providing a complex drag-and-drop canvas workflow editor (a matrix or list-based UI is safer and more accessible for MVP).

## 4. Required Design Decisions

**A. One workflow per workspace vs multiple workflows**
- *Decision*: **Multiple workflows per workspace**.
- *Rationale*: Different teams (e.g., Engineering vs HR) need different lifecycles. Schema already supports it. One workflow must be enforced as `is_default = true`.

**B. Workflow assignment (by workspace, team, or task)**
- *Decision*: **By individual task**.
- *Rationale*: Preserves current schema where `tasks.workflow_id` is set at creation.

**C. Status name uniqueness**
- *Decision*: **Unique `code` per workflow**. Names can be duplicated, but `code` must be unique within a workflow to ensure predictable API integrations and UI keys.

**D. Status archival rules**
- *Decision*: **Soft-delete/Archive via `is_active` flag**.
- *Rationale*: Hard-deleting a status referenced by `tasks` or `task_history` violates PostgreSQL foreign key constraints. We must add `is_active BOOLEAN DEFAULT true` to `task_statuses`.

**E. Workflow archival rules**
- *Decision*: **Use existing `workflows.is_active`**. Archived workflows cannot be assigned to new tasks.

**F. Tasks referencing archived statuses**
- *Decision*: **Allowed to transition out, but not in**. Existing tasks in an archived status remain valid and visible in Kanban/Dashboards. They can transition OUT based on the transition graph, but no task can transition INTO an archived status.

**G. Transitions referencing archived statuses**
- *Decision*: **Transitions INTO archived statuses are ignored/disabled**. Transitions FROM archived statuses remain valid to allow tasks to escape.

**H. Initial status mandatory?**
- *Decision*: **Yes**. Exactly one status per workflow must have `is_initial = true`.

**I. Terminal statuses as explicit metadata**
- *Decision*: **Yes**. `is_terminal = true` remains explicitly configured. This is required for KPI reporting, Dashboard active metrics, and Recurrence generation limits.

**J. Status reordering**
- *Decision*: **Yes**. Statuses are sorted by `position`. The API will support a reorder endpoint.

**K. Transition graph constraints**
- *Decision*: **Prevent self-loops at API level**. Unreachable statuses and cycles are permitted (to allow flexible back-and-forth flows).

**L. Migrating default workflow**
- *Decision*: Existing seeded workflows become fully editable by Workspace Admins. No special "locked" default workflow.

**M. Concurrency configuration mutation**
- *Decision*: **Optimistic locking via `version`**. Workflows will get a `version` integer to prevent lost updates during concurrent edits.

**N. Stale Task UI behavior**
- *Decision*: If a user tries to move a Kanban card using a transition that an Admin just removed, the API will return `400 INVALID_TRANSITION` (already implemented). The UI will catch the error and reload the board.

## 5. Database Design Proposal

Only minor schema additions are required to support safe configuration.

1. **`workflows` table:**
   - Add `version: integer('version').notNull().default(1)`
   - *Purpose*: Optimistic concurrency control for workflow updates.

2. **`task_statuses` table:**
   - Add `isActive: boolean('is_active').notNull().default(true)`
   - *Purpose*: Archival semantics. Protects historical FK references while hiding the status from new transitions.

*Migration Impact*: Safe. No data loss. Existing rows get default values.

## 6. Authorization & Read Policy

- **View Workflows/Statuses**: Any `ACTIVE` workspace member can view workflows (required for Kanban, Task creation).
- **Manage Workflows/Statuses**: Strictly `ADMIN` only for Phase 11.
- *Rationale*: Workflow mutation affects workspace-wide reporting, Kanban columns, and task states. `MANAGER` role handles day-to-day operations, not schema configuration.

## 7. API Design Proposal

**Endpoints (Prefix: `/api/v1/workspaces/:workspaceId/workflows`)**

- `GET /` : List all active workflows (already exists, extend to include archived if queried by ADMIN).
- `POST /` : Create a new workflow (requires initial statuses and transitions).
- `GET /:workflowId` : Get full workflow tree (statuses + transitions).
- `PATCH /:workflowId` : Update workflow metadata (name, description, `is_default`, `is_active`, `version`).
- `POST /:workflowId/statuses` : Add a new status.
- `PATCH /:workflowId/statuses/:statusId` : Update status (name, category, `is_terminal`, `is_active`).
- `PUT /:workflowId/statuses/reorder` : Bulk update `position` fields.
- `PUT /:workflowId/transitions` : Bulk replace the transition matrix for a workflow.

**Validation & Invariants:**
- `409 VERSION_CONFLICT`: Concurrent modification of workflow.
- `422 VALIDATION_ERROR`: Exactly one `is_initial` status required per workflow.
- `400 STATUS_IN_USE`: Attempt to deactivate the only `is_initial` status.
- `403 FORBIDDEN`: Non-ADMIN attempting mutation.

## 8. Web UX Proposal

**Route**: `/workspaces/:workspaceId/settings/workflows` (Admin Only)

**Layout**:
- **Workflow List**: Master-detail or list view of workflows. Highlights `is_default`.
- **Workflow Editor**:
  - **Statuses Tab**: A list of statuses. Drag-and-drop to reorder (`position`). Inline edit for Name, Category (dropdown), Terminal/Initial toggles. Archive action.
  - **Transitions Tab**: A matrix (grid) view. Rows = "From Status", Columns = "To Status". Checkboxes at intersections to enable/disable transitions. This is significantly easier to build and use affordably than a node-and-wire visual graph editor.

**Conflict Handling**:
- Standard Toast notification for `VERSION_CONFLICT` with a refresh action.

## 9. Testing & Migration Strategy

- **Database Integration Tests**: Verify that `task_history` prevents hard deletion of `task_statuses`. Verify exactly-one `is_default` partial unique constraint logic if applied, or service-level enforcement.
- **API Tests**: Verify ADMIN-only mutation authorization. Verify cycle creation (allowed) and self-loop creation (rejected).
- **Web Tests**: Component tests for the Transition Matrix checkbox interactions.
- **Regression**: The existing Phase 0-10 E2E suite (`scripts/test-e2e.ps1`) must pass unmodified, proving that dynamic workflow configuration does not break canonical task transition invariants.

**Deployment Safety**:
The schema changes (adding `version` and `is_active`) are non-destructive and backward compatible. The application logic gracefully falls back. No downtime required.