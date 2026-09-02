# Floz Master Outstanding / Gap Audit

**Canonical state**
- `master` HEAD: `aa98e90`
- Phase 0–8: complete
- Phase 9: not started
- Audit scope: planning only; no application, migration, or implementation-status changes.

## A. Executive Summary

**P0:** core operational product is substantially complete. Authentication/session, workspace isolation, task CRUD/workflow/history, Kanban, Calendar read projection, recurring tasks, notifications, My Work, dashboards, and KPI reporting exist. Gate A remains open for verified operator/admin usability gaps, multi-assignee create UX, and Calendar edit/reschedule.

**P1:** collaboration is incomplete: approvals, comments/mentions, workflow configuration, notification preferences, and attachments.

**Production readiness:** provider topology is **DECIDED**. Actual infrastructure is **NOT DEPLOYED**. Deployment automation is **NOT IMPLEMENTED**. Commercial/paid provider upgrades remain **OPEN/FUTURE**.

## B. Provider / Deployment Status

| Concern | Status | Evidence |
|---|---|---|
| Web | DECIDED — Next.js on Vercel Hobby for permitted dev/demo/non-commercial bootstrap use | `Documentation/Technical/Floz_Technical_Design_Architecture_Free_Bootstrap.md:110,124,158` |
| API | DECIDED — NestJS, Oracle Cloud A1, Docker | `Documentation/Technical/Floz_Technical_Design_Architecture_Free_Bootstrap.md:2232` |
| Worker | DECIDED — BullMQ, Oracle Cloud A1, Docker | `Documentation/Technical/Floz_Technical_Design_Architecture_Free_Bootstrap.md:2232` |
| Database | DECIDED — Neon PostgreSQL | `Documentation/Technical/Floz_Technical_Design_Architecture_Free_Bootstrap.md:617,2232` |
| Redis | DECIDED — Upstash | `Documentation/Technical/Floz_Technical_Design_Architecture_Free_Bootstrap.md:114,768` |
| Storage | DECIDED — Cloudflare R2 | `Documentation/Technical/Floz_Technical_Design_Architecture_Free_Bootstrap.md:115,165` |
| Email | DECIDED — Resend optional adapter/channel | `Documentation/Technical/Floz_Technical_Design_Architecture_Free_Bootstrap.md:117,168` |
| Proxy | DECIDED — Caddy preferred; Nginx valid | `Documentation/Technical/Floz_Technical_Design_Architecture_Free_Bootstrap.md:118,174` |
| Deployment topology | DECIDED — Docker Compose bootstrap | `Documentation/Technical/Floz_Technical_Design_Architecture_Free_Bootstrap.md:119,173` |
| Actual infrastructure | NOT DEPLOYED | No deployed environment/IaC/release evidence in repository |
| Deployment automation | NOT IMPLEMENTED | No CI workflow or deployment pipeline found |
| Commercial frontend hosting | OPEN/FUTURE | Vercel Hobby is not permanent commercial-production entitlement: `Documentation/Technical/Floz_Technical_Design_Architecture_Free_Bootstrap.md:60,124,2228` |

## C. Multi-Assignee Audit

**Canonical requirement:** multiple assignees; maximum one primary assignee.

**Feature status: PARTIAL.** Backend model, contracts, transactional behavior, validation, reads, and tests support it. Standard web task creation only permits one assignee, so the user feature is incomplete.

| Layer | Status | Evidence | Gap |
|---|---|---|---|
| Database model | COMPLETE | `task_assignees` supports many rows/task; unique task-user pair and partial unique primary index: `database/src/schema.ts:235-242` | None |
| API mutation contract | COMPLETE | Task create accepts `assignees`; replacement endpoint accepts array: `apps/api/src/task.service.ts:11-13,57-58,110` | None |
| API read contract | COMPLETE | Detail returns ordered assignee array: `apps/api/src/task.service.ts:55`; Kanban returns all assignees: `apps/api/src/task.service.ts:81` | Calendar intentionally returns primary summary only |
| Business validation | COMPLETE | Rejects multiple primary assignees; requires active workspace members: `database/src/task-core.ts:30-33,60-73`; `apps/api/src/task.service.ts:49,58` | None |
| Transaction behavior | COMPLETE | Task and assignments created transactionally: `apps/api/src/task.service.ts:57`; replacement is transactional/versioned: `apps/api/src/task.service.ts:110` | None |
| Web create UX | NOT IMPLEMENTED | Create form has one `Primary Assignee` select and emits one-item array: `apps/web/app/workspaces/[workspaceId]/tasks/page.tsx:249,746-761` | Select multiple assignees, select exactly zero/one primary |
| Web edit assignment UX | COMPLETE | Detail loads assignment array and replaces it through assignment API: `apps/web/app/workspaces/[workspaceId]/tasks/page.tsx:230-235,359-376` | Verify usability during Phase 9 acceptance |
| Display UX | COMPLETE baseline | Task list renders each assignee and highlights primary: `apps/web/app/workspaces/[workspaceId]/tasks/page.tsx:569-581`; Kanban intentionally emphasizes primary: `apps/web/app/workspaces/[workspaceId]/kanban/page.tsx:77` | Calendar summary intentionally primary-only |
| Tests | COMPLETE backend / PARTIAL web | API validates two primaries and read contract: `apps/api/test/api.test.ts:140-160,327-332,544-545`; DB tests assignment replacement: `database/test/task-core.integration.test.ts:73,126-128` | No demonstrated browser test for multi-assignee create UX because UI absent |

