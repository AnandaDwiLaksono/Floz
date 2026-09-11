import { z } from 'zod';

export type NodeEnv = 'development' | 'test' | 'production';

const nodeEnv = z.enum(['development', 'test', 'production']).default('development');

const isLocalhostHost = (hostname: string): boolean => {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
};

export const normalizeOrigins = (
  env: Record<string, string | undefined>,
  nodeEnvVal: NodeEnv
): string[] => {
  const allowedOriginsRaw = env.ALLOWED_ORIGINS;
  const legacyAllowedOrigin = env.ALLOWED_ORIGIN;

  let parsedOrigins: string[] = [];

  if (allowedOriginsRaw) {
    parsedOrigins = allowedOriginsRaw
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0);
  }

  if (legacyAllowedOrigin) {
    const trimmedLegacy = legacyAllowedOrigin.trim();
    if (trimmedLegacy.length > 0) {
      if (parsedOrigins.length > 0 && !parsedOrigins.includes(trimmedLegacy)) {
        throw new Error('Conflicting ALLOWED_ORIGIN and ALLOWED_ORIGINS configuration');
      }
      if (parsedOrigins.length === 0) {
        parsedOrigins = [trimmedLegacy];
      }
    }
  }

  if (parsedOrigins.length === 0) {
    if (nodeEnvVal === 'production') {
      throw new Error('ALLOWED_ORIGINS is required in production');
    }
    return ['http://localhost:3000', 'http://127.0.0.1:3000'];
  }

  return parsedOrigins.map((originStr) => {
    if (originStr === '*' || originStr === 'null') {
      throw new Error('Wildcard and null origins are prohibited');
    }
    let url: URL;
    try {
      url = new URL(originStr);
    } catch {
      throw new Error('Invalid origin URL');
    }

    if (nodeEnvVal === 'production') {
      if (url.protocol !== 'https:') {
        throw new Error('Production origins must use HTTPS');
      }
      if (isLocalhostHost(url.hostname)) {
        throw new Error('Localhost origins are prohibited in production');
      }
    }

    if (url.pathname !== '/' && url.pathname !== '') {
      throw new Error('Origins must not contain path components');
    }
    if (url.search || url.hash) {
      throw new Error('Origins must not contain query or hash components');
    }
    if (url.username || url.password) {
      throw new Error('Origins must not contain user credentials');
    }

    return url.origin;
  });
};

export const normalizePostgresTls = (
  databaseUrl: string,
  dbSsl: string | undefined,
  nodeEnvVal: NodeEnv
): { ssl: boolean | 'require' | 'allow' | 'prefer' | 'verify-full' } => {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('Invalid DATABASE_URL');
  }

  const isLocal = isLocalhostHost(url.hostname);

  if (nodeEnvVal === 'production' && isLocal) {
    throw new Error('Production database host cannot be localhost');
  }

  const sslmode = url.searchParams.get('sslmode');

  if (nodeEnvVal === 'production') {
    if (dbSsl === 'false') {
      throw new Error('DB_SSL=false is prohibited for remote production databases');
    }
    if (sslmode === 'disable' || sslmode === 'allow' || sslmode === 'prefer') {
      throw new Error(`Insecure sslmode=${sslmode} is prohibited in production`);
    }
    return { ssl: 'require' };
  }

  if (isLocal) {
    if (dbSsl === 'true' || sslmode === 'require') {
      return { ssl: 'require' };
    }
    return { ssl: false };
  }

  if (dbSsl === 'false' || sslmode === 'disable') {
    return { ssl: false };
  }

  return { ssl: 'require' };
};

export const normalizeRedisTls = (
  redisUrl: string,
  redisTls: string | undefined,
  nodeEnvVal: NodeEnv
): { tls: boolean } => {
  let url: URL;
  try {
    url = new URL(redisUrl);
  } catch {
    throw new Error('Invalid REDIS_URL');
  }

  const isRedissScheme = url.protocol === 'rediss:';

  if (nodeEnvVal === 'production') {
    if (isRedissScheme && redisTls === 'false') {
      throw new Error('Contradictory REDIS_URL rediss:// with REDIS_TLS=false in production');
    }
    if (!isRedissScheme && (redisTls === undefined || redisTls === 'false')) {
      throw new Error('Remote production Redis requires rediss:// or REDIS_TLS=true');
    }
    return { tls: true };
  }

  if (isRedissScheme || redisTls === 'true') {
    return { tls: true };
  }

  return { tls: false };
};

