import { randomUUID } from 'node:crypto';
import pino, { type DestinationStream } from 'pino';

const REQUEST_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const SAFE_FIELDS = new Set(['requestId', 'jobId', 'workspaceId', 'entityId', 'service', 'method', 'route', 'statusCode', 'durationMs', 'event', 'port', 'concurrency', 'queue', 'err']);
const REDACT = [
  'req.headers.authorization', 'req.headers.cookie', 'req.headers["set-cookie"]', 'res.headers["set-cookie"]',
  'headers.authorization', 'headers.cookie', 'headers["set-cookie"]', 'password', 'current_password', 'new_password',
  'temporary_password', 'token', 'secret', 'session', 'credential', 'credentials', 'authorization', 'cookie', '["set-cookie"]',
  'data.password', 'data.temporary_password', 'body.password', 'body.currentPassword', 'body.newPassword',
  'err.message', 'err.stack', 'err.cause'
];

export const requestId = (value: string | string[] | undefined) =>
  typeof value === 'string' && REQUEST_ID.test(value) ? value : randomUUID();

export const sanitizeError = (error: unknown) => {
  const value = typeof error === 'object' && error !== null ? error as { name?: unknown; code?: unknown } : {};
  return {
    type: typeof value.name === 'string' && REQUEST_ID.test(value.name) ? value.name : 'Error',
    code: typeof value.code === 'string' && REQUEST_ID.test(value.code) ? value.code : 'INTERNAL_ERROR'
  };
};

const safe = (value: unknown) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => SAFE_FIELDS.has(key))
    .map(([key, entry]) => [key, key === 'err' ? sanitizeError(entry) : entry]));
};

export const createLogger = (service: string, level = 'info', destination?: DestinationStream) => pino({
  level,
  base: { service },
  redact: { paths: REDACT, censor: '[REDACTED]' },
  hooks: { logMethod(args, method) { method.apply(this, args.map(safe) as Parameters<typeof method>); } }
}, destination);