**Gate label:** MUST BEFORE GATE A.

## D. Calendar Capability Audit

| Capability | Status | Evidence | Remaining work / gate label |
|---|---|---|---|
| Month view | COMPLETE | `apps/web/app/workspaces/[workspaceId]/calendar/page.tsx:9,114-120` | None |
| Week view | COMPLETE | `apps/web/app/workspaces/[workspaceId]/calendar/page.tsx:9,105,114-120` | None |
| Day view | COMPLETE | `apps/web/app/workspaces/[workspaceId]/calendar/page.tsx:9,105,114-120` | None |
| Range projection | COMPLETE | API overlap/range query: `apps/api/src/task.service.ts:71-72`; UI calculates view range: `apps/web/app/workspaces/[workspaceId]/calendar/page.tsx:38,68-71` | None |
| Timezone behavior | COMPLETE baseline | Workspace timezone loaded and used for ranges/day grouping: `apps/web/app/workspaces/[workspaceId]/calendar/page.tsx:51-54,68,83-95`; API timestamps documented timezone-aware: `Documentation/Technical/Floz_API_Specification.md:360,368` | Per-user locale/timezone settings are separate profile gap |
| Team/assignee filters | COMPLETE | UI filters: `apps/web/app/workspaces/[workspaceId]/calendar/page.tsx:108-110`; API applies scopes: `apps/api/src/task.service.ts:70-72` | None |
| Deadline-only tasks | COMPLETE | API includes `start_at = null`, due-in-range tasks: `apps/api/src/task.service.ts:71-72`; UI labels them: `apps/web/app/workspaces/[workspaceId]/calendar/page.tsx:117` | None |
| Create-from-calendar | COMPLETE | Calendar create action supplies prefilled dates/timezone: `apps/web/app/workspaces/[workspaceId]/calendar/page.tsx:96,116`; product requires schedule create/change from Calendar: `Documentation/Product/Floz_PRD_Product_Requirements_Document.md:201-204` | Acceptance: opened create form preserves selected date/timezone |
| Edit/reschedule-from-calendar | NOT IMPLEMENTED | Calendar task click only opens task route: `apps/web/app/workspaces/[workspaceId]/calendar/page.tsx:117`; PRD requires schedule update from Calendar: `Documentation/Product/Floz_PRD_Product_Requirements_Document.md:204` | MUST BEFORE GATE A: task detail or calendar action must edit `start_at`/`due_at`, persist optimistic-concurrency-safe change, refresh projection |
| Start-only task behavior | ACCEPTED LIMITATION | Projection excludes `start_at != null && due_at == null`: `apps/api/src/task.service.ts:71`; documented: `docs/implementation/IMPLEMENTATION_STATUS.md:42`, `docs/decisions/OPEN_DECISIONS.md:17` | Not Gate A blocker unless product decision changes |

## E. Corrected Master Feature Matrix

