// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), '../..');
const cli = resolve(dirname(createRequire(__filename).resolve('vitest/package.json')), 'vitest.mjs');

describe('database suite fail-closed entrypoints', () => {
  it.each(['database', 'apps/api', 'apps/worker'])('rejects an unproven database before collecting %s', (directory) => {
    const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: 'postgres://postgres@127.0.0.1:1/floz' };
    for (const key of ['FLOZ_QA_OWNER', 'FLOZ_QA_DATABASE_CONTAINER', 'FLOZ_QA_REDIS_CONTAINER']) delete env[key];
    const result = spawnSync(process.execPath, [cli, 'run'], { cwd: resolve(root, directory), env, encoding: 'utf8', timeout: 10000 });
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('FLOZ_QA_OWNER is required');
    expect(result.stdout + result.stderr).not.toContain('Test Files');
  });
});
