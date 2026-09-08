import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  lockWorkspaceForWorkflowDefaultTx,
  lockWorkflowsDeterministicTx,
  lockWorkflowAggregateTx,
  bumpWorkflowVersionTx
} from '../src/index.js';

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)('Phase 11 Workflow Concurrency & Locking Repository Primitives', () => {
  const { sql } = databaseUrl ? createDatabase(databaseUrl) : ({} as any);

  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    userId = randomUUID();
    workspaceId = randomUUID();

    await sql`INSERT INTO roles(id, code, name) VALUES (${randomUUID()}, 'ADMIN', 'Admin') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO users(id, email, name) VALUES (${userId}, ${`u-${userId}@test.com`}, 'Concurrency User')`;
    await sql`INSERT INTO workspaces(id, name, slug, created_by) VALUES (${workspaceId}, 'Concurrency WS', ${`ws-${workspaceId}`}, ${userId})`;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM workflow_transitions WHERE workflow_id IN (SELECT id FROM workflows WHERE workspace_id IN (SELECT id FROM workspaces WHERE created_by=${userId}))`;
      await sql`DELETE FROM task_statuses WHERE workflow_id IN (SELECT id FROM workflows WHERE workspace_id IN (SELECT id FROM workspaces WHERE created_by=${userId}))`;
      await sql`DELETE FROM workflows WHERE workspace_id IN (SELECT id FROM workspaces WHERE created_by=${userId})`;
      await sql`DELETE FROM workspaces WHERE created_by=${userId}`;
      await sql`DELETE FROM users WHERE id=${userId}`;
      await sql.end();
    }
  });

  it('locks workflow aggregate and returns workflow and statuses in position order', async () => {
    const wfId = randomUUID();
    await sql`INSERT INTO workflows(id, workspace_id, code, name, is_default, is_active, version, created_by) VALUES (${wfId}, ${workspaceId}, 'WF_AGG_1', 'Aggregate 1', false, true, 1, ${userId})`;
    const st2 = randomUUID();
    const st1 = randomUUID();
    await sql`INSERT INTO task_statuses(id, workflow_id, code, name, category, position, is_initial, is_terminal, is_active) VALUES
      (${st2}, ${wfId}, 'DONE', 'Done', 'DONE', 2, false, true, true),
      (${st1}, ${wfId}, 'TODO', 'To Do', 'TODO', 1, true, false, true)`;

    await sql.begin(async (tx: any) => {
      const { workflow, statuses } = await lockWorkflowAggregateTx(tx, workspaceId, wfId, 1);
      expect(workflow.id).toBe(wfId);
      expect(workflow.version).toBe(1);
      expect(statuses.length).toBe(2);
      expect(statuses[0].id).toBe(st1);
      expect(statuses[0].position).toBe(1);
      expect(statuses[1].id).toBe(st2);
      expect(statuses[1].position).toBe(2);
    });
  });

  it('rejects lockWorkflowAggregateTx on version mismatch with VERSION_CONFLICT', async () => {
    const wfId = randomUUID();
    await sql`INSERT INTO workflows(id, workspace_id, code, name, is_default, is_active, version, created_by) VALUES (${wfId}, ${workspaceId}, 'WF_MISMATCH', 'Mismatch', false, true, 5, ${userId})`;

    await expect(
      sql.begin(async (tx: any) => {
        await lockWorkflowAggregateTx(tx, workspaceId, wfId, 4);
      })
    ).rejects.toThrow(/VERSION_CONFLICT/);
  });

  it('bumps workflow version atomically and increments version by 1', async () => {
    const wfId = randomUUID();
    await sql`INSERT INTO workflows(id, workspace_id, code, name, is_default, is_active, version, created_by) VALUES (${wfId}, ${workspaceId}, 'WF_BUMP', 'Bump', false, true, 1, ${userId})`;

    await sql.begin(async (tx: any) => {
      const newVersion = await bumpWorkflowVersionTx(tx, wfId, 1);
      expect(newVersion).toBe(2);
    });

    const row = (await sql<{ version: number }[]>`SELECT version FROM workflows WHERE id = ${wfId}`)[0];
    expect(row.version).toBe(2);
  });

  it('rejects bumpWorkflowVersionTx on stale version with VERSION_CONFLICT', async () => {
    const wfId = randomUUID();
    await sql`INSERT INTO workflows(id, workspace_id, code, name, is_default, is_active, version, created_by) VALUES (${wfId}, ${workspaceId}, 'WF_BUMP_FAIL', 'Bump Fail', false, true, 3, ${userId})`;

    await expect(
      sql.begin(async (tx: any) => {
        await bumpWorkflowVersionTx(tx, wfId, 2);
      })
    ).rejects.toThrow(/VERSION_CONFLICT/);
  });

  it('locks workflows in deterministic sorted ID order', async () => {
    const idB = 'b0000000-0000-0000-0000-000000000000';
    const idA = 'a0000000-0000-0000-0000-000000000000';
    await sql`INSERT INTO workflows(id, workspace_id, code, name, is_default, is_active, version, created_by) VALUES
      (${idB}, ${workspaceId}, 'WF_SORT_B', 'Sort B', false, true, 1, ${userId}),
      (${idA}, ${workspaceId}, 'WF_SORT_A', 'Sort A', false, true, 1, ${userId})`;

    await sql.begin(async (tx: any) => {
      // Pass in reverse order [idB, idA]
      const rows = await lockWorkflowsDeterministicTx(tx, workspaceId, [idB, idA]);
      expect(rows.length).toBe(2);
      expect(rows[0].id).toBe(idA);
      expect(rows[1].id).toBe(idB);
    });
  });

  it('locks workspace row for workflow default mutation', async () => {
    await sql.begin(async (tx: any) => {
      await expect(lockWorkspaceForWorkflowDefaultTx(tx, workspaceId)).resolves.not.toThrow();
    });
  });

  it('proves parallel competing transactions cannot overwrite each other with stale version', async () => {
    const wfId = randomUUID();
    await sql`INSERT INTO workflows(id, workspace_id, code, name, is_default, is_active, version, created_by) VALUES (${wfId}, ${workspaceId}, 'WF_RACE', 'Race', false, true, 1, ${userId})`;

    // Transaction 1 starts, reads version 1
    // Transaction 2 starts, reads version 1
    // Transaction 1 bumps to version 2 and commits
    // Transaction 2 tries to bump with expected version 1 and must fail
    const tx1Promise = sql.begin(async (tx1: any) => {
      const { workflow } = await lockWorkflowAggregateTx(tx1, workspaceId, wfId, 1);
      // Small sleep to ensure tx2 also attempts
      await new Promise((resolve) => setTimeout(resolve, 50));
      return await bumpWorkflowVersionTx(tx1, wfId, workflow.version);
    });

    const tx2Promise = (async () => {
      // Wait slightly so tx1 holds the FOR UPDATE lock
      await new Promise((resolve) => setTimeout(resolve, 20));
      return await sql.begin(async (tx2: any) => {
        // Will block until tx1 commits, then see version 2 != expected 1
        return await lockWorkflowAggregateTx(tx2, workspaceId, wfId, 1);
      });
    })();

    const [res1, res2] = await Promise.allSettled([tx1Promise, tx2Promise]);
    expect(res1.status).toBe('fulfilled');
    if (res1.status === 'fulfilled') {
      expect(res1.value).toBe(2);
    }
    expect(res2.status).toBe('rejected');
    if (res2.status === 'rejected') {
      expect(res2.reason.message).toContain('VERSION_CONFLICT');
    }

    const finalRow = (await sql<{ version: number }[]>`SELECT version FROM workflows WHERE id = ${wfId}`)[0];
    expect(finalRow.version).toBe(2);
  });
});