| Area | Requirement | Status | Release Label | Evidence / missing boundary |
|---|---|---|---|---|
| Auth | Login/logout/session/current user | COMPLETE | Done | `docs/implementation/IMPLEMENTATION_STATUS.md:5-7` |
| Auth | Profile edit; user timezone/basic preferences | NOT IMPLEMENTED | MUST BEFORE GATE A | Wireframe explicitly requires name/avatar/email/timezone/basic preferences: `Documentation/Design/Floz_Wireframe_UI_Specification.md:473`; no matching web settings surface evidenced |
| Auth | Inactive account lifecycle | PARTIAL | MUST BEFORE GATE A | Active membership enforcement exists; future inactive-assignee behavior open: `docs/decisions/OPEN_DECISIONS.md:6` |
| Auth | Password reset/email verification | NEEDS PRODUCT DECISION | FUTURE | Architecture only requires tokens not be logged: `Documentation/Technical/Floz_Technical_Design_Architecture_Free_Bootstrap.md:644`; no baseline pilot onboarding mandate found |
| Workspace | Workspace isolation/list/detail | COMPLETE | Done | `docs/implementation/IMPLEMENTATION_STATUS.md:5-9` |
| Workspace | Workspace administration | PARTIAL | MUST BEFORE GATE A | Backend foundation exists; no workspace settings/admin route evidenced. Acceptance: authorized admin can view/update required workspace settings and see failures/access denial |
| Membership | User/member administration | PARTIAL | MUST BEFORE GATE A | Membership model/API foundation exists: `docs/implementation/IMPLEMENTATION_STATUS.md:5-6`; admin management UI not evidenced. Acceptance: authorized admin can list, add/invite if baseline onboarding requires it, activate/deactivate, and assign role within defined policy |
| Teams | Team CRUD/membership | PARTIAL | MUST BEFORE GATE A | Backend endpoints delivered: `docs/implementation/IMPLEMENTATION_STATUS.md:5-8`; user-facing team admin not evidenced. Acceptance: admin can create/edit/archive team and manage membership |
| Teams | Manager assignment | PARTIAL | MUST BEFORE GATE A | Manager dashboard depends on `manager_user_id`: `docs/implementation/PHASE_8_REPORT.md:46-47,100`; no assignment UI evidenced. Acceptance: authorized admin can assign/remove active workspace member and manager dashboard scope updates |
| Task | CRUD, workflow, history, concurrency | COMPLETE | Done | `docs/implementation/IMPLEMENTATION_STATUS.md:10-12` |
| Task | Multiple assignees, one primary | PARTIAL | MUST BEFORE GATE A | See Section C; create UX missing |
| Task/Search | Search/filter/sort baseline | PARTIAL | MUST BEFORE GATE A | API supports title/task-key, status, priority, team, assignee, due range: `apps/api/src/task.service.ts:103`; acceptance: Task List exposes canonical implemented filters and preserves them across list navigation. Saved filters excluded |
| Kanban | Projection, filters, transitions, accessible non-drag | COMPLETE | Done | `docs/implementation/IMPLEMENTATION_STATUS.md:13-14` |
| Calendar | Read views/projection/timezone/filters/deadline-only/create | COMPLETE | Done | See Section D |
| Calendar | Edit/reschedule | NOT IMPLEMENTED | MUST BEFORE GATE A | See Section D |
| Calendar | Start-only task projection | ACCEPTED LIMITATION | FUTURE | See Section D |
| Recurrence | Daily/weekly/monthly, update/stop, reconciliation/dedup | COMPLETE | Done | `docs/implementation/IMPLEMENTATION_STATUS.md:16`; `docs/decisions/OPEN_DECISIONS.md:3-4` |
| Recurrence | CUSTOM rule | DEFERRED | FUTURE | `docs/decisions/OPEN_DECISIONS.md:5` |
| Notifications | Assignment/due-soon/overdue, inbox/read | COMPLETE | Done | `docs/implementation/IMPLEMENTATION_STATUS.md:17` |
| My Work | Today/Upcoming/Overdue | COMPLETE | Done | `docs/implementation/PHASE_8_REPORT.md:21-30` |
| Field Worker | Operational mobile flow/full-list handoff/quick status | PARTIAL | MUST BEFORE GATE A | Existing responsive field-worker coverage: `docs/implementation/PHASE_8_REPORT.md:28-30,59`; wireframe specifies My Work workflow: `Documentation/Design/Floz_Wireframe_UI_Specification.md:199-241,573`. Acceptance: mobile user can open Today/Upcoming/Overdue, open essential detail, change allowed status, reach full task list, and preserve task scope |
| Dashboard/KPI | Member/manager dashboards, workload, KPI/drilldowns | COMPLETE baseline | Done | `docs/implementation/PHASE_8_REPORT.md:34-52` |
| Reporting | Historical snapshots/exports/scheduled reports | DEFERRED | RECOMMENDED POST-PILOT | `docs/implementation/PHASE_8_REPORT.md:94-101` |
| Approval | Schema/API/state machine/inbox/UI/notifications/dashboard count | NOT IMPLEMENTED | MUST BEFORE GATE B | Explicitly excluded from Phase 8: `docs/superpowers/plans/2026-09-01-phase-8-dashboard-kpi-my-work.md:19-21` |
| Collaboration | Comments/mentions/UI/notifications | NOT IMPLEMENTED | MUST BEFORE GATE B | `docs/implementation/CURRENT_HANDOFF.md:24-26` |
| Workflow configuration | Workflow/status/transition CRUD, reorder/deactivate, authorization, UI | PARTIAL | MUST BEFORE GATE B | Baseline schema/list/transition exists: `database/src/schema.ts:109-142`, `apps/api/src/task.service.ts:56,111-113`; full config contracts: `Documentation/Technical/Floz_API_Specification.md:835-951`. Separate phase: high core-invariant, authorization, migration, UI, and test scope; do not bundle into Approval/Collaboration |
| Attachments | Metadata/R2/signed URLs/auth/UI | NOT IMPLEMENTED | RECOMMENDED POST-PILOT | R2 architecture decided: `Documentation/Technical/Floz_Technical_Design_Architecture_Free_Bootstrap.md:115,165`; no pilot requirement evidence |
| Notification prefs/email/push | Preferences, Resend/push delivery | NOT IMPLEMENTED / DEFERRED | RECOMMENDED POST-PILOT | Out of scope: `docs/implementation/IMPLEMENTATION_STATUS.md:40`; Resend design decided but optional: `Documentation/Technical/Floz_Technical_Design_Architecture_Free_Bootstrap.md:117,168` |
| Audit | Security/admin audit logs | NOT IMPLEMENTED | MUST BEFORE GATE C | No implementation evidence; define pilot accountability requirement |
| Infrastructure | Production Compose/container/proxy implementation | PARTIAL / GAP | MUST BEFORE GATE C | Topology decided; repository Compose/Docker gaps remain. Acceptance: production build/start works with API, worker, Caddy, external Neon/Upstash, migrations, non-root runtime, health checks |
| Security | Secure CORS/config/secrets/rate limiting/headers | PARTIAL / GAP | MUST BEFORE GATE C | Credentialed wildcard CORS and incomplete config validation found in prior audit | 
| Reliability/Ops | Outbox/retry/reconciliation | COMPLETE baseline | Done | `docs/decisions/OPEN_DECISIONS.md:3-4` |
| Operations | Monitoring/alerts/backup/restore/runbooks/rollback | NOT IMPLEMENTED | MUST BEFORE GATE C | No implementation evidence |
| CI/CD | Automated quality, migration, image, deploy gates | NOT IMPLEMENTED | MUST BEFORE GATE C | Local root scripts exist; no CI workflow/deployment pipeline evidenced |
| Deployment | Bootstrap topology deployment | NOT DEPLOYED | MUST BEFORE GATE C | Design decided; no deployed environment evidence |
| Commercial upgrade | Paid/provider upgrade | OPEN/FUTURE | FUTURE | Vercel Hobby terms caveat: `Documentation/Technical/Floz_Technical_Design_Architecture_Free_Bootstrap.md:60,124` |

