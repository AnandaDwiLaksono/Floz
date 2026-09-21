import { randomBytes } from 'node:crypto';
import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Put, Query, Req, Res, UnauthorizedException, UseGuards, ValidationPipe } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.js';
import { AuthRateLimitGuard } from './auth-rate-limit.guard.js';
import { FlozService } from './floz.service.js';
import { TaskService, AssignTaskDto, type CalendarQueryDto, CreateTaskDto, type KanbanQueryDto, type TaskQueryDto, TransitionTaskDto, UpdateTaskDto } from './task.service.js';
import type { TaskRole } from './task.policy.js';
import { RecurrenceService } from './recurrence.service.js';
import { CreateRecurringTaskDto, RecurrenceRuleQueryDto, UpdateRecurrenceRuleDto, validateCreateRecurringTask, validateRecurrenceRuleQuery, validateUpdateRecurrenceRule } from './recurrence.dto.js';
import { ApprovalService } from './approval.service.js';
import { CreateApprovalRequestDto, ApprovalQueryDto, ApproveStepDto, RejectStepDto, CancelApprovalDto } from './approval.dto.js';
import { CommentService } from './comment.service.js';
import { CreateCommentDto, type CommentQueryDto } from './comment.dto.js';
import { WorkflowService } from './workflow.service.js';
import {
  ArchiveStatusDto,
  ArchiveWorkflowDto,
  CreateStatusDto,
  CreateWorkflowDto,
  ReorderStatusesDto,
  ReplaceTransitionsDto,
  RestoreStatusDto,
  RestoreWorkflowDto,
  SetStatusInitialDto,
  SetWorkflowDefaultDto,
  UpdateStatusDto,
  UpdateWorkflowDto
} from './workflow.dto.js';
import {
  AcceptInvitationDto,
  AddMemberDto,
  AddTeamMemberDto,
  ChangePasswordDto,
  CreateInvitationDto,
  CreateTeamDto,
  CreateWorkspaceDto,
  JoinPreviewDto,
  LoginDto,
  PatchJoinSettingsDto,
  PatchMemberDto,
  PatchWorkspaceDto,
  PreviewInvitationDto,
  ProvisionAccountDto,
  RegisterDto,
  ResendVerificationDto,
  UpdateMeDto,
  UpdateTeamDto,
  ValidatedBody,
  ValidatedQuery,
  WorkspaceJoinDto
} from './ingress.dto.js';
import { getKpis, getManagerDashboard, getMemberDashboard, getMyWorkSummary, parseReportingDate, parseReportingInterval, type ReportingScope } from '@floz/database';
import { ReportingClock } from './reporting-clock';
import { createEmailAdapter } from './email-adapter.js';
import { InvitationService } from './invitation.service.js';
import { JoinCodeService } from './join-code.service.js';
import { JoinRequestService } from './join-request.service.js';

const ok = <T>(data: T) => ({ data });
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const localePattern = /^(id-ID|en-US)$/;
const urlPattern = /^https?:\/\/.+/i;

