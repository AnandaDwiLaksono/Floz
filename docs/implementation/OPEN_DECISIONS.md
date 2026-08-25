# Open decisions

- ORM and migration tool remain open; Phase 0 intentionally has no schema.
- Authentication provider and transport remain open. Source API documents bearer tokens; architecture keeps provider portability.
- Recurrence rule storage, timezone semantics, and occurrence generation details remain open until feature design is implemented.
- Queue/outbox implementation remains open; worker is only a long-running process in Phase 0.
- Email, push, object storage, and deployment provider remain open.
