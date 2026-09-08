# Phase 11: Workflow Configuration Implementation Plan

**Status**: DRAFT IMPLEMENTATION PLAN / AWAITING APPROVAL

## Overview
Phase 11 introduces workspace-admin configurable workflow structures. The system shifts from a statically seeded default workflow to a dynamic multi-workflow model with customizable statuses, categories, and transition matrices. Crucially, the implementation must safely preserve all existing `task_history` audit trails, recurring task template dependencies, and Dashboard KPI projections through soft-delete (archive) semantics and strict database invariants.

## Required Implementation Sequencing

### Checkpoint A: Database Migration & Workflow Domain Invariants
**Objective**: Establish the database schema modifications and the repository primitives for optimistic concurrency and deterministic transaction locking.

- **Task 1: Drizzle Schema Modifications & Migration**
  - **Objective**: Apply schema changes required for Phase 11 without destroying existing canonical data.
  - **Changes**:
    - `workflows.version` (Integer, default 1).
    - `task_statuses.is_active` (Boolean, default true).
    - `UNIQUE(workflow_id, LOWER(name))` on `task_statuses`.
    - Partial Unique Index: `workflows(workspace_id)` where `team_id IS NULL AND is_default = true AND is_active = true`.
    - Partial Unique Index: `workflows(workspace_id, team_id)` where `team_id IS NOT NULL AND is_default = true AND is_active = true`.
    - Partial Unique Index: `task_statuses(workflow_id)` where `is_initial = true AND is_active = true`.
  - **Tests**: Generate `database/drizzle/0008_...sql`. Add migration integration tests ensuring existing workspace defaults smoothly adapt to the partial unique indexes.
  - **Explicit Non-Goal**: Do not alter `tasks`, `task_history`, or `workflow_transitions` schemas.
  - **Rollback/Recovery**: Purely additive schema. Existing seeded defaults easily comply with `is_active = true` and `version = 1`.

- **Task 2: Aggregate Concurrency & Pessimistic Lock Repository Primitives**
  - **Objective**: Implement reusable database transaction helpers for workflow aggregate locking and version bumping.
  - **Changes**:
    - Introduce helper functions in `database/src/workflow-core.ts` (or similar) to acquire `FOR UPDATE` locks on `workspaces` -> `workflows` (`ORDER BY id ASC`) -> `task_statuses`.
    - Implement `409 VERSION_CONFLICT` error translation when version mismatch occurs.
  - **Tests**: Add `workflow-concurrency.integration.test.ts` simulating concurrent modifications to trigger `VERSION_CONFLICT`.
  - **Explicit Non-Goal**: UI integration.

**STOP CONDITION**: Database migration applies cleanly against an existing populated database. Concurrency locks demonstrably prevent lost updates.

---

### Checkpoint B: Configuration API & Concurrency Lifecycle
**Objective**: Expose ADMIN-only configuration endpoints with strict validation and version aggregate control.

- **Task 3: Workflow CRUD & `set-default` Lifecycle**
  - **Objective**: Atomic workflow creation and deterministic default switching.
  - **API Behavior**:
    - `GET /api/v1/workspaces/:workspaceId/workflows` & `GET /.../:workflowId` (Include `team_id`, `statuses`, `transitions`).
    - `POST /workflows` (Atomic create with `is_active=true, is_default=false, version=1`).
    - `PATCH /:workflowId` (Update metadata; block `code` and `is_default` mutation).
    - `POST /:workflowId/set-default` (Execute deterministic lock; unset previous active default within same scope; set target `is_default=true`; bump versions).
    - `POST /:workflowId/archive` and `POST /:workflowId/restore`.
  - **Authorization**: ADMIN only for mutations. Active members for reads.
  - **Tests**: `workflow-api.test.ts` and `workflow-lifecycle.integration.test.ts` (Archive team default -> falls back to workspace default -> restore as non-default).

- **Task 4: Status Configuration & `set-initial` Lifecycle**
  - **Objective**: Manage statuses with strict category and initial state invariants.
  - **API Behavior**:
    - `POST /statuses` and `PATCH /statuses/:statusId`. (Derive `is_terminal` from `category`).
    - `POST /statuses/:statusId/set-initial` (Unset previous initial, set target, bump workflow version).
    - `POST /statuses/:statusId/archive` and `POST /.../restore`.
  - **Invariants**: Block category patch if referenced by active tasks or active recurrence rules (`409 STATUS_CATEGORY_IN_USE`).
  - **Tests**: Verify `is_terminal` derivation. Verify `set-initial` transaction prevents 0 or 2 active initial statuses.

- **Task 5: Status Reorder & Transition Bulk Replacement**
  - **Objective**: Contiguous active status ordering and dormant edge preservation.
  - **API Behavior**:
    - `PUT /statuses/reorder`: Accept array of active `status_ids`. Map to positions `1..N`.
    - `PUT /transitions`: Bulk replace. Retain any dormant edge whose target is archived. Preserve existing `requires_permission` on retained edges. Reject self-loops (`422 SELF_LOOP_NOT_ALLOWED`) and edges to inactive targets (`422 INACTIVE_TRANSITION_TARGET`).
  - **Tests**: Test omitting a dormant edge in payload -> verify it remains in DB. Test restoring target -> verify edge activates.

**STOP CONDITION**: All workflow API routes pass validation, authorization, and concurrency testing. Transition replacement correctly retains dormant archived-target edges.

---

