
## Review fix
- Added `now` to `markOutboxRetry` ownership input and required `claimed_until > now`.
- Added regression coverage proving expired claimant retry returns false with no mutation.
- Confirmed `markOutboxDispatched` already required the same unexpired lease predicate.

## Fix verification
- Focused outbox test: 1 passed.
- API lint: passed.
- API typecheck: passed.
- API build: passed.
