# Open decisions

- Resolved (Phase 6): Recurrence rules store canonical scheduling state in PostgreSQL `recurrence_rules`, with occurrence-ledger idempotency via `UNIQUE(recurrence_rule_id, scheduled_for)`. Monthly anchors 29/30/31 fall back to the last valid day of shorter months without anchor drift.
- Resolved (Phase 6): Transactional outbox persists `PENDING`/`FAILED`/`DISPATCHED` state; worker runtime uses BullMQ wake-up hints and PostgreSQL-advisory-locked chronological reconciliation catch-up.
- Open (Phase 6 follow-up): Exact `CUSTOM` recurrence grammar remains reserved and unsupported.
- Open: Inactive/removed future assignee behavior if recurrence template references change after creation.
- Open: DST ambiguous/nonexistent local time semantics beyond anchored timezone conversions.
- Open: Email, push, object storage, and deployment provider.
- Open: Granular RBAC beyond provisional ADMIN-only team mutation policy.
- Open: Calendar start-only tasks (`start_at != null && due_at == null`) remain unsupported in projection.
