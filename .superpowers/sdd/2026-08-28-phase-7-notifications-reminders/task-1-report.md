### Task 1: Notifications Schema and Due Versioning Report

- Modified `database/src/schema.ts` to add:
  - `dueVersion: integer('due_version').notNull().default(0)` column to the `tasks` table.
  - `notifications` table (with standard columns/indices as per brief).
  - `notificationDedupLedger` table (with standard columns/indices as per brief).
  - `notificationPreferences` table (with standard columns/indices as per brief).
- Generated drizzle schema migration files in `database/drizzle/` using Drizzle Kit.
- Built TypeScript files cleanly using `pnpm --filter @floz/database build`.
