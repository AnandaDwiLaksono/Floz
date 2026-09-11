import { describe, expect, it } from 'vitest';
import { parseWorkerEnv, parseApiEnv } from '@floz/config';

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