const validateSecret = (secret: string | undefined, nodeEnvVal: NodeEnv): string | undefined => {
  if (nodeEnvVal === 'production') {
    if (!secret || secret.length < 32) {
      throw new Error('BETTER_AUTH_SECRET must be at least 32 characters in production');
    }
    const uniqueChars = new Set(secret.split('')).size;
    if (uniqueChars < 8) {
      throw new Error('BETTER_AUTH_SECRET lacks sufficient entropy');
    }
  }
  return secret;
};

export const apiEnvSchema = z.object({
  NODE_ENV: nodeEnv,
  API_PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().url().optional(),
  BETTER_AUTH_SECRET: z.string().optional(),
  BETTER_AUTH_URL: z.string().url().optional(),
  ALLOWED_ORIGINS: z.string().optional(),
  ALLOWED_ORIGIN: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(1),
  DB_SSL: z.enum(['true', 'false']).optional(),
  NODE_TLS_REJECT_UNAUTHORIZED: z.string().optional()
});

export const workerEnvSchema = z.object({
  NODE_ENV: nodeEnv,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  REDIS_TLS: z.enum(['true', 'false']).optional(),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(1),
  DB_POOL_MAX: z.coerce.number().int().positive().default(1),
  RECURRENCE_RECONCILIATION_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  RECURRENCE_RECONCILIATION_BATCH_SIZE: z.coerce.number().int().positive().default(50)
});

export const databaseEnvSchema = z.object({
  NODE_ENV: nodeEnv,
  DATABASE_URL: z.string().url().optional(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(1),
  DB_SSL: z.enum(['true', 'false']).optional()
});

export const migrationEnvSchema = z.object({
  NODE_ENV: nodeEnv,
  DATABASE_URL: z.string().url().optional(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(1),
  DB_SSL: z.enum(['true', 'false']).optional()
});

export const webEnvSchema = z.object({
  NODE_ENV: nodeEnv,
  NEXT_PUBLIC_API_URL: z.string().url().default('http://localhost:3001')
});

export const parseApiEnv = (rawEnv: NodeJS.ProcessEnv) => {
  const parsed = apiEnvSchema.parse(rawEnv);
  if (parsed.NODE_ENV === 'production') {
    if (rawEnv.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
      throw new Error('NODE_TLS_REJECT_UNAUTHORIZED=0 is prohibited in production');
    }
    if (!parsed.DATABASE_URL) {
      throw new Error('DATABASE_URL is required in production');
    }
    validateSecret(parsed.BETTER_AUTH_SECRET, 'production');
    if (!parsed.BETTER_AUTH_URL || !parsed.BETTER_AUTH_URL.startsWith('https://')) {
      throw new Error('BETTER_AUTH_URL must be a valid HTTPS URL in production');
    }
  }

  const origins = normalizeOrigins(rawEnv, parsed.NODE_ENV);

  return {
    ...parsed,
    DB_POOL_MAX: 1,
    ALLOWED_ORIGINS: origins
  };
};

export const parseWorkerEnv = (rawEnv: NodeJS.ProcessEnv) => {
  const parsed = workerEnvSchema.parse(rawEnv);
  if (parsed.NODE_ENV === 'production') {
    if (!parsed.DATABASE_URL) {
      throw new Error('DATABASE_URL is required in production');
    }
    if (!parsed.REDIS_URL) {
      throw new Error('REDIS_URL is required in production');
    }
  }

  return {
    ...parsed,
    WORKER_CONCURRENCY: 1,
    DB_POOL_MAX: 1
  };
};

export const parseDatabaseEnv = (rawEnv: NodeJS.ProcessEnv) => {
  const parsed = databaseEnvSchema.parse(rawEnv);
  if (parsed.NODE_ENV === 'production' && !parsed.DATABASE_URL) {
    throw new Error('DATABASE_URL is required in production');
  }
  return {
    ...parsed,
    DB_POOL_MAX: 1
  };
};

export const parseMigrationEnv = (rawEnv: NodeJS.ProcessEnv) => {
  const parsed = migrationEnvSchema.parse(rawEnv);
  if (parsed.NODE_ENV === 'production' && !parsed.DATABASE_URL) {
    throw new Error('DATABASE_URL is required in production');
  }
  return {
    ...parsed,
    DB_POOL_MAX: 1
  };
};

export const parseWebEnv = (rawEnv: NodeJS.ProcessEnv) => {
  const parsed = webEnvSchema.parse(rawEnv);
  if (parsed.NODE_ENV === 'production' && !parsed.NEXT_PUBLIC_API_URL.startsWith('https://')) {
    throw new Error('NEXT_PUBLIC_API_URL must be a valid HTTPS URL in production');
  }
  return parsed;
};
