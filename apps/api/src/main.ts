import 'reflect-metadata';
import type { Server } from 'node:http';
import { parseApiEnv } from '@floz/config';
import { createLogger } from '@floz/observability';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';

async function bootstrap() {
  const env = parseApiEnv(process.env);
  const logger = createLogger('api', env.LOG_LEVEL);
  const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false });

  configureApp(app);

  const server = app.getHttpServer() as Server;
  if (server) {
    server.headersTimeout = 10000;
    server.requestTimeout = 30000;
    server.keepAliveTimeout = 5000;
  }

  await app.listen(env.API_PORT);
  logger.info({ port: env.API_PORT }, 'api started');
}

void bootstrap();
