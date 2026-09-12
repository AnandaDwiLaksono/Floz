import { requestId } from '@floz/observability';
import type { NextFunction, Request, Response } from 'express';

type Logger = { info(object: object, message?: string): unknown };

export const requestDiagnostics = (logger: Logger, now = Date.now) => (req: Request, res: Response, next: NextFunction) => {
  const values = req.rawHeaders.reduce<string[]>((found, value, index, headers) =>
    index % 2 === 0 && value.toLowerCase() === 'x-request-id' ? [...found, headers[index + 1] ?? ''] : found, []);
  const id = requestId(values.length === 1 ? values[0] : undefined);
  res.setHeader('X-Request-Id', id);
  if (req.path.startsWith('/api/v1/health')) return next();

  const started = now();
  let logged = false;
  const log = (event: 'request.completed' | 'request.aborted') => {
    if (logged) return;
    logged = true;
    const route = typeof req.route?.path === 'string' && event === 'request.completed' ? req.route.path : '[unmatched]';
    logger.info({ requestId: id, method: req.method, route, statusCode: res.statusCode, durationMs: now() - started, event });
  };
  res.once('finish', () => log('request.completed'));
  res.once('close', () => log('request.aborted'));
  next();
};
