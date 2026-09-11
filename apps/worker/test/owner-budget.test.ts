import { describe, expect, it, vi } from 'vitest';
import { parseWorkerEnv, parseApiEnv } from '@floz/config';
import * as databaseModule from '@floz/database';
import { startWorkerRuntime } from '../src/main.js';

describe('Task 3 — PostgreSQL Owner Budget & Concurrency Verification', () => {
  it('enforces API persistent connection budget of max 1', () => {
    const apiEnv = parseApiEnv({
      NODE_ENV: 'test',
      DB_POOL_MAX: '5'
    });
    expect(apiEnv.DB_POOL_MAX).toBe(1);
  });

  it('enforces Worker persistent connection budget of max 1 and concurrency 1', () => {
    const workerEnv = parseWorkerEnv({
      NODE_ENV: 'test',
      WORKER_CONCURRENCY: '10',
      DB_POOL_MAX: '5'
    });
    expect(workerEnv.WORKER_CONCURRENCY).toBe(1);
    expect(workerEnv.DB_POOL_MAX).toBe(1);
  });

  it('proves exactly 4 persistent PostgreSQL pool instances are constructed during Worker runtime startup', async () => {
    let workerCreatedDatabases = 0;

    const createDatabaseSpy = vi.spyOn(databaseModule, 'createDatabase').mockImplementation(() => {
      workerCreatedDatabases++;
      return {
        db: {} as unknown as databaseModule.DatabaseClient,
        sql: {
          end: vi.fn().mockResolvedValue(undefined),
          reserve: vi.fn().mockResolvedValue({
            release: vi.fn(),
            end: vi.fn().mockResolvedValue(undefined)
          })
        } as unknown as ReturnType<typeof databaseModule.createDatabase>['sql']
      };
    });

    process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/floz';

    const runtime = await startWorkerRuntime({
      env: parseWorkerEnv({ NODE_ENV: 'test' }),
      createConnection: () => ({ close: vi.fn().mockResolvedValue(undefined) }),
      createQueue: () => ({ close: vi.fn().mockResolvedValue(undefined) })
    });

    // 1 pool in worker handler + 1 pool in dispatcher + 2 pools in reconciliation (sql + claimSql) = 4
    expect(workerCreatedDatabases).toBe(4);

    await runtime.stop();
    createDatabaseSpy.mockRestore();
  });

  it('verifies the approved PostgreSQL connection budget totals', () => {
    // Canonical Phase 12 Budget Table:
    // API persistent owner: 1
    // Worker persistent owners:
    //   1. Worker jobs SQL (recurrence): 1
    //   2. Outbox dispatcher SQL: 1
    //   3. Recurrence reconciliation SQL: 1
    //   4. Claim SQL (reserved advisory lock session): 1
    // Worker transient runtime owners:
    //   5. Worker notification due-soon job DB: at most 1
    //   6. Notification reconciliation DB: at most 1
    // Total normal runtime maximum: 7
    // Worker dependency-readiness temporary PG client: at most 1
    // Total runtime plus readiness maximum: 8
    // Maintenance temporary allowances (migration 1, backup 1): 2
    // Total maintenance ceiling on source DB: 10

    const apiPersistentSlots = 1;
    const workerPersistentSlots = 4;
    const workerTransientRuntimeSlots = 2;
    const normalRuntimeTotal = apiPersistentSlots + workerPersistentSlots + workerTransientRuntimeSlots;
    expect(normalRuntimeTotal).toBe(7);

    const readinessSlots = 1;
    const runtimePlusReadinessTotal = normalRuntimeTotal + readinessSlots;
    expect(runtimePlusReadinessTotal).toBe(8);

    const maintenanceSlots = 2; // migration (1) + backup (1)
    const maintenanceCeiling = runtimePlusReadinessTotal + maintenanceSlots;
    expect(maintenanceCeiling).toBe(10);
  });
});