## F. Gate Roadmap

### Gate A — Core MVP/P0 Complete

**Must complete before Gate A**

1. **Phase 9 — P0 Operator Usability & Administration**
   - Profile: name/avatar/email/timezone/basic preferences. Evidence: wireframe requirement at `Documentation/Design/Floz_Wireframe_UI_Specification.md:473`; no implemented settings surface evidenced.
   - Workspace administration. Evidence: backend foundation only; no workspace settings/admin route evidenced. Acceptance: authorized administrator manages documented workspace settings.
   - User/member administration. Evidence: membership foundation delivered but management UI not evidenced. Acceptance: authorized administrator lists/manages active membership state and role under defined policy.
   - Team administration and membership. Evidence: backend CRUD/member endpoints exist; UI absent. Acceptance: authorized administrator manages team lifecycle and members.
   - Manager assignment. Evidence: reporting uses `manager_user_id`, no edit surface evidenced. Acceptance: manager assignment changes scoped manager dashboard results.
   - Multi-assignee create UX. Evidence: backend complete; create UI is single primary select. Acceptance: create task supports multiple unique active members and zero/one primary.
   - Calendar edit/reschedule. Evidence: PRD requires it; Calendar currently links to detail only. Acceptance: schedule mutation works with validation/version handling and immediate projection refresh.
   - Field Worker operational UX. Evidence: responsive baseline exists, but mobile task execution acceptance is not established. Acceptance: Today/Upcoming/Overdue, essential detail, quick allowed status update, full-list handoff, scoped/mobile usability.
   - Task List search/filter consistency. Evidence: API filters implemented, cross-surface behavior not established. Acceptance: Task List exposes canonical implemented filters and preserves them through navigation; saved filters excluded.

