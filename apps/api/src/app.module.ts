import { Module } from '@nestjs/common';
import { FlozController } from './floz.controller';
import { HealthController } from './health.controller';
import { FlozService } from './floz.service';
import { AuthService } from './auth';
import { TaskService } from './task.service';

@Module({ controllers: [HealthController, FlozController], providers: [AuthService, FlozService, TaskService] })
export class AppModule {}