### Checkpoint C: Task Runtime, Default Resolution & Recurrence Safety
**Objective**: Wire up existing execution code to respect new workflow configurations without altering the canonical `422 INVALID_TRANSITION` runtime contract.

- **Task 6: Task Creation Default Resolution & Scope Match**
  - **Objective**: Dynamically resolve the correct workflow during task creation.
  - **Behavior**:
    - Update `createTaskRecordTx`. If `workflow_id` is omitted: look for active team default (if task has `team_id`). If none, use active workspace default.
    - Reject cross-team workflows (`422 WORKFLOW_SCOPE_MISMATCH`).
  - **Tests**: Unit tests for default fallback and scope rejection.

- **Task 7: Runtime Transition Compatibility & Projection Alignment**
  - **Objective**: Ensure archived statuses can be escaped but not entered.
  - **Behavior**:
    - `GET /tasks/:id/transitions`: Exclude targets where `is_active = false`.
    - `POST /tasks/:id/transition`: Already throws `422 INVALID_TRANSITION` on unconfigured edges. Ensure joining logic checks target `is_active = true`.
    - Reporting: Ensure `completed_at` population matches the new derived `is_terminal` logic via `category = 'DONE'`. Exclude `CANCELLED` from KPIs.
  - **Tests**: Test task escaping an archived status. Verify transition into archived status returns `422 INVALID_TRANSITION`.

- **Task 8: Recurrence Archival Dependencies**
  - **Objective**: Block workflow/status archival if relied upon by an active recurrence template.
  - **Behavior**: Query `recurrence_rules` where `is_active = true` and `template_snapshot->>'workflow_id'` or `status_id` matches. Return `409 RECURRENCE_DEPENDENCY_CONFLICT`.
  - **Tests**: `recurrence-dependency.integration.test.ts`.

**STOP CONDITION**: Existing tasks transition smoothly. New tasks automatically adopt the correct configured defaults. Recurrence template references are safely guarded.

---

### Checkpoint D: Web Workflow Settings UI
**Objective**: Build the administrative configuration UI within Workspace Settings.

- **Task 9: Workflow Master/Detail UI**
  - **UI Behavior**: Create `/workspaces/:workspaceId/settings/workflows` route. Layout with workflow selector, default badges, team scope indicators, and "Create Workflow" dialog.
  - **Components**: Handle `409 VERSION_CONFLICT` API responses via a standardized toast and "Reload Configuration" action.

- **Task 10: Status List & Keyboard Reordering**
  - **UI Behavior**: Render status cards (Name, Code, Category, Badges). Mouse drag-handle and accessible keyboard buttons (Move Up/Move Down). Edit dialogs for category/name.
  - **Validation UX**: Modal confirmation before archiving a status. Displays API rejection correctly if category is in use.

- **Task 11: Transition Matrix & Responsive Fallback**
  - **UI Behavior**: Desktop matrix grid (Rows = From, Columns = To) with intersection checkboxes. Disables self-loop diagonal and dormant archived-target columns. Mobile (<768px) accordion list with target toggle switches.
  - **Components**: Form submission parsing delta to bulk `PUT /transitions` payload.

**STOP CONDITION**: A workspace admin can fully create, configure, reorder, and set transitions for a custom workflow visually, handling concurrency toasts gracefully.

---

### Checkpoint E: Real-Stack E2E Validation
**Objective**: Prove the complete lifecycle in a real browser against a production-build stack.

- **Task 12: Playwright Configuration Scenarios**
  - **Additions to `scripts/test-e2e.ps1`**:
    - Scenario A: Admin configures new workflow, sets transitions. User creates task, task follows matrix successfully.
    - Scenario B: Task created for Team correctly resolves to Team Default Workflow. Workspace task defaults to Workspace Default Workflow.
    - Scenario C: Admin archives a status occupied by an existing task. Kanban properly renders "Archived: [Name]" column. User successfully drags card out to active target.
    - Scenario D: Two concurrent browser admin sessions. Second session clicks save -> hits `VERSION_CONFLICT` -> reloads and sees first session's changes.
  - **Regression**: Ensure all 19 Phase 0–10 regression flows pass flawlessly.

**STOP CONDITION**: E2E suite passes 100% demonstrating end-to-end integration and stability of older workflows under dynamic configurations.

---

### Checkpoint F: Final Regression & Documentation
**Objective**: Finalize the phase implementation through the strict multi-gate sequence and document the new canonical states.

- **Task 13: Full Verification Gates**
  - **Gates**:
    1. Clean DB Migration / Seeds (`scripts/test-clean-db.ps1`)
    2. Playwright E2E (`scripts/test-e2e.ps1`)
    3. Worker Integration (Regression only; worker infra unchanged in Phase 11)
    4. `pnpm lint`
    5. `pnpm typecheck`
    6. `pnpm test` (Root Run #1)
    7. `pnpm build`
    8. `pnpm test` (Root Run #2)

- **Task 14: Documentation Updates**
  - **Internal**: Create `docs/implementation/PHASE_11_REPORT.md`. Update `IMPLEMENTATION_STATUS.md` and `CURRENT_HANDOFF.md`.
  - **External Handoff**: Identify and list external canonical documents requiring updates (e.g., *API Specification*, *ERD / Database Design*, *Technical Design*, *Wireframe / UI*). Mark as `UPDATE REQUIRED` or `INSPECTED — NO UPDATE REQUIRED`.

**STOP CONDITION**: All 8 verification gates pass consecutively. All architectural additions accurately reported. Checkpoint F fully complete.
