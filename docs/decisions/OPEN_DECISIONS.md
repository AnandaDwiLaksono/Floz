# Open decisions

- Recurrence rule storage, timezone semantics, and occurrence generation details remain open until feature design is implemented.
- Queue and transactional outbox implementation remain open; worker is only a long-running process in Phase 0/1.
- Email, push, object storage, and deployment provider remain open.
- Phase 2 task policy is conservative: workspace members may create/update/assign/transition own-workspace tasks; delete stays guarded; future granular RBAC may tighten further.
- Phase 2 task creation and assignment keys remain API-level only for now; no separate task key or assignment ownership model yet.
- Granular RBAC beyond provisional ADMIN-only team mutation policy remains open.
