# ADR-001: Better Auth canonical identity

Status: Accepted

Floz uses Better Auth's canonical `users`, `accounts`, `sessions`, and `verifications` tables. Floz profile fields extend `users`; workspace roles remain on `workspace_memberships`. Better Auth owns authentication and identity lifecycle only.

The API uses a secure HttpOnly `floz_session` cookie instead of the bearer transport shown in the baseline API document. This is an intentional frontend transport deviation; resource paths and envelopes remain unchanged.
