import { Module } from '@nestjs/common';
import { FlozController } from './floz.controller';
import { HealthController } from './health.controller';
import { FlozService } from './floz.service';
import { AuthService } from './auth';

@Module({ controllers: [HealthController, FlozController], providers: [AuthService, FlozService] })
export class AppModule {}
