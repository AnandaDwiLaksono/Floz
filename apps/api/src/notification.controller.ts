import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth';
import { FlozService } from './floz.service';
import { NotificationService } from './notification.service';
import {
  ListNotificationsQueryDto,
  PatchNotificationDto,
  validateListNotificationsQuery,
  validatePatchNotification,
} from './notification.dto';

@Controller('workspaces/:workspaceId/notifications')
export class NotificationController {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(FlozService) private readonly floz: FlozService,
    @Inject(NotificationService) private readonly notifications: NotificationService
  ) {}

  private get auth() {
    return this.authService.auth;
  }

  @Get()
  async list(
    @Req() req: Request,
    @Param('workspaceId') workspaceId: string,
    @Query() query: ListNotificationsQueryDto
  ) {
    const ctx = await this.member(req, workspaceId);
    let validatedQuery;
    try {
      validatedQuery = validateListNotificationsQuery(query);
    } catch (e) {
      throw new BadRequestException('VALIDATION_ERROR');
    }
    return this.notifications.listNotifications(workspaceId, ctx.user.id, validatedQuery);
  }

  @Get('unread-count')
  async getUnreadCount(
    @Req() req: Request,
    @Param('workspaceId') workspaceId: string
  ) {
    const ctx = await this.member(req, workspaceId);
    return this.notifications.getUnreadCount(workspaceId, ctx.user.id);
  }

  @Patch(':notificationId')
  async markRead(
    @Req() req: Request,
    @Param('workspaceId') workspaceId: string,
    @Param('notificationId') notificationId: string,
    @Body() body: PatchNotificationDto
  ) {
    const ctx = await this.member(req, workspaceId);
    try {
      validatePatchNotification(body);
    } catch (e) {
      throw new BadRequestException('VALIDATION_ERROR');
    }
    return this.notifications.markRead(workspaceId, ctx.user.id, notificationId);
  }

  @Post('mark-all-read')
  @HttpCode(200)
  async markAllRead(
    @Req() req: Request,
    @Param('workspaceId') workspaceId: string
  ) {
    const ctx = await this.member(req, workspaceId);
    return this.notifications.markAllRead(workspaceId, ctx.user.id);
  }

  private async current(req: Request) {
    const session = await this.auth.api.getSession({
      headers: req.headers as HeadersInit,
    });
    if (!session) throw new UnauthorizedException('UNAUTHENTICATED');
    const user = await this.floz.user(session.user.id);
    if (!user) throw new UnauthorizedException('UNAUTHENTICATED');
    if (!user.isActive) throw new ForbiddenException('ACCOUNT_INACTIVE');
    return user;
  }

  private async member(req: Request, wid: string) {
    const user = await this.current(req);
    const membership = await this.floz.membership(user.id, wid);
    if (!membership) throw new NotFoundException('NOT_FOUND');
    return { user, membership };
  }
}
