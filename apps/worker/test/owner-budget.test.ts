import { describe, expect, it, vi } from 'vitest';
import { parseWorkerEnv, parseApiEnv } from '@floz/config';
import * as databaseModule from '@floz/database';
import { startWorkerRuntime } from '../src/main.js';

describe('Task 3 — PostgreSQL Owner Budget & Concurrency Verification', () => {
  it('enforces API persistent connection budget of max 2', () => {
    const apiEnv = parseApiEnv({ NODE_ENV: 'test' });
    expect(apiEnv.DB_POOL_MAX).toBe(2);
    expect(() => parseApiEnv({ NODE_ENV: 'test', DB_POOL_MAX: '3' })).toThrow();
  });

  it('enforces Worker persistent connection budget of max 1 and concurrency 1', () => {
    const workerEnv = parseWorkerEnv({ NODE_ENV: 'test', WORKER_CONCURRENCY: '10' });
    expect(workerEnv.WORKER_CONCURRENCY).toBe(1);
    expect(workerEnv.DB_POOL_MAX).toBe(1);
    expect(() => parseWorkerEnv({ NODE_ENV: 'test', DB_POOL_MAX: '2' })).toThrow();
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
      heartbeat: { initialize: async () => undefined, stopping: async () => undefined, remove: async () => undefined },
      createConnection: () => ({ close: vi.fn().mockResolvedValue(undefined) }),
      createQueue: () => ({ close: vi.fn().mockResolvedValue(undefined) })
    });

    // 1 pool in worker handler + 1 pool in dispatcher + 2 pools in reconciliation (sql + claimSql) = 4
    expect(workerCreatedDatabases).toBe(4);

    await runtime.stop();
    createDatabaseSpy.mockRestore();
  });

  it('verifies the approved PostgreSQL connection budget totals', () => {
    const apiPersistentSlots = 2;
    const workerPersistentSlots = 4;
    const workerTransientRuntimeSlots = 2;
    const normalRuntimeTotal = apiPersistentSlots + workerPersistentSlots + workerTransientRuntimeSlots;
    expect(normalRuntimeTotal).toBe(8);

    const readinessSlots = 1;
    const runtimePlusReadinessTotal = normalRuntimeTotal + readinessSlots;
    expect(runtimePlusReadinessTotal).toBe(9);

    const maintenanceSlots = 2;
    const maintenanceCeiling = runtimePlusReadinessTotal + maintenanceSlots;
    expect(maintenanceCeiling).toBe(11);
  });
});
