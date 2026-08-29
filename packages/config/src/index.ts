import { z } from 'zod';

const nodeEnv = z.enum(['development', 'test', 'production']).default('development');
const envBoolean = z.enum(['true', 'false']).default('false').transform((value) => value === 'true');

export const apiEnvSchema = z.object({
  NODE_ENV: nodeEnv,
  API_PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info')
});

export const workerEnvSchema = z.object({
  NODE_ENV: nodeEnv,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  REDIS_TLS: envBoolean,
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5)
});

export const webEnvSchema = z.object({
  NODE_ENV: nodeEnv,
  NEXT_PUBLIC_API_URL: z.string().url().default('http://localhost:3001')
});

export const parseApiEnv = (env: NodeJS.ProcessEnv) => apiEnvSchema.parse(env);
export const parseWorkerEnv = (env: NodeJS.ProcessEnv) => workerEnvSchema.parse(env);
export const parseWebEnv = (env: NodeJS.ProcessEnv) => webEnvSchema.parse(env);