**Explicit Gate A exclusions**
- Approval, comments, mentions, attachments, workflow configuration, email/push, historical reporting, start-only Calendar projection, CUSTOM recurrence, offline mode.

**Gate A significance:** core MVP/P0 is operationally usable by administrators, managers, members, and field workers.

### Gate B — Collaborative Pilot Feature Complete

**Must complete before Gate B**

2. **Phase 10 — Approval & Collaboration Core**
   - Request/approval state machine, approver rules, inbox/detail, approve/reject/cancel, history, approval notifications, dashboard pending-approval integration.
   - Comments, mentions, authorization, activity timeline, mention/comment notifications.
   - Excludes workflow configuration and attachments.

3. **Phase 11 — Workflow Configuration**
   - Workflow CRUD, statuses, transitions, reorder/deactivate, workspace/team scope, authorization, settings UI, integrity and E2E tests.
   - Separate from Phase 10 because it changes core task invariants and has independent API/UI/authorization/migration risk.

**Gate B significance:** pilot supports collaborative review/approval and controlled operational workflows.

### Gate C — Production/Pilot Operationally Ready

**Must complete before Gate C**

4. **Phase 12 — Production Hardening & Delivery**
   - Implement the decided topology; do not re-decide providers.
   - Fix Docker/Compose build/start paths; API, worker, Caddy; external Neon/Upstash configuration; migration release flow.
   - Liveness/readiness, worker heartbeat, graceful API shutdown.
   - Structured request correlation, secure CORS, secrets/config validation, security headers, rate limiting, TLS validation.
   - CI: lint/typecheck/test/build, clean DB migration validation, E2E, image build, vulnerability/secret checks, deployment/smoke gates.
   - Staging deployment and bootstrap provider configuration.

5. **Phase 13 — Pilot Operations & Launch Acceptance**
   - Backup policy, encrypted backup where applicable, restore procedure and restore test.
   - Monitoring, alerts, runbooks, incident/queue recovery, rollback procedure.
   - UAT checklist, pilot smoke test, domain/TLS validation, launch sign-off.
   - Admin/security audit logs if pilot accountability requires them.

**Gate C significance:** Floz is ready for pilot/users on the decided free-bootstrap topology, subject to Vercel Hobby permitted-use terms.

### Recommended Post-Pilot

- Attachments using decided Cloudflare R2 architecture.
- Notification preferences, Resend email delivery, push.
- Historical KPI snapshots, exports, scheduled reports, saved filters, cross-workspace reporting.
- Granular RBAC beyond current policy.

### Future

- Commercial frontend plan/provider upgrade before commercial production use.
- `CUSTOM` recurrence.
- Start-only Calendar projection if product decision reverses accepted limitation.
- Offline/mobile-first mode.
- Business-hours/paused-time KPI calculations.

## G. Production-Readiness Matrix

| Area | Status | Required Gate C boundary |
|---|---|---|
| Provider topology | DECIDED | Deploy exactly the documented bootstrap topology |
| Infrastructure | NOT DEPLOYED / PARTIAL repo skeleton | Working hardened Compose/Caddy/API/worker deployment using Neon and Upstash |
| Security | PARTIAL / GAP | Secure CORS, validated secrets/config, headers, rate limiting, TLS |
| Reliability | PARTIAL | Preserve outbox/reconciliation; add dependency readiness, failure recovery procedures, operational controls |
| Observability | PARTIAL | Request IDs, structured HTTP logs, worker heartbeat, metrics/alerts suitable for pilot |
| Backup/restore | NOT IMPLEMENTED | Documented backup/restore plus successful restore test |
| CI/CD | NOT IMPLEMENTED | Automated quality, migration, E2E, image, deploy/smoke gates |
| Deployment automation | NOT IMPLEMENTED | Repeatable staging/pilot deployment and rollback path |
| Operations | NOT IMPLEMENTED | Runbooks, monitoring, alerts, queue recovery, incident procedure |
| UAT | NOT IMPLEMENTED | Pilot UAT, smoke evidence, sign-off |

## H. Suggested Next Phase

**Exactly one recommendation: Phase 9 — P0 Operator Usability & Administration.**

It closes verified Gate A gaps before new P1 collaboration work: admin/member/team operation, manager assignment, profile/timezone preferences, multi-assignee creation, Calendar rescheduling, field-worker execution UX, and canonical task-list search/filter usability. Provider design is already decided; infrastructure implementation belongs to Gate C, after core pilot workflows are complete.
