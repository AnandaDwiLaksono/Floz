import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { normalizeOrigins, type NodeEnv } from '@floz/config';

@Injectable()
export class CookieOriginGuard implements CanActivate {
  private getAllowedOrigins(): string[] {
    const nodeEnv = (process.env.NODE_ENV ?? 'development') as NodeEnv;
    return normalizeOrigins(process.env, nodeEnv);
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const method = req.method?.toUpperCase();

    // GET, HEAD, OPTIONS are exempt from origin enforcement
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return true;
    }

    // Health probes are exempt
    const path = req.path || req.url || '';
    if (
      path === '/api/v1/health' ||
      path === '/api/v1/health/live' ||
      path === '/api/v1/health/ready' ||
      path === '/health'
    ) {
      return true;
    }

    // Every unsafe mutation requires an exact approved Origin
    const originHeader = req.headers['origin'];
    if (!originHeader || typeof originHeader !== 'string') {
      throw new ForbiddenException('FORBIDDEN');
    }

    const trimmedOrigin = originHeader.trim();
    if (!trimmedOrigin || trimmedOrigin === 'null' || trimmedOrigin === '*') {
      throw new ForbiddenException('FORBIDDEN');
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmedOrigin);
    } catch {
      throw new ForbiddenException('FORBIDDEN');
    }

    // Origins must not contain path components
    if (parsedUrl.pathname !== '' && parsedUrl.pathname !== '/') {
      throw new ForbiddenException('FORBIDDEN');
    }
    // Origins must not contain query or hash components
    if (parsedUrl.search || parsedUrl.hash) {
      throw new ForbiddenException('FORBIDDEN');
    }
    // Origins must not contain user credentials
    if (parsedUrl.username || parsedUrl.password) {
      throw new ForbiddenException('FORBIDDEN');
    }

    // Exact string match with url.origin (no trailing slash, normalized casing/port)
    if (trimmedOrigin !== parsedUrl.origin) {
      throw new ForbiddenException('FORBIDDEN');
    }

    const allowedOrigins = this.getAllowedOrigins();
    if (!allowedOrigins.includes(parsedUrl.origin)) {
      throw new ForbiddenException('FORBIDDEN');
    }

    return true;
  }
}