@Controller()
export class FlozController {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(FlozService) private readonly floz: FlozService,
    @Inject(TaskService) private readonly tasks: TaskService,
    @Inject(RecurrenceService) private readonly recurrence: RecurrenceService,
    @Inject(ApprovalService) private readonly approvals: ApprovalService,
    @Inject(CommentService) private readonly comments: CommentService,
    @Inject(ReportingClock) private readonly clock: ReportingClock,
    @Inject(WorkflowService) private readonly workflowService: WorkflowService,
    @Inject(InvitationService) private readonly invitationService: InvitationService,
    @Inject(JoinCodeService) private readonly joinCodeService: JoinCodeService,
    @Inject(JoinRequestService) private readonly joinRequestService: JoinRequestService
  ) {}

  private get auth() { return this.authService.auth; }
  private get flozServiceSql() { return this.authService.database.sql; }

  @Post('auth/register')
  @UseGuards(AuthRateLimitGuard)
  @HttpCode(202)
  async register(
    @Body(
      new ValidationPipe({
        expectedType: RegisterDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false }
      })
    )
    body: RegisterDto
  ) {
    if (!body.email || !body.password || !body.full_name?.trim()) throw new BadRequestException('VALIDATION_ERROR');
    const existing = await this.floz.userByEmail(body.email);
    if (existing) throw new ConflictException('ACCOUNT_EXISTS');

    const result = await this.auth.api.signUpEmail({
      body: {
        email: body.email.toLowerCase().trim(),
        password: body.password,
        name: body.full_name.trim()
      }
    });
    if (!result.user?.id) throw new BadRequestException('VALIDATION_ERROR');

    // Create verification token in verifications table & send email
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
    await this.flozServiceSql`INSERT INTO verifications (id, identifier, value, expires_at) VALUES (${randomBytes(16).toString('hex')}, ${body.email.toLowerCase().trim()}, ${token}, ${expiresAt})`;

    const emailAdapter = createEmailAdapter();
    const verifyUrl = `${process.env.APP_URL || 'http://localhost:3000'}/verify-email?token=${token}&email=${encodeURIComponent(body.email.toLowerCase().trim())}`;
    await emailAdapter.sendEmail({
      to: body.email.toLowerCase().trim(),
      subject: 'Verify your Floz account',
      html: `<p>Welcome to Floz! Click the link below to verify your email:</p><p><a href="${verifyUrl}">Verify Email</a></p>`,
      text: `Welcome to Floz! Verify your email at: ${verifyUrl}`
    });

    return ok({ registration_status: 'VERIFICATION_REQUIRED' });
  }

  @Post('auth/verification/resend')
  @UseGuards(AuthRateLimitGuard)
  @HttpCode(202)
  async resendVerification(
    @Body(
      new ValidationPipe({
        expectedType: ResendVerificationDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false }
      })
    )
    body: ResendVerificationDto
  ) {
    if (!body.email) throw new BadRequestException('VALIDATION_ERROR');
    const user = await this.floz.userByEmail(body.email);
    if (user && !user.emailVerified) {
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await this.flozServiceSql`INSERT INTO verifications (id, identifier, value, expires_at) VALUES (${randomBytes(16).toString('hex')}, ${body.email.toLowerCase().trim()}, ${token}, ${expiresAt})`;
      const emailAdapter = createEmailAdapter();
      const verifyUrl = `${process.env.APP_URL || 'http://localhost:3000'}/verify-email?token=${token}&email=${encodeURIComponent(body.email.toLowerCase().trim())}`;
      await emailAdapter.sendEmail({
        to: body.email.toLowerCase().trim(),
        subject: 'Verify your Floz account',
        html: `<p>Click the link below to verify your email:</p><p><a href="${verifyUrl}">Verify Email</a></p>`,
        text: `Verify your email at: ${verifyUrl}`
      });
    }
    return ok({ status: 'ACCEPTED' });
  }

  @Post('auth/verify-email')
  @HttpCode(200)
  async verifyEmail(@Body() body: { token?: string; email?: string }) {
    if (!body.token || !body.email) throw new BadRequestException('VALIDATION_ERROR');
    const verification = (await this.flozServiceSql<{ id: string; expires_at: Date }[]>`SELECT id, expires_at FROM verifications WHERE identifier = ${body.email.toLowerCase().trim()} AND value = ${body.token} LIMIT 1`)[0];
    if (!verification) throw new BadRequestException('VERIFICATION_INVALID');
    if (new Date(verification.expires_at) < new Date()) throw new BadRequestException('VERIFICATION_EXPIRED');

    await this.flozServiceSql`UPDATE users SET email_verified = true, updated_at = NOW() WHERE lower(email) = ${body.email.toLowerCase().trim()}`;
    await this.flozServiceSql`DELETE FROM verifications WHERE id = ${verification.id}`;
    return ok({ verified: true });
  }

  @Post('auth/login')
  @UseGuards(AuthRateLimitGuard)
  @HttpCode(200)
  async login(
    @Body(
      new ValidationPipe({
        expectedType: LoginDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false }
      })
    )
    body: LoginDto,
    @Res({ passthrough: true }) res: Response
  ) {
    if (!body.email || !body.password) throw new BadRequestException('VALIDATION_ERROR');
    const result = await this.auth.api.signInEmail({ body: { email: body.email, password: body.password }, asResponse: true });
    if (!result.ok) throw new UnauthorizedException('INVALID_CREDENTIALS');
    const setCookies = result.headers?.getSetCookie ? result.headers.getSetCookie() : [result.headers.get('set-cookie')].filter(Boolean);
    if (setCookies && setCookies.length > 0) res.setHeader('set-cookie', setCookies as string[]);
    const session = await result.json() as { user: { id: string } };
    const user = await this.floz.user(session.user.id);
    if (!user) throw new UnauthorizedException('INVALID_CREDENTIALS');
    return ok({ user: this.publicUser(user) });
  }

  @Post('workspaces')
  @HttpCode(201)
  async createWorkspace(
    @Req() req: Request,
    @Body(
      new ValidationPipe({
        expectedType: CreateWorkspaceDto,
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false }
      })
    )
    body: CreateWorkspaceDto
  ) {
    const user = await this.current(req);
    if (!user) throw new UnauthorizedException('UNAUTHENTICATED');
    if (!body.name?.trim()) throw new BadRequestException('VALIDATION_ERROR');
    const ws = await this.floz.createWorkspace(user.id, { name: body.name.trim(), timezone: body.timezone });
    return ok(ws);
  }

  @Get('workspaces/:workspaceId/invitations')
  async listInvitations(@Req() req: Request, @Param('workspaceId') wid: string) {
    await this.admin(req, wid);
    const list = await this.invitationService.listInvitations(wid);
    return ok(list);
  }

  @Post('workspaces/:workspaceId/invitations')
  @HttpCode(201)
  async createInvitation(@Req() req: Request, @Param('workspaceId') wid: string, @Body() body: CreateInvitationDto) {
    const { user } = await this.admin(req, wid);
    if (!body.email || !body.role) throw new BadRequestException('VALIDATION_ERROR');
    const result = await this.invitationService.createInvitation(wid, user.id, body.email, body.role);
    return ok(result);
  }

  @Post('workspaces/:workspaceId/invitations/:invitationId/resend')
  async resendInvitation(@Req() req: Request, @Param('workspaceId') wid: string, @Param('invitationId') invId: string) {
    await this.admin(req, wid);
    const result = await this.invitationService.resendInvitation(wid, invId);
    return ok(result);
  }

  @Post('workspaces/:workspaceId/invitations/:invitationId/revoke')
  async revokeInvitation(@Req() req: Request, @Param('workspaceId') wid: string, @Param('invitationId') invId: string) {
    await this.admin(req, wid);
    const result = await this.invitationService.revokeInvitation(wid, invId);
    return ok(result);
  }

  @Post('workspace-invitations/preview')
  async previewInvitation(@Body() body: PreviewInvitationDto) {
    if (!body.token) throw new BadRequestException('VALIDATION_ERROR');
    const result = await this.invitationService.previewInvitation(body.token);
    return ok(result);
  }

  @Post('workspace-invitations/accept')
  async acceptInvitation(@Req() req: Request, @Body() body: AcceptInvitationDto) {
    const user = await this.current(req);
    if (!user) throw new UnauthorizedException('UNAUTHENTICATED');
    if (!body.token) throw new BadRequestException('VALIDATION_ERROR');
    const result = await this.invitationService.acceptInvitation(body.token, user.id);
    return ok(result);
  }

  @Post('workspace-invitations/decline')
  async declineInvitation(@Req() req: Request, @Body() body: AcceptInvitationDto) {
    const user = await this.current(req);
    if (!user) throw new UnauthorizedException('UNAUTHENTICATED');
    if (!body.token) throw new BadRequestException('VALIDATION_ERROR');
    const result = await this.invitationService.declineInvitation(body.token);
    return ok(result);
  }

  @Get('me/workspace-invitations')
  async myInvitations(@Req() req: Request) {
    const user = await this.current(req);
    if (!user) throw new UnauthorizedException('UNAUTHENTICATED');
    const list = await this.invitationService.listPendingForEmail(user.email);
    return ok(list);
  }

  @Get('workspaces/:workspaceId/join-settings')
  async getJoinSettings(@Req() req: Request, @Param('workspaceId') wid: string) {
    await this.admin(req, wid);
    const settings = await this.joinCodeService.getJoinSettings(wid);
    return ok(settings);
  }

  @Patch('workspaces/:workspaceId/join-settings')
  async patchJoinSettings(@Req() req: Request, @Param('workspaceId') wid: string, @Body() body: PatchJoinSettingsDto) {
    await this.admin(req, wid);
    if (!body.join_policy) throw new BadRequestException('VALIDATION_ERROR');
    const updated = await this.joinCodeService.updateJoinSettings(wid, body.join_policy);
    return ok(updated);
  }

  @Post('workspaces/:workspaceId/join-code')
  async generateJoinCode(@Req() req: Request, @Param('workspaceId') wid: string, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    const { user } = await this.admin(req, wid);
    const result = await this.joinCodeService.generateOrRotateCode(wid, user.id);
    return ok(result);
  }

  @Delete('workspaces/:workspaceId/join-code')
  async revokeJoinCode(@Req() req: Request, @Param('workspaceId') wid: string) {
    await this.admin(req, wid);
    const result = await this.joinCodeService.revokeCode(wid);
    return ok(result);
  }

  @Post('workspace-joins/preview')
  async previewJoin(@Body() body: JoinPreviewDto) {
    if (body.join_code) {
      const res = await this.joinCodeService.previewByCode(body.join_code);
      return ok(res);
    }
    if (body.workspace_id) {
      const ws = (await this.flozServiceSql<{ id: string; name: string; joinPolicy: string }[]>`
        SELECT id, name, join_policy AS "joinPolicy" FROM workspaces WHERE id = ${body.workspace_id} AND is_active = true LIMIT 1
      `)[0];
      if (!ws) throw new NotFoundException('WORKSPACE_NOT_FOUND');
      return ok({
        workspace_id: ws.id,
        workspace_name: ws.name,
        join_policy: ws.joinPolicy,
        action: ws.joinPolicy === 'APPROVAL_REQUIRED' ? 'REQUEST_APPROVAL' : ws.joinPolicy === 'JOIN_CODE' ? 'JOIN_CODE_REQUIRED' : 'INVITATION_REQUIRED'
      });
    }
    throw new BadRequestException('VALIDATION_ERROR');
  }

  @Post('workspace-joins')
  @HttpCode(201)
  async joinWorkspace(@Req() req: Request, @Body() body: WorkspaceJoinDto) {
    const user = await this.current(req);
    if (!user) throw new UnauthorizedException('UNAUTHENTICATED');
    if (body.join_code) {
      const res = await this.joinCodeService.joinByCode(body.join_code, user.id);
      return ok(res);
    }
    if (body.workspace_id) {
      const res = await this.joinRequestService.submitRequest(body.workspace_id, user.id);
      return ok(res);
    }
    throw new BadRequestException('VALIDATION_ERROR');
  }

  @Get('me/workspace-join-requests')
  async myJoinRequests(@Req() req: Request) {
    const user = await this.current(req);
    if (!user) throw new UnauthorizedException('UNAUTHENTICATED');
    const list = await this.joinRequestService.listUserRequests(user.id);
    return ok(list);
  }

  @Post('workspace-join-requests/:requestId/cancel')
  async cancelJoinRequest(@Req() req: Request, @Param('requestId') reqId: string) {
    const user = await this.current(req);
    if (!user) throw new UnauthorizedException('UNAUTHENTICATED');
    const res = await this.joinRequestService.cancelRequest(reqId, user.id);
    return ok(res);
  }

  @Get('workspaces/:workspaceId/join-requests')
  async listJoinRequests(@Req() req: Request, @Param('workspaceId') wid: string) {
    await this.admin(req, wid);
    const list = await this.joinRequestService.listWorkspaceRequests(wid);
    return ok(list);
  }

  @Post('workspaces/:workspaceId/join-requests/:requestId/approve')
  async approveJoinRequest(@Req() req: Request, @Param('workspaceId') wid: string, @Param('requestId') reqId: string) {
    const { user } = await this.admin(req, wid);
    const res = await this.joinRequestService.approveRequest(wid, reqId, user.id);
    return ok(res);
  }

  @Post('workspaces/:workspaceId/join-requests/:requestId/reject')
  async rejectJoinRequest(@Req() req: Request, @Param('workspaceId') wid: string, @Param('requestId') reqId: string) {
    const { user } = await this.admin(req, wid);
    const res = await this.joinRequestService.rejectRequest(wid, reqId, user.id);
    return ok(res);
  }

  @Post('workspaces/:workspaceId/accounts')
  @UseGuards(AuthRateLimitGuard)
  async provisionAccount(@Req() req: Request, @Param('workspaceId') wid: string, @Body() body: ProvisionAccountDto, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    await this.admin(req, wid);
    if (!body.email || !body.full_name?.trim()) throw new BadRequestException('VALIDATION_ERROR');
    const existing = await this.floz.userByEmail(body.email);
    if (existing) throw new ConflictException('DUPLICATE_EMAIL');
    const temporaryPassword = randomBytes(24).toString('base64url');
    const result = await this.auth.api.signUpEmail({ body: { email: body.email, password: temporaryPassword, name: body.full_name.trim() } });
    if (!result.user?.id || result.token) throw new BadRequestException('VALIDATION_ERROR');
    const user = await this.floz.user(result.user.id);
    if (!user) throw new BadRequestException('VALIDATION_ERROR');
    return ok({ user: this.publicUser(user), temporary_password: temporaryPassword });
  }

  @Post('auth/logout')
  @UseGuards(AuthRateLimitGuard)
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    let result: globalThis.Response;
    try {
      result = await this.auth.api.signOut({ headers: req.headers as HeadersInit, asResponse: true });
    } catch {
      throw new UnauthorizedException('UNAUTHENTICATED');
    }
    if (!result.ok) throw new UnauthorizedException('UNAUTHENTICATED');
    const setCookies = result.headers.getSetCookie();
    if (setCookies.length > 0) res.setHeader('set-cookie', setCookies);
  }

  @Get('me')
  async me(@Req() req: Request) { const user = await this.current(req); return ok({ ...this.publicUser(user), workspaces: (await this.floz.workspacesFor(user.id)).map((w) => ({ id: w.id, name: w.name, role: w.role, membership_status: w.membershipStatus })) }); }
  @Patch('me')
  async updateMe(@Req() req: Request, @Body() body: UpdateMeDto) {
    const user = await this.current(req);
    if (body.full_name !== undefined && !body.full_name.trim()) throw new BadRequestException('VALIDATION_ERROR');
    if (body.timezone !== undefined) try { new Intl.DateTimeFormat('en-US', { timeZone: body.timezone }); } catch { throw new BadRequestException('VALIDATION_ERROR'); }
    if (body.locale !== undefined && !localePattern.test(body.locale)) throw new BadRequestException('VALIDATION_ERROR');
    if (body.avatar_url !== undefined && body.avatar_url !== null && !urlPattern.test(body.avatar_url)) throw new BadRequestException('VALIDATION_ERROR');
    const updated = await this.floz.updateUser(user.id, { name: body.full_name?.trim(), timezone: body.timezone, locale: body.locale, image: body.avatar_url });
    return ok({ ...this.publicUser(updated ?? user), workspaces: (await this.floz.workspacesFor(user.id)).map((w) => ({ id: w.id, name: w.name, role: w.role, membership_status: w.membershipStatus })) });
  }
  @Patch('me/password')
  @UseGuards(AuthRateLimitGuard)
  @HttpCode(204)
  async changePassword(@Req() req: Request, @Body() body: ChangePasswordDto) {
    await this.current(req);
    if (!body.current_password || !body.new_password) throw new BadRequestException('VALIDATION_ERROR');
    const result = await this.auth.api.changePassword({ headers: req.headers as HeadersInit, body: { currentPassword: body.current_password, newPassword: body.new_password, revokeOtherSessions: false }, asResponse: true });
    if (!result.ok) throw new UnauthorizedException('INVALID_CREDENTIALS');
    const revoked = await this.auth.api.revokeOtherSessions({ headers: req.headers as HeadersInit, asResponse: true });
    if (!revoked.ok) throw new UnauthorizedException('INVALID_CREDENTIALS');
  }
  @Get('workspaces')
  async listWorkspaces(@Req() req: Request) { const user = await this.current(req); return ok((await this.floz.workspacesFor(user.id, true)).map((w) => ({ id: w.id, name: w.name, slug: w.slug, timezone: w.timezone, role: w.role, membership_status: w.membershipStatus }))); }
  @Get('workspaces/:workspaceId')
  async getWorkspace(@Req() req: Request, @Param('workspaceId') id: string) { await this.member(req, id); const w = await this.floz.workspace(id); if (!w) throw new NotFoundException('NOT_FOUND'); return ok({ id: w.id, name: w.name, slug: w.slug, timezone: w.timezone }); }
  @Patch('workspaces/:workspaceId')
  async patchWorkspace(@Req() req: Request, @Param('workspaceId') id: string, @Body() body: PatchWorkspaceDto) { await this.admin(req, id); if (body.name !== undefined && !body.name.trim()) throw new BadRequestException('VALIDATION_ERROR'); if (body.timezone !== undefined) try { new Intl.DateTimeFormat('en-US', { timeZone: body.timezone }); } catch { throw new BadRequestException('VALIDATION_ERROR'); } return ok(await this.floz.patchWorkspace(id, { name: body.name?.trim(), timezone: body.timezone })); }
  @Get('workspaces/:workspaceId/members')
  async members(@Req() req: Request, @Param('workspaceId') id: string) { await this.member(req, id); return ok((await this.floz.members(id)).map(this.publicMember)); }
  @Get('workspaces/:workspaceId/users')
  async lookupUser(@Req() req: Request, @Param('workspaceId') id: string, @Query('email') email: string) { await this.admin(req, id); if (!email?.trim()) throw new BadRequestException('VALIDATION_ERROR'); const user = await this.floz.userByEmail(email.trim()); if (!user) throw new NotFoundException('NOT_FOUND'); return ok(this.publicUser(user)); }
  @Post('workspaces/:workspaceId/members')
  async addMember(@Req() req: Request, @Param('workspaceId') id: string, @Body() body: AddMemberDto) { await this.admin(req, id); if (!body.user_id || !body.role) throw new BadRequestException('VALIDATION_ERROR'); const member = await this.floz.addMember(id, { userId: body.user_id, role: body.role, status: body.status ?? 'INVITED' }); return ok(this.publicMember(member)); }
  @Patch('workspaces/:workspaceId/members/:userId')
  async patchMember(@Req() req: Request, @Param('workspaceId') id: string, @Param('userId') userId: string, @Body() body: PatchMemberDto) { await this.admin(req, id); if (body.role === undefined && body.status === undefined) throw new BadRequestException('VALIDATION_ERROR'); const member = await this.floz.updateMember(id, userId, body); return ok(this.publicMember(member)); }
  @Get('workspaces/:workspaceId/teams')
  async teams(@Req() req: Request, @Param('workspaceId') id: string) { await this.member(req, id); return ok(await this.floz.listTeams(id)); }
  @Post('workspaces/:workspaceId/teams')
  async createTeam(@Req() req: Request, @Param('workspaceId') id: string, @Body() body: CreateTeamDto) { await this.admin(req, id); if (!body.name?.trim()) throw new BadRequestException('VALIDATION_ERROR'); if (body.manager_user_id && !(await this.floz.managerMembership(body.manager_user_id, id)).length) throw new BadRequestException('INVALID_MANAGER'); return ok(await this.floz.createTeam(id, { name: body.name, description: body.description ?? null, managerUserId: body.manager_user_id ?? null })); }
  @Get('workspaces/:workspaceId/teams/:teamId')
  async getTeam(@Req() req: Request, @Param('workspaceId') wid: string, @Param('teamId') tid: string) { await this.member(req, wid); const team = await this.floz.team(wid, tid); if (!team) throw new NotFoundException('NOT_FOUND'); return ok(team); }
  @Patch('workspaces/:workspaceId/teams/:teamId')
  async updateTeam(@Req() req: Request, @Param('workspaceId') wid: string, @Param('teamId') tid: string, @Body() body: UpdateTeamDto) { await this.admin(req, wid); const team = await this.floz.team(wid, tid); if (!team) throw new NotFoundException('NOT_FOUND'); if (body.name !== undefined && !body.name.trim()) throw new BadRequestException('VALIDATION_ERROR'); if (body.manager_user_id && !(await this.floz.managerMembership(body.manager_user_id, wid)).length) throw new BadRequestException('INVALID_MANAGER'); return ok(await this.floz.updateTeam(wid, tid, { name: body.name, description: body.description, managerUserId: body.manager_user_id, isActive: body.is_active })); }
  @Get('workspaces/:workspaceId/teams/:teamId/members')
  async teamMembers(@Req() req: Request, @Param('workspaceId') wid: string, @Param('teamId') tid: string) { await this.member(req, wid); if (!(await this.floz.team(wid, tid))) throw new NotFoundException('NOT_FOUND'); return ok((await this.floz.teamMembers(tid)).map((member) => ({ user_id: member.userId, membership_role: member.membershipRole }))); }
  @Post('workspaces/:workspaceId/teams/:teamId/members')
  async addTeamMember(@Req() req: Request, @Param('workspaceId') wid: string, @Param('teamId') tid: string, @Body() body: AddTeamMemberDto) { await this.admin(req, wid); const team = await this.floz.team(wid, tid); if (!team) throw new NotFoundException('NOT_FOUND'); if (!team.isActive) throw new ConflictException('TEAM_ARCHIVED'); if (!body.user_id || !(await this.floz.membership(body.user_id, wid))) throw new BadRequestException('CROSS_WORKSPACE_REFERENCE'); const member = await this.floz.addTeamMember(wid, tid, body.user_id); return ok({ user_id: member.userId, membership_role: member.membershipRole }); }
  @Delete('workspaces/:workspaceId/teams/:teamId/members/:userId')
  @HttpCode(204)
  async removeTeamMember(@Req() req: Request, @Param('workspaceId') wid: string, @Param('teamId') tid: string, @Param('userId') uid: string) { await this.admin(req, wid); if (!(await this.floz.team(wid, tid))) throw new NotFoundException('NOT_FOUND'); await this.floz.removeTeamMember(wid, tid, uid); }
  @Get('workspaces/:workspaceId/my-work')
  async myWork(@Req() req: Request, @Param('workspaceId') wid: string, @Query('date') date: string) { const ctx = await this.member(req, wid); const workspace = await this.floz.workspace(wid); try { parseReportingDate(date); } catch { throw new BadRequestException('VALIDATION_ERROR'); } if (!workspace) throw new BadRequestException('VALIDATION_ERROR'); return { data: await getMyWorkSummary(this.authService.database.db, { workspaceId: wid, userId: ctx.user.id, date, timezone: workspace.timezone }), meta: { date, timezone: workspace.timezone } }; }
  @Get('workspaces/:workspaceId/dashboard/member')
  async memberDashboard(@Req() req: Request, @Param('workspaceId') wid: string) { const ctx = await this.member(req, wid); const workspace = await this.floz.workspace(wid); const evaluationAt = this.clock.now(); return ok(await getMemberDashboard(this.authService.database.db, { workspaceId: wid, userId: ctx.user.id, period: 'MTD', evaluationAt, timezone: workspace!.timezone })); }
  @Get('workspaces/:workspaceId/dashboard/manager')
  async managerDashboard(@Req() req: Request, @Param('workspaceId') wid: string) {
    const ctx = await this.member(req, wid);
    if (!['MANAGER', 'ADMIN'].includes(ctx.membership.role)) throw new ForbiddenException('FORBIDDEN');
    const workspace = await this.floz.workspace(wid);
    const scope = this.reportingScope(req.query as Record<string, string>, wid, workspace!.timezone);
    if (req.query.team_id) {
      if (!uuidPattern.test(String(req.query.team_id))) throw new BadRequestException('VALIDATION_ERROR');
      const team = await this.floz.team(wid, String(req.query.team_id));
      if (!team || !team.isActive) throw new BadRequestException('TEAM_SCOPE_MISMATCH');
      if (ctx.membership.role === 'MANAGER' && team.manager_user_id !== ctx.user.id) throw new ForbiddenException('FORBIDDEN');
      scope.teamIds = [String(req.query.team_id)];
    }
    const dashboard = await getManagerDashboard(this.authService.database.db, { ...scope, userId: ctx.user.id });
    const view = ctx.membership.role === 'ADMIN' ? 'all' : 'managed';
    const teamParam = req.query.team_id ? `&team_id=${String(req.query.team_id)}` : '';
    const drilldown_url = `/workspaces/${wid}/approvals?view=${view}&status=PENDING${teamParam}`;
    return ok({ ...dashboard, drilldown_url });
  }
  @Get('workspaces/:workspaceId/reports/kpis')
  async kpis(@Req() req: Request, @Param('workspaceId') wid: string) { const ctx = await this.member(req, wid); const workspace = await this.floz.workspace(wid); const teamId = req.query.team_id ? String(req.query.team_id) : undefined; if (teamId && !uuidPattern.test(teamId)) throw new BadRequestException('VALIDATION_ERROR'); const team = teamId ? await this.floz.team(wid, teamId) : null; if (teamId && (!team || !team.isActive)) throw new BadRequestException('TEAM_SCOPE_MISMATCH'); const scope = this.reportingScope(req.query as Record<string, string>, wid, workspace!.timezone); if (['MEMBER', 'FIELD_WORKER'].includes(ctx.membership.role)) scope.userId = ctx.user.id; else if (ctx.membership.role === 'MANAGER') { const managed = await this.floz.managedTeamIds(wid, ctx.user.id); if (teamId && !managed.includes(teamId)) throw new ForbiddenException('FORBIDDEN'); scope.teamIds = teamId ? [teamId] : managed; } else if (teamId) scope.teamIds = [teamId]; if (req.query.assignee_id) { const assigneeId = String(req.query.assignee_id); if (!uuidPattern.test(assigneeId)) throw new BadRequestException('VALIDATION_ERROR'); if (ctx.membership.role !== 'ADMIN' && assigneeId !== ctx.user.id) throw new ForbiddenException('FORBIDDEN'); if (!(await this.floz.membership(assigneeId, wid))) throw new BadRequestException('CROSS_WORKSPACE_REFERENCE'); scope.userId = assigneeId; } return ok(await getKpis(this.authService.database.db, scope)); }

  @Get('workspaces/:workspaceId/workflows')
  async workflows(@Req() req: Request, @Param('workspaceId') wid: string) {
    await this.member(req, wid);
    const includeArchived = req.query.include_archived === 'true';
    return ok(await this.workflowService.list(wid, includeArchived));
  }

  @Get('workspaces/:workspaceId/workflows/:workflowId')
  async workflowDetail(@Req() req: Request, @Param('workspaceId') wid: string, @Param('workflowId') workflowId: string) {
    await this.member(req, wid);
    return ok(await this.workflowService.detail(wid, workflowId));
  }

  @Post('workspaces/:workspaceId/workflows')
  async createWorkflow(@Req() req: Request, @Param('workspaceId') wid: string, @ValidatedBody(CreateWorkflowDto) body: CreateWorkflowDto) {
    const ctx = await this.admin(req, wid);
    return ok(await this.workflowService.create(wid, ctx.user.id, body));
  }

  @Patch('workspaces/:workspaceId/workflows/:workflowId')
  async updateWorkflow(@Req() req: Request, @Param('workspaceId') wid: string, @Param('workflowId') workflowId: string, @ValidatedBody(UpdateWorkflowDto) body: UpdateWorkflowDto) {
    await this.admin(req, wid);
    return ok(await this.workflowService.update(wid, workflowId, body));
  }

  @Post('workspaces/:workspaceId/workflows/:workflowId/set-default')
  @HttpCode(200)
  async setDefaultWorkflow(@Req() req: Request, @Param('workspaceId') wid: string, @Param('workflowId') workflowId: string, @ValidatedBody(SetWorkflowDefaultDto) body: SetWorkflowDefaultDto) {
    await this.admin(req, wid);
    return ok(await this.workflowService.setDefault(wid, workflowId, body));
  }

  @Post('workspaces/:workspaceId/workflows/:workflowId/archive')
  @HttpCode(200)
  async archiveWorkflow(@Req() req: Request, @Param('workspaceId') wid: string, @Param('workflowId') workflowId: string, @ValidatedBody(ArchiveWorkflowDto) body: ArchiveWorkflowDto) {
    await this.admin(req, wid);
    return ok(await this.workflowService.archive(wid, workflowId, body));
  }

  @Post('workspaces/:workspaceId/workflows/:workflowId/restore')
  @HttpCode(200)
  async restoreWorkflow(@Req() req: Request, @Param('workspaceId') wid: string, @Param('workflowId') workflowId: string, @ValidatedBody(RestoreWorkflowDto) body: RestoreWorkflowDto) {
    await this.admin(req, wid);
    return ok(await this.workflowService.restore(wid, workflowId, body));
  }

  @Post('workspaces/:workspaceId/workflows/:workflowId/statuses')
  async addWorkflowStatus(@Req() req: Request, @Param('workspaceId') wid: string, @Param('workflowId') workflowId: string, @ValidatedBody(CreateStatusDto) body: CreateStatusDto) {
    await this.admin(req, wid);
    return ok(await this.workflowService.addStatus(wid, workflowId, body));
  }

  @Patch('workspaces/:workspaceId/workflows/:workflowId/statuses/:statusId')
  async updateWorkflowStatus(@Req() req: Request, @Param('workspaceId') wid: string, @Param('workflowId') workflowId: string, @Param('statusId') statusId: string, @ValidatedBody(UpdateStatusDto) body: UpdateStatusDto) {
    await this.admin(req, wid);
    return ok(await this.workflowService.updateStatus(wid, workflowId, statusId, body));
  }

  @Post('workspaces/:workspaceId/workflows/:workflowId/statuses/:statusId/set-initial')
  @HttpCode(200)
  async setInitialWorkflowStatus(@Req() req: Request, @Param('workspaceId') wid: string, @Param('workflowId') workflowId: string, @Param('statusId') statusId: string, @ValidatedBody(SetStatusInitialDto) body: SetStatusInitialDto) {
    await this.admin(req, wid);
    return ok(await this.workflowService.setInitialStatus(wid, workflowId, statusId, body));
  }

  @Post('workspaces/:workspaceId/workflows/:workflowId/statuses/:statusId/archive')
  @HttpCode(200)
  async archiveWorkflowStatus(@Req() req: Request, @Param('workspaceId') wid: string, @Param('workflowId') workflowId: string, @Param('statusId') statusId: string, @ValidatedBody(ArchiveStatusDto) body: ArchiveStatusDto) {
    await this.admin(req, wid);
    return ok(await this.workflowService.archiveStatus(wid, workflowId, statusId, body));
  }

  @Post('workspaces/:workspaceId/workflows/:workflowId/statuses/:statusId/restore')
  @HttpCode(200)
  async restoreWorkflowStatus(@Req() req: Request, @Param('workspaceId') wid: string, @Param('workflowId') workflowId: string, @Param('statusId') statusId: string, @ValidatedBody(RestoreStatusDto) body: RestoreStatusDto) {
    await this.admin(req, wid);
    return ok(await this.workflowService.restoreStatus(wid, workflowId, statusId, body));
  }

  @Put('workspaces/:workspaceId/workflows/:workflowId/statuses/reorder')
  @HttpCode(200)
  async reorderWorkflowStatuses(@Req() req: Request, @Param('workspaceId') wid: string, @Param('workflowId') workflowId: string, @ValidatedBody(ReorderStatusesDto) body: ReorderStatusesDto) {
    await this.admin(req, wid);
    return ok(await this.workflowService.reorderStatuses(wid, workflowId, body));
  }

  @Put('workspaces/:workspaceId/workflows/:workflowId/transitions')
  @HttpCode(200)
  async replaceWorkflowTransitions(@Req() req: Request, @Param('workspaceId') wid: string, @Param('workflowId') workflowId: string, @ValidatedBody(ReplaceTransitionsDto) body: ReplaceTransitionsDto) {
    await this.admin(req, wid);
    return ok(await this.workflowService.replaceTransitions(wid, workflowId, body));
  }
  @Get('workspaces/:workspaceId/kanban')
  async kanban(@Req() req: Request, @Param('workspaceId') wid: string) { await this.member(req, wid); return ok(await this.tasks.kanban(wid, req.query as KanbanQueryDto)); }
  @Get('workspaces/:workspaceId/calendar/tasks')
  async calendar(@Req() req: Request, @Param('workspaceId') wid: string) { await this.member(req, wid); return this.tasks.calendar(wid, req.query as CalendarQueryDto); }
  @Get('workspaces/:workspaceId/tasks')
  async listTasks(@Req() req: Request, @Param('workspaceId') wid: string) { await this.member(req, wid); const result = await this.tasks.list(wid, req.query as TaskQueryDto); return { data: result.rows, meta: { pagination: { limit: result.limit, next_cursor: result.nextCursor, has_more: result.hasMore } } }; }
  @Post('workspaces/:workspaceId/tasks')
  async createTask(@Req() req: Request, @Param('workspaceId') wid: string, @ValidatedBody(CreateTaskDto) body: CreateTaskDto) { const ctx = await this.member(req, wid); return ok(await this.tasks.create(wid, ctx.user.id, ctx.membership.role as TaskRole, body)); }
  @Get('workspaces/:workspaceId/tasks/:taskId')
  async task(@Req() req: Request, @Param('workspaceId') wid: string, @Param('taskId') tid: string) { await this.member(req, wid); return ok(await this.tasks.detail(wid, tid)); }
  @Patch('workspaces/:workspaceId/tasks/:taskId')
  async updateTask(@Req() req: Request, @Param('workspaceId') wid: string, @Param('taskId') tid: string, @ValidatedBody(UpdateTaskDto) body: UpdateTaskDto) { const ctx = await this.member(req, wid); return ok(await this.tasks.update(wid, ctx.user.id, ctx.membership.role as TaskRole, tid, body)); }
  @Post('workspaces/:workspaceId/tasks/:taskId/assignments')
  async assignTask(@Req() req: Request, @Param('workspaceId') wid: string, @Param('taskId') tid: string, @ValidatedBody(AssignTaskDto) body: AssignTaskDto) { const ctx = await this.member(req, wid); return ok(await this.tasks.assign(wid, ctx.user.id, ctx.membership.role as TaskRole, tid, body)); }
  @Delete('workspaces/:workspaceId/tasks/:taskId')
  @HttpCode(204)
  async deleteTask(@Req() req: Request, @Param('workspaceId') wid: string, @Param('taskId') tid: string) { const ctx = await this.member(req, wid); await this.tasks.remove(wid, ctx.membership.role as TaskRole, tid, Number(req.query.version)); }
  @Get('workspaces/:workspaceId/tasks/:taskId/available-transitions')
  async availableTransitions(@Req() req: Request, @Param('workspaceId') wid: string, @Param('taskId') tid: string) { await this.member(req, wid); return ok(await this.tasks.transitions(wid, tid)); }
  @Post('workspaces/:workspaceId/tasks/:taskId/transitions')
  async transitionTask(@Req() req: Request, @Param('workspaceId') wid: string, @Param('taskId') tid: string, @ValidatedBody(TransitionTaskDto) body: TransitionTaskDto) { const ctx = await this.member(req, wid); const task = await this.tasks.transition(wid, ctx.user.id, ctx.membership.role as TaskRole, tid, body); return { task, transition: { to_status_id: body.to_status_id } }; }
  @Get('workspaces/:workspaceId/tasks/:taskId/history')
  async taskHistory(@Req() req: Request, @Param('workspaceId') wid: string, @Param('taskId') tid: string) { await this.member(req, wid); return { data: await this.tasks.history(wid, tid), meta: { pagination: { limit: 50, next_cursor: null, has_more: false } } }; }

  @Post('workspaces/:workspaceId/recurring-tasks')
  async createRecurringTask(@Req() req: Request, @Param('workspaceId') wid: string, @ValidatedBody(CreateRecurringTaskDto) body: CreateRecurringTaskDto) { const ctx = await this.member(req, wid); try { validateCreateRecurringTask(body); } catch { throw new BadRequestException('VALIDATION_ERROR'); } return ok(await this.recurrence.create(wid, ctx.user.id, req.header('Idempotency-Key'), body)); }
  @Get('workspaces/:workspaceId/recurrence-rules')
  async listRecurrenceRules(@Req() req: Request, @Param('workspaceId') wid: string, @Query() query: RecurrenceRuleQueryDto) { await this.member(req, wid); try { validateRecurrenceRuleQuery(query); } catch { throw new BadRequestException('VALIDATION_ERROR'); } return this.recurrence.list(wid, query); }
  @Get('workspaces/:workspaceId/recurrence-rules/:id')
  async recurrenceRule(@Req() req: Request, @Param('workspaceId') wid: string, @Param('id') id: string) { await this.member(req, wid); if (!uuidPattern.test(id)) throw new BadRequestException('VALIDATION_ERROR'); return ok(await this.recurrence.get(wid, id)); }
  @Patch('workspaces/:workspaceId/recurrence-rules/:id')
  async updateRecurrenceRule(@Req() req: Request, @Param('workspaceId') wid: string, @Param('id') id: string, @ValidatedBody(UpdateRecurrenceRuleDto) body: UpdateRecurrenceRuleDto) { await this.member(req, wid); if (!uuidPattern.test(id)) throw new BadRequestException('VALIDATION_ERROR'); try { validateUpdateRecurrenceRule(body); } catch { throw new BadRequestException('VALIDATION_ERROR'); } return ok(await this.recurrence.update(wid, id, body)); }
  @Post('workspaces/:workspaceId/recurrence-rules/:id/stop')
  @HttpCode(200)
  async stopRecurrenceRule(@Req() req: Request, @Param('workspaceId') wid: string, @Param('id') id: string) { await this.member(req, wid); if (!uuidPattern.test(id)) throw new BadRequestException('VALIDATION_ERROR'); return ok(await this.recurrence.stop(wid, id)); }

  @Post('workspaces/:workspaceId/approval-requests')
  async createApprovalRequest(@Req() req: Request, @Param('workspaceId') wid: string, @ValidatedBody(CreateApprovalRequestDto) body: CreateApprovalRequestDto) {
    const ctx = await this.member(req, wid);
    return ok(await this.approvals.create(wid, ctx.user.id, body));
  }

  @Get('workspaces/:workspaceId/approval-requests')
  async listApprovalRequests(@Req() req: Request, @Param('workspaceId') wid: string, @ValidatedQuery(ApprovalQueryDto) query: ApprovalQueryDto) {
    const ctx = await this.member(req, wid);
    return this.approvals.list(wid, ctx.user.id, ctx.membership.role, query);
  }

  @Get('workspaces/:workspaceId/approval-requests/:approvalRequestId')
  async getApprovalRequest(@Req() req: Request, @Param('workspaceId') wid: string, @Param('approvalRequestId') id: string) {
    const ctx = await this.member(req, wid);
    return ok(await this.approvals.detail(wid, ctx.user.id, ctx.membership.role, id));
  }

  @Post('workspaces/:workspaceId/approval-requests/:approvalRequestId/steps/:stepId/approve')
  @HttpCode(200)
  async approveApprovalStep(@Req() req: Request, @Param('workspaceId') wid: string, @Param('approvalRequestId') reqId: string, @Param('stepId') stepId: string, @ValidatedBody(ApproveStepDto) body: ApproveStepDto) {
    const ctx = await this.member(req, wid);
    return ok(await this.approvals.approve(wid, ctx.user.id, ctx.membership.role, reqId, stepId, body));
  }

  @Post('workspaces/:workspaceId/approval-requests/:approvalRequestId/steps/:stepId/reject')
  @HttpCode(200)
  async rejectApprovalStep(@Req() req: Request, @Param('workspaceId') wid: string, @Param('approvalRequestId') reqId: string, @Param('stepId') stepId: string, @ValidatedBody(RejectStepDto) body: RejectStepDto) {
    const ctx = await this.member(req, wid);
    return ok(await this.approvals.reject(wid, ctx.user.id, ctx.membership.role, reqId, stepId, body));
  }

  @Post('workspaces/:workspaceId/approval-requests/:approvalRequestId/cancel')
  @HttpCode(200)
  async cancelApprovalRequest(@Req() req: Request, @Param('workspaceId') wid: string, @Param('approvalRequestId') reqId: string, @ValidatedBody(CancelApprovalDto) body: CancelApprovalDto) {
    const ctx = await this.member(req, wid);
    return ok(await this.approvals.cancel(wid, ctx.user.id, ctx.membership.role, reqId, body));
  }

  @Get('workspaces/:workspaceId/tasks/:taskId/comments')
  async listComments(@Req() req: Request, @Param('workspaceId') wid: string, @Param('taskId') tid: string) {
    const ctx = await this.member(req, wid);
    return this.comments.list(wid, ctx.user.id, tid, req.query as CommentQueryDto);
  }

  @Post('workspaces/:workspaceId/tasks/:taskId/comments')
  @HttpCode(201)
  async createComment(@Req() req: Request, @Param('workspaceId') wid: string, @Param('taskId') tid: string, @ValidatedBody(CreateCommentDto) body: CreateCommentDto) {
    const ctx = await this.member(req, wid);
    return ok(await this.comments.create(wid, ctx.user.id, tid, body));
  }

  @Delete('workspaces/:workspaceId/tasks/:taskId/comments/:commentId')
  @HttpCode(204)
  async deleteComment(@Req() req: Request, @Param('workspaceId') wid: string, @Param('taskId') tid: string, @Param('commentId') cid: string) {
    const ctx = await this.member(req, wid);
    await this.comments.delete(wid, ctx.user.id, ctx.membership.role, tid, cid);
  }

  private reportingScope(query: Record<string, string>, workspaceId: string, timezone: string): ReportingScope { const from = query.from, to = query.to, evaluationAt = this.clock.now(); try { parseReportingInterval({ from, to }); } catch { throw new BadRequestException('VALIDATION_ERROR'); } return { workspaceId, from, to, evaluationAt, timezone }; }
  private async current(req: Request) { const session = await this.auth.api.getSession({ headers: req.headers as HeadersInit }); if (!session) throw new UnauthorizedException('UNAUTHENTICATED'); const user = await this.floz.user(session.user.id); if (!user) throw new UnauthorizedException('UNAUTHENTICATED'); if (!user.isActive) throw new ForbiddenException('ACCOUNT_INACTIVE'); return user; }
  private async member(req: Request, wid: string) { const user = await this.current(req); const membership = await this.floz.membership(user.id, wid); if (!membership) throw new NotFoundException('NOT_FOUND'); return { user, membership }; }
  private async admin(req: Request, wid: string) { const ctx = await this.member(req, wid); if (ctx.membership.role !== 'ADMIN') throw new ForbiddenException('FORBIDDEN'); return ctx; }
  private publicUser(user: { id: string; email: string; name: string; image: string | null; timezone: string; locale: string; isActive: boolean }) { return { id: user.id, email: user.email, full_name: user.name, avatar_url: user.image, timezone: user.timezone, locale: user.locale, is_active: user.isActive }; }
  private publicMember(member: { userId: string; fullName: string; email: string; role: string; status: string; isActive?: boolean }) { return { user_id: member.userId, full_name: member.fullName, email: member.email, role: member.role, status: member.status, is_active: member.isActive ?? true }; }
}
