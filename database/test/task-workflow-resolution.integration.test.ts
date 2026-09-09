import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  createTaskRecordTx,
  createTaskAssigneesTx,
  validateTaskTemplateReferences,
  writeTaskHistoryTx
} from '../src/index.js';

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)('task dynamic workflow resolution integration (Task 6)', () => {
  const { sql } = databaseUrl ? createDatabase(databaseUrl) : ({} as any);

  let workspaceId: string;
  let adminUserId: string;
  let teamAId: string;
  let teamBId: string;

  let wsDefaultWfId: string;
  let wsDefaultInitStatusId: string;
  let wsDefaultDoneStatusId: string;

  let wsCustomWfId: string;
  let wsCustomInitStatusId: string;

  let wsArchivedWfId: string;

  let teamADefaultWfId: string;
  let teamADefaultInitStatusId: string;

  let teamACustomWfId: string;
  let teamACustomInitStatusId: string;
  let teamACustomArchivedStatusId: string;

  let teamBDefaultWfId: string;
  let teamBDefaultInitStatusId: string;

  beforeAll(async () => {
    adminUserId = randomUUID();
    workspaceId = randomUUID();
    teamAId = randomUUID();
    teamBId = randomUUID();

    await sql`INSERT INTO roles(id, code, name) VALUES (${randomUUID()}, 'ADMIN', 'Admin'), (${randomUUID()}, 'MEMBER', 'Member') ON CONFLICT DO NOTHING`;
    const role = (await sql<{ id: string }[]>`SELECT id FROM roles WHERE code='ADMIN' LIMIT 1`)[0];

    await sql`INSERT INTO users(id, email, name) VALUES (${adminUserId}, ${`admin-${adminUserId}@test.com`}, 'Admin User')`;
    await sql`INSERT INTO workspaces(id, name, slug, created_by) VALUES (${workspaceId}, 'Test WS', ${`ws-${workspaceId}`}, ${adminUserId})`;
    await sql`INSERT INTO workspace_memberships(workspace_id, user_id, role_id, status) VALUES (${workspaceId}, ${adminUserId}, ${role.id}, 'ACTIVE')`;

    await sql`INSERT INTO teams(id, workspace_id, name) VALUES (${teamAId}, ${workspaceId}, 'Team A'), (${teamBId}, ${workspaceId}, 'Team B')`;

    // 1. Workspace default workflow (seeded automatically on workspace creation)
    const wsDefaultWf = (await sql<{ id: string }[]>`SELECT id FROM workflows WHERE workspace_id=${workspaceId} AND is_default = true AND is_active = true AND team_id IS NULL LIMIT 1`)[0];
    wsDefaultWfId = wsDefaultWf.id;
    const wsInit = (await sql<{ id: string }[]>`SELECT id FROM task_statuses WHERE workflow_id=${wsDefaultWfId} AND is_initial = true LIMIT 1`)[0];
    wsDefaultInitStatusId = wsInit.id;
    const wsDone = (await sql<{ id: string }[]>`SELECT id FROM task_statuses WHERE workflow_id=${wsDefaultWfId} AND category = 'DONE' LIMIT 1`)[0];
    wsDefaultDoneStatusId = wsDone.id;

    // 2. Workspace custom (non-default) workflow
    const wsCustomWf = (await sql<{ id: string }[]>`INSERT INTO workflows(workspace_id, code, name, is_default, is_active, team_id, created_by) VALUES (${workspaceId}, 'WS_CUSTOM', 'WS Custom Workflow', false, true, NULL, ${adminUserId}) RETURNING id`)[0];
    wsCustomWfId = wsCustomWf.id;
    const wsCustInit = (await sql<{ id: string }[]>`INSERT INTO task_statuses(workflow_id, name, code, category, position, is_initial, is_terminal, is_active) VALUES (${wsCustomWfId}, 'Inbox', 'INBOX', 'TODO', 10, true, false, true) RETURNING id`)[0];
    wsCustomInitStatusId = wsCustInit.id;

    // 3. Workspace archived workflow
    const wsArchWf = (await sql<{ id: string }[]>`INSERT INTO workflows(workspace_id, code, name, is_default, is_active, team_id, created_by) VALUES (${workspaceId}, 'WS_ARCHIVED', 'WS Archived Workflow', false, false, NULL, ${adminUserId}) RETURNING id`)[0];
    wsArchivedWfId = wsArchWf.id;
    await sql`INSERT INTO task_statuses(workflow_id, name, code, category, position, is_initial, is_terminal, is_active) VALUES (${wsArchivedWfId}, 'Old Status', 'OLD', 'TODO', 10, true, false, true)`;

    // 4. Team A default workflow
    const teamADefWf = (await sql<{ id: string }[]>`INSERT INTO workflows(workspace_id, code, name, is_default, is_active, team_id, created_by) VALUES (${workspaceId}, 'TEAM_A_DEFAULT', 'Team A Default Workflow', true, true, ${teamAId}, ${adminUserId}) RETURNING id`)[0];
    teamADefaultWfId = teamADefWf.id;
    const teamAInit = (await sql<{ id: string }[]>`INSERT INTO task_statuses(workflow_id, name, code, category, position, is_initial, is_terminal, is_active) VALUES (${teamADefaultWfId}, 'Team A Todo', 'A_TODO', 'TODO', 10, true, false, true) RETURNING id`)[0];
    teamADefaultInitStatusId = teamAInit.id;

    // 5. Team A custom workflow with one active and one archived status
    const teamACustWf = (await sql<{ id: string }[]>`INSERT INTO workflows(workspace_id, code, name, is_default, is_active, team_id, created_by) VALUES (${workspaceId}, 'TEAM_A_CUSTOM', 'Team A Custom Workflow', false, true, ${teamAId}, ${adminUserId}) RETURNING id`)[0];
    teamACustomWfId = teamACustWf.id;
    const teamACustInit = (await sql<{ id: string }[]>`INSERT INTO task_statuses(workflow_id, name, code, category, position, is_initial, is_terminal, is_active) VALUES (${teamACustomWfId}, 'Backlog', 'BACKLOG', 'TODO', 10, true, false, true) RETURNING id`)[0];
    teamACustomInitStatusId = teamACustInit.id;
    const teamACustArch = (await sql<{ id: string }[]>`INSERT INTO task_statuses(workflow_id, name, code, category, position, is_initial, is_terminal, is_active) VALUES (${teamACustomWfId}, 'Archived Stage', 'ARCH_STAGE', 'TODO', 20, false, false, false) RETURNING id`)[0];
    teamACustomArchivedStatusId = teamACustArch.id;

    // 6. Team B default workflow
    const teamBDefWf = (await sql<{ id: string }[]>`INSERT INTO workflows(workspace_id, code, name, is_default, is_active, team_id, created_by) VALUES (${workspaceId}, 'TEAM_B_DEFAULT', 'Team B Default Workflow', true, true, ${teamBId}, ${adminUserId}) RETURNING id`)[0];
    teamBDefaultWfId = teamBDefWf.id;
    const teamBInit = (await sql<{ id: string }[]>`INSERT INTO task_statuses(workflow_id, name, code, category, position, is_initial, is_terminal, is_active) VALUES (${teamBDefaultWfId}, 'Team B Todo', 'B_TODO', 'TODO', 10, true, false, true) RETURNING id`)[0];
    teamBDefaultInitStatusId = teamBInit.id;
  });

  afterAll(async () => {
    if (!workspaceId) return;
    await sql`DELETE FROM outbox_events WHERE workspace_id=${workspaceId}`;
    await sql`DELETE FROM task_assignees WHERE task_id IN (SELECT id FROM tasks WHERE workspace_id=${workspaceId})`;
    await sql`DELETE FROM task_history WHERE task_id IN (SELECT id FROM tasks WHERE workspace_id=${workspaceId})`;
    await sql`DELETE FROM tasks WHERE workspace_id=${workspaceId}`;
    await sql`DELETE FROM workflow_transitions WHERE workflow_id IN (SELECT id FROM workflows WHERE workspace_id=${workspaceId})`;
    await sql`DELETE FROM task_statuses WHERE workflow_id IN (SELECT id FROM workflows WHERE workspace_id=${workspaceId})`;
    await sql`DELETE FROM workflows WHERE workspace_id=${workspaceId}`;
    await sql`DELETE FROM teams WHERE workspace_id=${workspaceId}`;
    await sql`DELETE FROM workspace_memberships WHERE workspace_id=${workspaceId}`;
    await sql`DELETE FROM workspaces WHERE id=${workspaceId}`;
    await sql`DELETE FROM users WHERE id=${adminUserId}`;
    await sql.end();
  });

  // 1. team with team default + omitted workflow_id -> team default
  it('1. team with team default + omitted workflow_id resolves team default', async () => {
    await sql.begin(async (tx) => {
      const res = await validateTaskTemplateReferences(tx, workspaceId, { title: 'Task 1', team_id: teamAId });
      expect(res.workflow_id).toBe(teamADefaultWfId);
      expect(res.status_id).toBe(teamADefaultInitStatusId);
    });
  });

  // 2. team with NO team default + omitted workflow_id -> workspace default
  it('2. team with NO team default + omitted workflow_id falls back to workspace default', async () => {
    // Create a new team with no team-scoped workflows
    const teamCId = randomUUID();
    await sql`INSERT INTO teams(id, workspace_id, name) VALUES (${teamCId}, ${workspaceId}, 'Team C No Default')`;

    await sql.begin(async (tx) => {
      const res = await validateTaskTemplateReferences(tx, workspaceId, { title: 'Task 2', team_id: teamCId });
      expect(res.workflow_id).toBe(wsDefaultWfId);
      expect(res.status_id).toBe(wsDefaultInitStatusId);
    });
  });

  // 3. no-team task + omitted workflow_id -> workspace default
  it('3. no-team task + omitted workflow_id resolves workspace default', async () => {
    await sql.begin(async (tx) => {
      const res = await validateTaskTemplateReferences(tx, workspaceId, { title: 'Task 3', team_id: null });
      expect(res.workflow_id).toBe(wsDefaultWfId);
      expect(res.status_id).toBe(wsDefaultInitStatusId);
    });
  });

  // 4. explicit workspace workflow + team task -> allowed
  it('4. explicit workspace workflow + team task is allowed', async () => {
    await sql.begin(async (tx) => {
      const res = await validateTaskTemplateReferences(tx, workspaceId, {
        title: 'Task 4',
        team_id: teamAId,
        workflow_id: wsCustomWfId
      });
      expect(res.workflow_id).toBe(wsCustomWfId);
      expect(res.status_id).toBe(wsCustomInitStatusId);
    });
  });

  // 5. explicit same-team workflow -> allowed
  it('5. explicit same-team workflow is allowed', async () => {
    await sql.begin(async (tx) => {
      const res = await validateTaskTemplateReferences(tx, workspaceId, {
        title: 'Task 5',
        team_id: teamAId,
        workflow_id: teamACustomWfId
      });
      expect(res.workflow_id).toBe(teamACustomWfId);
      expect(res.status_id).toBe(teamACustomInitStatusId);
    });
  });

  // 6. explicit cross-team workflow -> rejected (WORKFLOW_SCOPE_MISMATCH)
  it('6. explicit cross-team workflow is rejected with WORKFLOW_SCOPE_MISMATCH', async () => {
    await sql.begin(async (tx) => {
      await expect(
        validateTaskTemplateReferences(tx, workspaceId, {
          title: 'Task 6',
          team_id: teamAId,
          workflow_id: teamBDefaultWfId // belongs to Team B
        })
      ).rejects.toThrow('WORKFLOW_SCOPE_MISMATCH');
    });
  });

  // 7. explicit team workflow + no-team task -> rejected (WORKFLOW_SCOPE_MISMATCH)
  it('7. explicit team workflow + no-team task is rejected with WORKFLOW_SCOPE_MISMATCH', async () => {
    await sql.begin(async (tx) => {
      await expect(
        validateTaskTemplateReferences(tx, workspaceId, {
          title: 'Task 7',
          team_id: null,
          workflow_id: teamADefaultWfId // scoped to Team A
        })
      ).rejects.toThrow('WORKFLOW_SCOPE_MISMATCH');
    });
  });

  // 8. explicit archived workflow -> rejected using canonical error contract (WORKFLOW_SCOPE_MISMATCH)
  it('8. explicit archived workflow is rejected with WORKFLOW_SCOPE_MISMATCH', async () => {
    await sql.begin(async (tx) => {
      await expect(
        validateTaskTemplateReferences(tx, workspaceId, {
          title: 'Task 8',
          workflow_id: wsArchivedWfId
        })
      ).rejects.toThrow('WORKFLOW_SCOPE_MISMATCH');
    });
  });

  // 9. supplied status from another workflow -> canonical STATUS_SCOPE_MISMATCH
  it('9. supplied status from another workflow is rejected with STATUS_SCOPE_MISMATCH', async () => {
    await sql.begin(async (tx) => {
      await expect(
        validateTaskTemplateReferences(tx, workspaceId, {
          title: 'Task 9',
          workflow_id: wsDefaultWfId,
          status_id: wsCustomInitStatusId // belongs to wsCustomWfId
        })
      ).rejects.toThrow('STATUS_SCOPE_MISMATCH');
    });
  });

  // 10. supplied archived status -> canonical STATUS_SCOPE_MISMATCH
  it('10. supplied archived status is rejected with STATUS_SCOPE_MISMATCH', async () => {
    await sql.begin(async (tx) => {
      await expect(
        validateTaskTemplateReferences(tx, workspaceId, {
          title: 'Task 10',
          team_id: teamAId,
          workflow_id: teamACustomWfId,
          status_id: teamACustomArchivedStatusId // archived status in teamACustomWf
        })
      ).rejects.toThrow('STATUS_SCOPE_MISMATCH');
    });
  });

  // 11. resolved default initial status -> active + belongs to resolved workflow
  it('11. resolved default initial status is active and belongs to resolved workflow', async () => {
    await sql.begin(async (tx) => {
      const res = await validateTaskTemplateReferences(tx, workspaceId, { title: 'Task 11' });
      expect(res.workflow_id).toBe(wsDefaultWfId);

      const statusRow = (await tx<{ id: string; workflow_id: string; is_initial: boolean; is_active: boolean }[]>`
        SELECT id, workflow_id, is_initial, is_active FROM task_statuses WHERE id=${res.status_id}
      `)[0];
      expect(statusRow).toBeDefined();
      expect(statusRow.workflow_id).toBe(wsDefaultWfId);
      expect(statusRow.is_initial).toBe(true);
      expect(statusRow.is_active).toBe(true);
    });
  });

  // 12. Full Task creation transaction compatibility test
  it('12. full task creation transaction creates task, assignees, history correctly', async () => {
    let createdTaskId = '';
    await sql.begin(async (tx) => {
      const template = await validateTaskTemplateReferences(tx, workspaceId, {
        title: 'End-to-End Dynamic Task',
        team_id: teamAId
      });
      expect(template.workflow_id).toBe(teamADefaultWfId);
      expect(template.status_id).toBe(teamADefaultInitStatusId);

      const task = await createTaskRecordTx(
        tx,
        workspaceId,
        adminUserId,
        {
          title: 'End-to-End Dynamic Task',
          team_id: teamAId,
          priority: 'HIGH'
        },
        template
      );
      createdTaskId = task.id;

      await createTaskAssigneesTx(tx, workspaceId, createdTaskId, adminUserId, [
        { user_id: adminUserId, is_primary: true }
      ]);
      await writeTaskHistoryTx(tx, createdTaskId, adminUserId, { custom: 'field' });
    });

    const taskRow = (await sql<{ id: string; workflow_id: string; status_id: string; team_id: string; priority: string }[]>`
      SELECT id, workflow_id, status_id, team_id, priority FROM tasks WHERE id=${createdTaskId}
    `)[0];
    expect(taskRow).toBeDefined();
    expect(taskRow.workflow_id).toBe(teamADefaultWfId);
    expect(taskRow.status_id).toBe(teamADefaultInitStatusId);
    expect(taskRow.team_id).toBe(teamAId);
    expect(taskRow.priority).toBe('HIGH');

    const history = await sql<{ event_type: string }[]>`SELECT event_type FROM task_history WHERE task_id=${createdTaskId}`;
    expect(history.length).toBe(1);
    expect(history[0].event_type).toBe('CREATED');
  });
});
