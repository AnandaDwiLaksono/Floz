# Route-Aware Workspace Hydration Design

## Problem

On initial hydration, `AuthProvider.refetchUser()` selects `user.workspaces[0]` because `activeWorkspace` starts as `null`. A deep workspace route can therefore use one workspace ID for page APIs while Shell and client-side authorization use another workspace membership and role.

## Design

`AuthProvider` centrally resolves workspace context after every successful `/me` response.

For `/workspaces/:workspaceId/...` routes, the route is authoritative. If the ID exists in `user.workspaces`, set that exact membership as `activeWorkspace` and retain the URL. If it does not exist, clear workspace context first. Then select the first accessible workspace and replace the route with `/workspaces/<id>/tasks`; when no workspace is accessible, retain `activeWorkspace = null` and replace with `/onboarding`.

For non-workspace routes, preserve a previous membership only when it remains present in the resolved user. Otherwise use the first accessible workspace. Existing login, invitation acceptance, join-code, and switcher navigation semantics remain unchanged.

Workspace-route parsing will match the first segment pair exactly rather than substring matching. Invalid-route canonicalization uses `router.replace` and always lands on `tasks`; it never preserves an unauthorized sub-route.

## Resolution Safety

Expose a workspace-resolution state through auth context. During initial hydration, pathname changes, or successful `/me` reconciliation, workspace-scoped UI must not render stale context. Shell suppresses stale workspace identity and role while resolution is pending. Privileged workspace pages additionally require all of:

- workspace resolution complete;
- `activeWorkspace` exists;
- `activeWorkspace.id` equals the route `workspaceId`;
- `activeWorkspace.role === 'ADMIN'`.

Network and unknown authentication failures do not canonicalize workspace routes. Existing unknown/failure behavior remains in control until `/me` succeeds.

## Components

- `apps/web/lib/auth-context.tsx`: parse route workspace ID, resolve membership, expose resolution state, perform safe redirects.
- `apps/web/components/shell.tsx`: avoid rendering stale workspace header, badge, and workspace-scoped privileged navigation while resolving.
- Members and Join Settings pages: enforce route/context ID equality before rendering admin UI.
- Existing invitation acceptance and join-code flows: regression coverage only unless synchronization requires a minimal compatibility fix.

## Tests

AuthProvider hydration tests cover:

1. `/me` order `[Workspace2, Workspace1]` on a Workspace1 route selects Workspace1.
2. Workspace2 route selects Workspace2.
3. Different roles resolve the correct header, role badge, Members authorization, and API workspace ID.
4. Invalid or unauthorized workspace route clears stale context and calls `replace('/workspaces/<first-id>/tasks')`.
5. No accessible workspace calls `replace('/onboarding')` and leaves context null.
6. Unknown `/me` failure does not redirect prematurely.
7. Workspace switcher still navigates correctly.
8. Invitation acceptance and join-code redirects remain synchronized.

Tests model initial provider mount/full refresh, not only switcher navigation.

## Constraints

No API contract or database change. No per-page workspace selection mechanism. No history rewrite beyond canonical `router.replace`. No deployment or merge as part of implementation.
