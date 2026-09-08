import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, workflows, taskStatuses } from '../src/index.js';

describe('Phase 11 Workflow Configuration Schema Exports', () => {
  it('exports workflow and status tables with Phase 11 fields', () => {
    expect(workflows).toBeDefined();
    expect(workflows.version).toBeDefined();
    expect(taskStatuses).toBeDefined();
    expect(taskStatuses.isActive).toBeDefined();
  });
});

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)('Phase 11 Workflow Migration & Preflight Invariant Integration', () => {
  const { sql } = databaseUrl ? createDatabase(databaseUrl) : ({} as any);

  let workspaceId: string;
  let teamId: string;
  let userId: string;

  beforeAll(async () => {
    userId = randomUUID();
    workspaceId = randomUUID();
    teamId = randomUUID();

    await sql`INSERT INTO roles(id, code, name) VALUES (${randomUUID()}, 'ADMIN', 'Admin') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO users(id, email, name) VALUES (${userId}, ${`u-${userId}@test.com`}, 'User 1')`;
    await sql`INSERT INTO workspaces(id, name, slug, created_by) VALUES (${workspaceId}, 'Test WS', ${`ws-${workspaceId}`}, ${userId})`;
    await sql`INSERT INTO teams(id, workspace_id, name) VALUES (${teamId}, ${workspaceId}, 'Team Alpha')`;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM workflow_transitions WHERE workflow_id IN (SELECT id FROM workflows WHERE workspace_id IN (SELECT id FROM workspaces WHERE created_by=${userId}))`;
      await sql`DELETE FROM task_statuses WHERE workflow_id IN (SELECT id FROM workflows WHERE workspace_id IN (SELECT id FROM workspaces WHERE created_by=${userId}))`;
      await sql`DELETE FROM workflows WHERE workspace_id IN (SELECT id FROM workspaces WHERE created_by=${userId})`;
      await sql`DELETE FROM teams WHERE workspace_id IN (SELECT id FROM workspaces WHERE created_by=${userId})`;
      await sql`DELETE FROM workspaces WHERE created_by=${userId}`;
      await sql`DELETE FROM users WHERE id=${userId}`;
      await sql.end();
    }
  });

  it('rejects duplicate case-insensitive status names within the same workflow', async () => {
    const wfId = randomUUID();
    await sql`INSERT INTO workflows(id, workspace_id, code, name, is_default, is_active, version, created_by) VALUES (${wfId}, ${workspaceId}, 'WF_NAME_TEST', 'Name Test', false, true, 1, ${userId})`;
    await sql`INSERT INTO task_statuses(id, workflow_id, code, name, category, position, is_initial, is_terminal, is_active) VALUES (${randomUUID()}, ${wfId}, 'TODO', 'In Review', 'TODO', 1, true, false, true)`;

    await expect(
      sql`INSERT INTO task_statuses(id, workflow_id, code, name, category, position, is_initial, is_terminal, is_active) VALUES (${randomUUID()}, ${wfId}, 'REV', 'in review', 'TODO', 2, false, false, true)`
    ).rejects.toThrow(/task_statuses_workflow_name_lower_idx/);
  });

  it('rejects multiple active initial statuses within the same workflow', async () => {
    const wfId = randomUUID();
    await sql`INSERT INTO workflows(id, workspace_id, code, name, is_default, is_active, version, created_by) VALUES (${wfId}, ${workspaceId}, 'WF_INIT_TEST', 'Init Test', false, true, 1, ${userId})`;
    await sql`INSERT INTO task_statuses(id, workflow_id, code, name, category, position, is_initial, is_terminal, is_active) VALUES (${randomUUID()}, ${wfId}, 'INIT1', 'Initial 1', 'TODO', 1, true, false, true)`;

    await expect(
      sql`INSERT INTO task_statuses(id, workflow_id, code, name, category, position, is_initial, is_terminal, is_active) VALUES (${randomUUID()}, ${wfId}, 'INIT2', 'Initial 2', 'TODO', 2, true, false, true)`
    ).rejects.toThrow(/task_statuses_active_initial_idx/);
  });

  it('rejects multiple active workspace defaults', async () => {
    const wsId = randomUUID();
    await sql`INSERT INTO workspaces(id, name, slug, created_by) VALUES (${wsId}, 'WS Def Test', ${`ws-${wsId}`}, ${userId})`;

    // Trigger workspaces_seed_default_workflow automatically created one. Delete it.
    await sql`DELETE FROM workflow_transitions WHERE workflow_id IN (SELECT id FROM workflows WHERE workspace_id=${wsId})`;
    await sql`DELETE FROM task_statuses WHERE workflow_id IN (SELECT id FROM workflows WHERE workspace_id=${wsId})`;
    await sql`DELETE FROM workflows WHERE workspace_id=${wsId}`;

    const wf1 = randomUUID();
    const wf2 = randomUUID();
    await sql`INSERT INTO workflows(id, workspace_id, code, name, is_default, is_active, version, created_by) VALUES (${wf1}, ${wsId}, 'WS_DEF_1', 'WS Def 1', true, true, 1, ${userId})`;

    await expect(
      sql`INSERT INTO workflows(id, workspace_id, code, name, is_default, is_active, version, created_by) VALUES (${wf2}, ${wsId}, 'WS_DEF_2', 'WS Def 2', true, true, 1, ${userId})`
    ).rejects.toThrow(/workflows_active_workspace_default_idx/);

    await sql`DELETE FROM workflows WHERE workspace_id=${wsId}`;
    await sql`DELETE FROM workspaces WHERE id=${wsId}`;
  });

  it('rejects multiple active team defaults for the same team', async () => {
    const wf1 = randomUUID();
    const wf2 = randomUUID();
    await sql`INSERT INTO workflows(id, workspace_id, team_id, code, name, is_default, is_active, version, created_by) VALUES (${wf1}, ${workspaceId}, ${teamId}, 'TM_DEF_1', 'Team Def 1', true, true, 1, ${userId})`;

    await expect(
      sql`INSERT INTO workflows(id, workspace_id, team_id, code, name, is_default, is_active, version, created_by) VALUES (${wf2}, ${workspaceId}, ${teamId}, 'TM_DEF_2', 'Team Def 2', true, true, 1, ${userId})`
    ).rejects.toThrow(/workflows_active_team_default_idx/);
  });

  describe('Preflight check execution blocks', () => {
    const runPreflight = async () => {
      await sql`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM task_statuses GROUP BY workflow_id, LOWER(name) HAVING COUNT(*) > 1) THEN
            RAISE EXCEPTION 'Phase 11 Preflight Violation: Duplicate case-insensitive status names exist within a workflow.';
          END IF;

          IF EXISTS (SELECT 1 FROM workflows WHERE team_id IS NULL AND is_default = true AND is_active = true GROUP BY workspace_id HAVING COUNT(*) > 1) THEN
            RAISE EXCEPTION 'Phase 11 Preflight Violation: Multiple active workspace default workflows exist.';
          END IF;

          IF EXISTS (SELECT 1 FROM workflows WHERE team_id IS NOT NULL AND is_default = true AND is_active = true GROUP BY workspace_id, team_id HAVING COUNT(*) > 1) THEN
            RAISE EXCEPTION 'Phase 11 Preflight Violation: Multiple active team default workflows exist for a team.';
          END IF;

          IF EXISTS (SELECT 1 FROM task_statuses WHERE is_initial = true AND is_active = true GROUP BY workflow_id HAVING COUNT(*) > 1) THEN
            RAISE EXCEPTION 'Phase 11 Preflight Violation: Multiple active initial statuses exist within a workflow.';
          END IF;
        END $$;
      `;
    };

    it('passes preflight on valid populated database state', async () => {
      await expect(runPreflight()).resolves.not.toThrow();
    });

    it('fails preflight and rolls back cleanly when duplicate lower status names exist', async () => {
      const wfId = randomUUID();
      await sql`INSERT INTO workflows(id, workspace_id, code, name, is_default, is_active, version, created_by) VALUES (${wfId}, ${workspaceId}, 'PRE_NAME', 'Pre Name', false, true, 1, ${userId})`;
      await sql`INSERT INTO task_statuses(id, workflow_id, code, name, category, position, is_initial, is_terminal, is_active) VALUES (${randomUUID()}, ${wfId}, 'S1', 'Duplicate Status', 'TODO', 1, false, false, true)`;

      // In a transaction, temporarily drop index, insert duplicate, run preflight, verify exception, then rollback
      await expect(
        sql.begin(async (tx: any) => {
          await tx`ALTER TABLE task_statuses DROP CONSTRAINT IF EXISTS task_statuses_workflow_name_lower_idx CASCADE`;
          await tx`DROP INDEX IF EXISTS task_statuses_workflow_name_lower_idx`;
          await tx`INSERT INTO task_statuses(id, workflow_id, code, name, category, position, is_initial, is_terminal, is_active) VALUES (${randomUUID()}, ${wfId}, 'S2', 'duplicate status', 'TODO', 2, false, false, true)`;
          await tx`
            DO $$
            BEGIN
              IF EXISTS (SELECT 1 FROM task_statuses GROUP BY workflow_id, LOWER(name) HAVING COUNT(*) > 1) THEN
                RAISE EXCEPTION 'Phase 11 Preflight Violation: Duplicate case-insensitive status names exist within a workflow.';
              END IF;
            END $$;
          `;
        })
      ).rejects.toThrow(/Duplicate case-insensitive status names/);

      // Verify rollback preserved initial state (no second status inserted)
      const count = await sql`SELECT COUNT(*)::int as count FROM task_statuses WHERE workflow_id=${wfId}`;
      expect(Number(count[0].count)).toBe(1);
    });

    it('fails preflight and rolls back cleanly when multiple active initial statuses exist', async () => {
      const wfId = randomUUID();
      await sql`INSERT INTO workflows(id, workspace_id, code, name, is_default, is_active, version, created_by) VALUES (${wfId}, ${workspaceId}, 'PRE_INIT', 'Pre Init', false, true, 1, ${userId})`;
      await sql`INSERT INTO task_statuses(id, workflow_id, code, name, category, position, is_initial, is_terminal, is_active) VALUES (${randomUUID()}, ${wfId}, 'I1', 'Init One', 'TODO', 1, true, false, true)`;

      await expect(
        sql.begin(async (tx: any) => {
          await tx`DROP INDEX IF EXISTS task_statuses_active_initial_idx`;
          await tx`INSERT INTO task_statuses(id, workflow_id, code, name, category, position, is_initial, is_terminal, is_active) VALUES (${randomUUID()}, ${wfId}, 'I2', 'Init Two', 'TODO', 2, true, false, true)`;
          await tx`
            DO $$
            BEGIN
              IF EXISTS (SELECT 1 FROM task_statuses WHERE is_initial = true AND is_active = true GROUP BY workflow_id HAVING COUNT(*) > 1) THEN
                RAISE EXCEPTION 'Phase 11 Preflight Violation: Multiple active initial statuses exist within a workflow.';
              END IF;
            END $$;
          `;
        })
      ).rejects.toThrow(/Multiple active initial statuses/);

      const count = await sql`SELECT COUNT(*)::int as count FROM task_statuses WHERE workflow_id=${wfId} AND is_initial=true`;
      expect(Number(count[0].count)).toBe(1);
    });
  });
});
