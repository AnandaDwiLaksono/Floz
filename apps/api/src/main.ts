import 'reflect-metadata';
import { parseApiEnv } from '@floz/config';
import { createLogger } from '@floz/observability';
import cookieParser from 'cookie-parser';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ErrorFilter } from './error.filter';

async function bootstrap() {
  const env = parseApiEnv(process.env);
  const logger = createLogger('api', env.LOG_LEVEL);
  const app = await NestFactory.create(AppModule, { logger: false });
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new ErrorFilter());
  app.setGlobalPrefix('api/v1');
  await app.listen(env.API_PORT);
  logger.info({ port: env.API_PORT }, 'api started');
}

void bootstrap();
