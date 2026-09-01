import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type DatabaseClient = ReturnType<typeof drizzle<typeof schema>>;

export function createDatabase(url: string) {
  const client = postgres(url, { max: 10 });
  return { db: drizzle(client, { schema }), sql: client };
}

export * from './schema.js';
export * from './outbox.js';
export * from './task-core.js';
export * from './notification-core.js';
export * from './reporting-core.js';
export * from './my-work.js';
export * from './kpis.js';
export * from './dashboard.js';
