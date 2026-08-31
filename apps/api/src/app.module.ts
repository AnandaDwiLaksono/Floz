import { Module } from '@nestjs/common';
import { FlozController } from './floz.controller';
import { HealthController } from './health.controller';
import { NotificationController } from './notification.controller';
import { FlozService } from './floz.service';
import { AuthService } from './auth';
import { TaskService } from './task.service';
import { RecurrenceService } from './recurrence.service';
import { NotificationService } from './notification.service';

@Module({ controllers: [HealthController, FlozController, NotificationController], providers: [AuthService, FlozService, TaskService, RecurrenceService, NotificationService] })
export class AppModule {}
