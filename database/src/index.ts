import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type DatabaseClient = ReturnType<typeof drizzle<typeof schema>>;

export function createDatabase(url: string) {
  const client = postgres(url, { max: 1 });
  return { db: drizzle(client, { schema }), sql: client };
}

export * from './schema.js';
