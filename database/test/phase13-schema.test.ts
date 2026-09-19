import { describe, it, expect } from 'vitest';
import { workspaces, workspaceInvitations, workspaceJoinRequests, workspaceJoinCodes } from '../src/schema';

describe('Phase 13 Schema Definitions', () => {
  it('should define join_policy on workspaces', () => {
    expect(workspaces.joinPolicy).toBeDefined();
    expect(workspaces.joinPolicy.name).toBe('join_policy');
    expect(workspaces.joinPolicy.default).toBe('INVITE_ONLY');
  });

  it('should define workspace_invitations with correct columns', () => {
    expect(workspaceInvitations.id).toBeDefined();
    expect(workspaceInvitations.workspaceId).toBeDefined();
    expect(workspaceInvitations.email).toBeDefined();
    expect(workspaceInvitations.roleId).toBeDefined();
    expect(workspaceInvitations.tokenHash).toBeDefined();
    expect(workspaceInvitations.status).toBeDefined();
    expect(workspaceInvitations.expiresAt).toBeDefined();
  });

  it('should define workspace_join_requests with correct columns', () => {
    expect(workspaceJoinRequests.id).toBeDefined();
    expect(workspaceJoinRequests.workspaceId).toBeDefined();
    expect(workspaceJoinRequests.userId).toBeDefined();
    expect(workspaceJoinRequests.status).toBeDefined();
    expect(workspaceJoinRequests.requestedVia).toBeDefined();
    expect(workspaceJoinRequests.requestedAt).toBeDefined();
  });

  it('should define workspace_join_codes with correct columns', () => {
    expect(workspaceJoinCodes.id).toBeDefined();
    expect(workspaceJoinCodes.workspaceId).toBeDefined();
    expect(workspaceJoinCodes.codeHash).toBeDefined();
    expect(workspaceJoinCodes.isActive).toBeDefined();
    expect(workspaceJoinCodes.isActive.default).toBe(true);
  });
});
