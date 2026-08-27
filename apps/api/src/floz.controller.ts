import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth';
import { FlozService } from './floz.service';
import { TaskService, type AssignTaskDto, type CalendarQueryDto, type CreateTaskDto, type KanbanQueryDto, type TaskQueryDto, type TransitionTaskDto, type UpdateTaskDto } from './task.service';
import type { TaskRole } from './task.policy';

const ok = <T>(data: T) => ({ data });

@Controller()
export class FlozController {
  constructor(@Inject(AuthService) private readonly authService: AuthService, @Inject(FlozService) private readonly floz: FlozService, @Inject(TaskService) private readonly tasks: TaskService) {}

  private get auth() { return this.authService.auth; }

  @Post('auth/login')
  @HttpCode(200)
  async login(@Body() body: { email?: string; password?: string }, @Res({ passthrough: true }) res: Response) {
    if (!body.email || !body.password) throw new BadRequestException('VALIDATION_ERROR');
    const result = await this.auth.api.signInEmail({ body: { email: body.email, password: body.password }, asResponse: true });
    if (!result.ok) throw new UnauthorizedException('INVALID_CREDENTIALS');
    const setCookie = result.headers.get('set-cookie');
    if (setCookie) res.setHeader('set-cookie', setCookie);
    const session = await result.json() as { user: { id: string } };
    const user = await this.floz.user(session.user.id);
    if (!user) throw new UnauthorizedException('INVALID_CREDENTIALS');
    return ok({ user: this.publicUser(user) });
  }

  @Post('auth/logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.api.signOut({ headers: req.headers as HeadersInit, asResponse: true });
    const setCookie = result.headers.get('set-cookie');
    if (setCookie) res.setHeader('set-cookie', setCookie);
  }

