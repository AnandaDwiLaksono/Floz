import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FlozController } from './floz.controller';
import { HealthController } from './health.controller';
import { NotificationController } from './notification.controller';
import { FlozService } from './floz.service';
import { AuthService } from './auth';
import { TaskService } from './task.service';
import { RecurrenceService } from './recurrence.service';
import { NotificationService } from './notification.service';
import { ApprovalService } from './approval.service';
import { CommentService } from './comment.service';
import { ReportingClock } from './reporting-clock';
import { WorkflowService } from './workflow.service';
import { CookieOriginGuard } from './cookie-origin.guard';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';

@Module({
  controllers: [HealthController, FlozController, NotificationController],
  providers: [
    AuthService,
    FlozService,
    TaskService,
    RecurrenceService,
    NotificationService,
    ApprovalService,
    CommentService,
    ReportingClock,
    WorkflowService,
    AuthRateLimitGuard,
    {
      provide: APP_GUARD,
      useClass: CookieOriginGuard
    }
  ]
})
export class AppModule {}
