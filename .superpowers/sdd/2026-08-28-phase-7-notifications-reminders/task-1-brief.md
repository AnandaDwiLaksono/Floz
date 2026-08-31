### Task 1: Notifications Schema and Due Versioning

**Files:**
- Modify: `packages/database/src/schema.ts`
- Create: `packages/database/drizzle/0005_phase7_notifications.sql` (generated via `pnpm db:generate` or created by migration generation)
- Test: `packages/database/test/notifications.schema.test.ts` (or integration test validating schema migration)

**Interfaces:**
- Produces: `notifications`, `notificationDedupLedger`, `notificationPreferences` tables exported in `schema.ts`.
- Produces: `dueVersion` column on `tasks` table.

**Requirements & Specifications:**
1. In `packages/database/src/schema.ts`:
   - Add `dueVersion: integer("due_version").notNull().default(0)` to the `tasks` table definition.
   - Define `notifications` table:
     - `id`: uuid primaryKey defaultRandom
     - `workspaceId`: uuid references workspaces.id onDelete cascade
     - `userId`: uuid references users.id onDelete cascade
     - `type`: varchar(50) not null ('TASK_ASSIGNED', 'TASK_DUE_SOON', 'TASK_OVERDUE')
     - `title`: varchar(255) not null
     - `body`: text not null
     - `entityType`: varchar(50) ('TASK')
     - `entityId`: uuid nullable
     - `isRead`: boolean not null default false
     - `readAt`: timestamptz nullable
     - `createdAt`: timestamptz not null defaultNow
     - Index: `idx_notifications_user_read_created` on `(userId, isRead, createdAt)`
     - Index: `idx_notifications_ws_user_read_created_id` on `(workspaceId, userId, isRead, createdAt, id)`
   - Define `notificationDedupLedger` table:
     - `id`: uuid primaryKey defaultRandom
     - `workspaceId`: uuid references workspaces.id onDelete cascade
     - `dedupKey`: varchar(255) not null
     - `notificationId`: uuid nullable (loose nullable reference, no cascade delete)
     - `createdAt`: timestamptz not null defaultNow
     - Unique Index: `idx_notification_dedup_ws_key` on `(workspaceId, dedupKey)`
   - Define `notificationPreferences` table:
     - `id`: uuid primaryKey defaultRandom
     - `userId`: uuid references users.id onDelete cascade
     - `workspaceId`: uuid references workspaces.id onDelete cascade
     - `notificationType`: varchar(50) not null
     - `inAppEnabled`: boolean not null default true
     - `emailEnabled`: boolean not null default false
     - `pushEnabled`: boolean not null default false
     - `createdAt`: timestamptz not null defaultNow
     - `updatedAt`: timestamptz not null defaultNow
     - Unique Index: `idx_notification_pref_user_ws_type` on `(userId, workspaceId, notificationType)`
2. Ensure types and relations are exported properly in `packages/database/src/schema.ts` and `packages/database/src/index.ts`.
3. Generate Drizzle migration using `pnpm --filter @floz/database db:generate`.
4. Verify database tests and builds pass (`pnpm --filter @floz/database build`).