  @Get('me')
  async me(@Req() req: Request) { const user = await this.current(req); return ok({ ...this.publicUser(user), workspaces: (await this.floz.workspacesFor(user.id)).map((w) => ({ id: w.id, name: w.name, role: w.role, membership_status: w.membershipStatus })) }); }
  @Get('workspaces')
  async listWorkspaces(@Req() req: Request) { const user = await this.current(req); return ok((await this.floz.workspacesFor(user.id, true)).map((w) => ({ id: w.id, name: w.name, slug: w.slug, timezone: w.timezone, role: w.role, membership_status: w.membershipStatus }))); }
  @Get('workspaces/:workspaceId')
  async getWorkspace(@Req() req: Request, @Param('workspaceId') id: string) { await this.member(req, id); const w = await this.floz.workspace(id); if (!w) throw new NotFoundException('NOT_FOUND'); return ok({ id: w.id, name: w.name, slug: w.slug, timezone: w.timezone }); }
  @Get('workspaces/:workspaceId/members')
  async members(@Req() req: Request, @Param('workspaceId') id: string) { await this.member(req, id); return ok(await this.floz.members(id)); }
  @Get('workspaces/:workspaceId/teams')
  async teams(@Req() req: Request, @Param('workspaceId') id: string) { await this.member(req, id); return ok(await this.floz.listTeams(id)); }
  @Post('workspaces/:workspaceId/teams')
  async createTeam(@Req() req: Request, @Param('workspaceId') id: string, @Body() body: { name?: string; description?: string; manager_user_id?: string }) { await this.admin(req, id); if (!body.name?.trim()) throw new BadRequestException('VALIDATION_ERROR'); if (body.manager_user_id && !(await this.floz.membership(body.manager_user_id, id))) throw new BadRequestException('CROSS_WORKSPACE_REFERENCE'); return ok(await this.floz.createTeam(id, { name: body.name, description: body.description ?? null, managerUserId: body.manager_user_id ?? null })); }
  @Get('workspaces/:workspaceId/teams/:teamId')
  async getTeam(@Req() req: Request, @Param('workspaceId') wid: string, @Param('teamId') tid: string) { await this.member(req, wid); const team = await this.floz.team(wid, tid); if (!team) throw new NotFoundException('NOT_FOUND'); return ok(team); }
  @Patch('workspaces/:workspaceId/teams/:teamId')
  async updateTeam(@Req() req: Request, @Param('workspaceId') wid: string, @Param('teamId') tid: string, @Body() body: { name?: string; description?: string | null; manager_user_id?: string | null }) { await this.admin(req, wid); const team = await this.floz.team(wid, tid); if (!team) throw new NotFoundException('NOT_FOUND'); if (body.name !== undefined && !body.name.trim()) throw new BadRequestException('VALIDATION_ERROR'); if (body.manager_user_id && !(await this.floz.membership(body.manager_user_id, wid))) throw new BadRequestException('CROSS_WORKSPACE_REFERENCE'); return ok(await this.floz.updateTeam(tid, { name: body.name, description: body.description, managerUserId: body.manager_user_id })); }
  @Get('workspaces/:workspaceId/teams/:teamId/members')
  async teamMembers(@Req() req: Request, @Param('workspaceId') wid: string, @Param('teamId') tid: string) { await this.member(req, wid); if (!(await this.floz.team(wid, tid))) throw new NotFoundException('NOT_FOUND'); return ok((await this.floz.teamMembers(tid)).map((member) => ({ user_id: member.userId, membership_role: member.membershipRole }))); }
  @Post('workspaces/:workspaceId/teams/:teamId/members')
  async addTeamMember(@Req() req: Request, @Param('workspaceId') wid: string, @Param('teamId') tid: string, @Body() body: { user_id?: string }) { await this.admin(req, wid); if (!(await this.floz.team(wid, tid))) throw new NotFoundException('NOT_FOUND'); if (!body.user_id || !(await this.floz.membership(body.user_id, wid))) throw new BadRequestException('CROSS_WORKSPACE_REFERENCE'); const member = await this.floz.addTeamMember(tid, body.user_id); return ok({ user_id: member.userId, membership_role: member.membershipRole }); }
  @Delete('workspaces/:workspaceId/teams/:teamId/members/:userId')
  @HttpCode(204)
  async removeTeamMember(@Req() req: Request, @Param('workspaceId') wid: string, @Param('teamId') tid: string, @Param('userId') uid: string) { await this.admin(req, wid); if (!(await this.floz.team(wid, tid))) throw new NotFoundException('NOT_FOUND'); await this.floz.removeTeamMember(tid, uid); }
  @Get('workspaces/:workspaceId/workflows')
  async workflows(@Req() req: Request, @Param('workspaceId') wid: string) { await this.member(req, wid); return ok(await this.tasks.workflows(wid)); }
  @Get('workspaces/:workspaceId/kanban')
  async kanban(@Req() req: Request, @Param('workspaceId') wid: string) { await this.member(req, wid); return ok(await this.tasks.kanban(wid, req.query as KanbanQueryDto)); }
  @Get('workspaces/:workspaceId/calendar/tasks')
  async calendar(@Req() req: Request, @Param('workspaceId') wid: string) { await this.member(req, wid); return this.tasks.calendar(wid, req.query as CalendarQueryDto); }
  @Get('workspaces/:workspaceId/tasks')
  async listTasks(@Req() req: Request, @Param('workspaceId') wid: string) { await this.member(req, wid); const result = await this.tasks.list(wid, req.query as TaskQueryDto); return { data: result.rows, meta: { pagination: { limit: result.limit, next_cursor: result.nextCursor, has_more: result.hasMore } } }; }
  @Post('workspaces/:workspaceId/tasks')
  async createTask(@Req() req: Request, @Param('workspaceId') wid: string, @Body() body: CreateTaskDto) { const ctx = await this.member(req, wid); return ok(await this.tasks.create(wid, ctx.user.id, ctx.membership.role as TaskRole, body)); }
  @Get('workspaces/:workspaceId/tasks/:taskId')
  async task(@Req() req: Request, @Param('workspaceId') wid: string, @Param('taskId') tid: string) { await this.member(req, wid); return ok(await this.tasks.detail(wid, tid)); }
  @Patch('workspaces/:workspaceId/tasks/:taskId')
  async updateTask(@Req() req: Request, @Param('workspaceId') wid: string, @Param('taskId') tid: string, @Body() body: UpdateTaskDto) { const ctx = await this.member(req, wid); return ok(await this.tasks.update(wid, ctx.user.id, ctx.membership.role as TaskRole, tid, body)); }
  @Post('workspaces/:workspaceId/tasks/:taskId/assignments')
  async assignTask(@Req() req: Request, @Param('workspaceId') wid: string, @Param('taskId') tid: string, @Body() body: AssignTaskDto) { const ctx = await this.member(req, wid); return ok(await this.tasks.assign(wid, ctx.user.id, ctx.membership.role as TaskRole, tid, body)); }
  @Delete('workspaces/:workspaceId/tasks/:taskId')
  @HttpCode(204)
  async deleteTask(@Req() req: Request, @Param('workspaceId') wid: string, @Param('taskId') tid: string) { const ctx = await this.member(req, wid); await this.tasks.remove(wid, ctx.membership.role as TaskRole, tid, Number(req.query.version)); }
  @Get('workspaces/:workspaceId/tasks/:taskId/available-transitions')
  async availableTransitions(@Req() req: Request, @Param('workspaceId') wid: string, @Param('taskId') tid: string) { await this.member(req, wid); return ok(await this.tasks.transitions(wid, tid)); }
  @Post('workspaces/:workspaceId/tasks/:taskId/transitions')
  async transitionTask(@Req() req: Request, @Param('workspaceId') wid: string, @Param('taskId') tid: string, @Body() body: TransitionTaskDto) { const ctx = await this.member(req, wid); const task = await this.tasks.transition(wid, ctx.user.id, ctx.membership.role as TaskRole, tid, body); return { task, transition: { to_status_id: body.to_status_id } }; }
  @Get('workspaces/:workspaceId/tasks/:taskId/history')
  async taskHistory(@Req() req: Request, @Param('workspaceId') wid: string, @Param('taskId') tid: string) { await this.member(req, wid); return { data: await this.tasks.history(wid, tid), meta: { pagination: { limit: 50, next_cursor: null, has_more: false } } }; }

  private async current(req: Request) { const session = await this.auth.api.getSession({ headers: req.headers as HeadersInit }); if (!session) throw new UnauthorizedException('UNAUTHENTICATED'); const user = await this.floz.user(session.user.id); if (!user) throw new UnauthorizedException('UNAUTHENTICATED'); if (!user.isActive) throw new ForbiddenException('ACCOUNT_INACTIVE'); return user; }
  private async member(req: Request, wid: string) { const user = await this.current(req); const membership = await this.floz.membership(user.id, wid); if (!membership) throw new NotFoundException('NOT_FOUND'); return { user, membership }; }
  private async admin(req: Request, wid: string) { const ctx = await this.member(req, wid); if (ctx.membership.role !== 'ADMIN') throw new ForbiddenException('FORBIDDEN'); return ctx; }
  private publicUser(user: { id: string; email: string; name: string; timezone: string; locale: string; isActive: boolean }) { return { id: user.id, email: user.email, full_name: user.name, avatar_url: null, timezone: user.timezone, locale: user.locale, is_active: user.isActive }; }
}
