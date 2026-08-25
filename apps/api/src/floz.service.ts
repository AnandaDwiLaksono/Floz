import { Inject, Injectable } from '@nestjs/common';
import { AuthService } from './auth';

type UserRow = { id: string; email: string; name: string; timezone: string; locale: string; isActive: boolean };
type WorkspaceRow = { id: string; name: string; slug: string; timezone: string; role: string; membershipStatus: string };
type MembershipRow = { workspaceId: string; userId: string; role: string; status: string };
type MemberRow = { userId: string; role: string; status: string };
type TeamRow = { id: string; workspace_id: string; name: string; description: string | null; manager_user_id: string | null; created_at: Date; updated_at: Date };
type TeamMemberRow = { userId: string; membershipRole: string };

@Injectable()
export class FlozService {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  private get sql() { return this.authService.database.sql; }

  async user(id: string): Promise<UserRow | null> { return ((await this.sql<UserRow[]>`SELECT id, email, name, timezone, locale, is_active AS "isActive" FROM users WHERE id = ${id} LIMIT 1`)[0] ?? null) as UserRow | null; }
  async workspacesFor(userId: string, activeOnly = false): Promise<WorkspaceRow[]> { return await this.sql<WorkspaceRow[]>`SELECT w.id, w.name, w.slug, w.timezone, r.code AS role, wm.status AS "membershipStatus" FROM workspace_memberships wm INNER JOIN workspaces w ON w.id = wm.workspace_id INNER JOIN roles r ON r.id = wm.role_id WHERE wm.user_id = ${userId}${activeOnly ? this.sql` AND wm.status = 'ACTIVE'` : this.sql``}`; }
  async workspace(id: string): Promise<{ id: string; name: string; slug: string; timezone: string } | null> { return ((await this.sql<{ id: string; name: string; slug: string; timezone: string }[]>`SELECT id, name, slug, timezone FROM workspaces WHERE id = ${id} LIMIT 1`)[0] ?? null) as { id: string; name: string; slug: string; timezone: string } | null; }
  async membership(userId: string, workspaceId: string): Promise<MembershipRow | null> { return ((await this.sql<MembershipRow[]>`SELECT wm.workspace_id AS "workspaceId", wm.user_id AS "userId", r.code AS role, wm.status FROM workspace_memberships wm INNER JOIN roles r ON r.id = wm.role_id WHERE wm.user_id = ${userId} AND wm.workspace_id = ${workspaceId} AND wm.status = 'ACTIVE' LIMIT 1`)[0] ?? null) as MembershipRow | null; }
  async members(workspaceId: string): Promise<MemberRow[]> { return await this.sql<MemberRow[]>`SELECT wm.user_id AS "userId", r.code AS role, wm.status FROM workspace_memberships wm INNER JOIN roles r ON r.id = wm.role_id WHERE wm.workspace_id = ${workspaceId}`; }
  async listTeams(workspaceId: string): Promise<TeamRow[]> { return await this.sql<TeamRow[]>`SELECT id, workspace_id, name, description, manager_user_id, created_at, updated_at FROM teams WHERE workspace_id = ${workspaceId}`; }
  async team(workspaceId: string, id: string): Promise<TeamRow | null> { return ((await this.sql<TeamRow[]>`SELECT id, workspace_id, name, description, manager_user_id, created_at, updated_at FROM teams WHERE id = ${id} AND workspace_id = ${workspaceId} LIMIT 1`)[0] ?? null) as TeamRow | null; }
  async createTeam(workspaceId: string, input: { name: string; description: string | null; managerUserId: string | null }): Promise<TeamRow> { return (await this.sql<TeamRow[]>`INSERT INTO teams (workspace_id, name, description, manager_user_id) VALUES (${workspaceId}, ${input.name}, ${input.description}, ${input.managerUserId}) RETURNING id, workspace_id, name, description, manager_user_id, created_at, updated_at`)[0]; }
  async updateTeam(id: string, input: { name?: string; description?: string | null; managerUserId?: string | null }): Promise<TeamRow> { return (await this.sql<TeamRow[]>`UPDATE teams SET name = COALESCE(${input.name ?? null}, name), description = COALESCE(${input.description ?? null}, description), manager_user_id = COALESCE(${input.managerUserId ?? null}, manager_user_id), updated_at = NOW() WHERE id = ${id} RETURNING id, workspace_id, name, description, manager_user_id, created_at, updated_at`)[0]; }
  async teamMembers(teamId: string): Promise<TeamMemberRow[]> { return await this.sql<TeamMemberRow[]>`SELECT user_id AS "userId", membership_role AS "membershipRole" FROM team_memberships WHERE team_id = ${teamId} AND left_at IS NULL`; }
  async addTeamMember(teamId: string, userId: string): Promise<{ userId: string; membershipRole: string }> { const member = (await this.sql<{ userId: string; membershipRole: string }[]>`INSERT INTO team_memberships (team_id, user_id) VALUES (${teamId}, ${userId}) ON CONFLICT (team_id, user_id) DO UPDATE SET left_at = NULL, joined_at = NOW() RETURNING user_id AS "userId", membership_role AS "membershipRole"`)[0]; return member; }
  async removeTeamMember(teamId: string, userId: string) { await this.sql`UPDATE team_memberships SET left_at = NOW() WHERE team_id = ${teamId} AND user_id = ${userId}`; }
}
