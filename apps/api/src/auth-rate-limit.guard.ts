import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleDestroy
} from '@nestjs/common';
import type { Request, Response } from 'express';

export interface RateLimitEntry {
  count: number;
  windowStart: number;
}

export type TimeProvider = () => number;

@Injectable()
export class AuthRateLimitGuard implements CanActivate, OnModuleDestroy {
  private readonly maxKeys = 10000;
  private readonly windowDurationMs = 60000;

  private get maxRequests(): number {
    if (process.env.NODE_ENV === 'test' && process.env.AUTH_RATE_LIMIT_MAX) {
      const parsed = Number(process.env.AUTH_RATE_LIMIT_MAX);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return 10;
  }
  private static readonly sharedMap = new Map<string, RateLimitEntry>();
  private readonly ipMap = AuthRateLimitGuard.sharedMap;
  private readonly sweepInterval: NodeJS.Timeout;
  private nowProvider: TimeProvider = () => Date.now();

  constructor() {
    this.sweepInterval = setInterval(() => {
      this.pruneExpired();
    }, 60000);
    if (this.sweepInterval.unref) {
      this.sweepInterval.unref();
    }
  }

  setTimeProvider(provider: TimeProvider) {
    this.nowProvider = provider;
  }

  reset() {
    this.ipMap.clear();
  }

  onModuleDestroy() {
    clearInterval(this.sweepInterval);
  }

  private pruneExpired(now: number = this.nowProvider()): void {
    for (const [ip, entry] of this.ipMap.entries()) {
      if (now >= entry.windowStart + this.windowDurationMs) {
        this.ipMap.delete(ip);
      }
    }
  }

  private normalizeIp(rawIp: string | undefined): string {
    if (!rawIp) return '127.0.0.1';
    let ip = rawIp.trim();
    if (ip.startsWith('::ffff:')) {
      ip = ip.substring(7);
    }
    return ip;
  }

  private isTrustedProxy(peerIp: string): boolean {
    const trustedEnv = process.env.TRUSTED_PROXY_IPS;
    if (trustedEnv) {
      const trustedList = trustedEnv.split(',').map((s) => this.normalizeIp(s));
      return trustedList.includes(peerIp);
    }
    return peerIp === '127.0.0.1' || peerIp === '::1';
  }

  private getClientIp(req: Request): string {
    const socketIp = this.normalizeIp(req.socket?.remoteAddress);

    if (this.isTrustedProxy(socketIp)) {
      const forwardedFor = req.headers['x-forwarded-for'];
      if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
        const parts = forwardedFor.split(',');
        const clientPart = parts[0].trim();
        if (clientPart) {
          return this.normalizeIp(clientPart);
        }
      }
    }

    return socketIp;
  }

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const now = this.nowProvider();
    const clientIp = this.getClientIp(req);

    let entry = this.ipMap.get(clientIp);
    if (entry && now >= entry.windowStart + this.windowDurationMs) {
      this.ipMap.delete(clientIp);
      entry = undefined;
    }

    if (!entry) {
      if (this.ipMap.size >= this.maxKeys) {
        this.pruneExpired(now);
      }

      if (this.ipMap.size >= this.maxKeys) {
        let earliestExpiry = now + this.windowDurationMs;
        for (const e of this.ipMap.values()) {
          const exp = e.windowStart + this.windowDurationMs;
          if (exp < earliestExpiry) {
            earliestExpiry = exp;
          }
        }
        const remainingMs = Math.max(1, earliestExpiry - now);
        const retryAfter = Math.max(1, Math.ceil(remainingMs / 1000));
        res.setHeader('Retry-After', String(retryAfter));
        throw new HttpException(
          {
            error: {
              code: 'RATE_LIMITED',
              message: 'Too many requests.',
              details: []
            }
          },
          HttpStatus.TOO_MANY_REQUESTS
        );
      }

      entry = { count: 1, windowStart: now };
      this.ipMap.set(clientIp, entry);
      return true;
    }

    if (entry.count >= this.maxRequests) {
      const remainingMs = Math.max(1, entry.windowStart + this.windowDurationMs - now);
      const retryAfter = Math.max(1, Math.ceil(remainingMs / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      throw new HttpException(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests.',
            details: []
          }
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    entry.count += 1;
    return true;
  }
}
