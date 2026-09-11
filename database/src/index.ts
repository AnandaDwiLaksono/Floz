import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { normalizePostgresTls, type NodeEnv } from '@floz/config';
import * as schema from './schema.js';

export type DatabaseClient = ReturnType<typeof drizzle<typeof schema>>;

export type CreateDatabaseOptions = {
  max?: number;
  connect_timeout?: number;
  idle_timeout?: number;
  ssl?: boolean | 'require' | 'allow' | 'prefer' | 'verify-full';
  nodeEnv?: string;
  dbSsl?: string;
};

export function createDatabase(url: string, options?: CreateDatabaseOptions) {
  const nodeEnv = (options?.nodeEnv ?? process.env.NODE_ENV ?? 'development') as NodeEnv;
  const { ssl } = normalizePostgresTls(url, options?.dbSsl, nodeEnv);

  if (nodeEnv === 'production' && options?.max && options.max > 1) {
    throw new Error('Database connection pool max cannot exceed approved budget of 1 in production');
  }

  const client = postgres(url, {
    max: options?.max ?? 1,
    connect_timeout: options?.connect_timeout ?? 5,
    idle_timeout: options?.idle_timeout ?? 20,
    connection: {
      statement_timeout: 10000,
      lock_timeout: 3000
    },
    ssl: ssl !== false ? (ssl as 'require' | 'allow' | 'prefer' | 'verify-full') : undefined
  });
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
export * from './workflow-core.js';
