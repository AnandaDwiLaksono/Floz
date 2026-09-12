import { ValidationPipe, type INestApplication } from '@nestjs/common';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import express from 'express';
import { normalizeOrigins, type NodeEnv } from '@floz/config';
import { ErrorFilter } from './error.filter.js';

export function configureApp(app: INestApplication) {
  const nodeEnv = (process.env.NODE_ENV ?? 'development') as NodeEnv;
  const allowedOrigins = normalizeOrigins(process.env, nodeEnv);

  const expressApp = app.getHttpAdapter().getInstance();
  if (expressApp && typeof expressApp.disable === 'function') {
    expressApp.disable('x-powered-by');
  }

  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, false);
        let parsed: URL;
        try {
          parsed = new URL(origin);
        } catch {
          return callback(null, false);
        }
        if (parsed.origin === origin && allowedOrigins.includes(origin)) {
          return callback(null, origin);
        }
        return callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Idempotency-Key', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'Retry-After'],
      optionsSuccessStatus: 204
    })
  );

  app.use(cookieParser());

  app.use(express.json({ limit: 1048576 }));
  app.use(express.urlencoded({ limit: 1048576, extended: true }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false }
    })
  );

  app.useGlobalFilters(new ErrorFilter());

  app.setGlobalPrefix('api/v1');
}
