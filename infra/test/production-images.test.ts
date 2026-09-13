import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('production artifacts', () => {
  for (const name of ['api', 'worker', 'web', 'migrate']) test(`${name} is pinned, frozen, production-only, CA-enabled and non-root`, () => {
    const file = read(`infra/docker/${name}.Dockerfile`);
    expect(file).toContain('node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5');
    expect(file).toContain('pnpm install --frozen-lockfile');
    expect(file).toContain('deploy --prod /out');
    expect(file).toContain('ca-certificates');
    expect(file).toMatch(/USER floz/);
    expect(file).not.toMatch(/standalone|SECRET|TOKEN|PASSWORD/);
  });

  test('worker has exact private health contract', () => {
    const file = read('infra/docker/worker.Dockerfile');
    expect(file).toContain('install -d -m 0700 -o floz -g floz /run/floz-worker');
    expect(file).toContain('HEALTHCHECK --interval=30s --start-period=30s --timeout=5s --retries=3 CMD ["node", "dist/health.js"]');
  });

  test('Caddy is sole ingress with trusted forwarding and unbounded response time', () => {
    const compose = read('infra/docker-compose.yml');
    const caddy = read('infra/Caddyfile');
    expect(compose).not.toMatch(/api:[\s\S]*?ports:/);
    expect(caddy).toContain('dial_timeout 5s');
    expect(caddy).not.toContain('response_header_timeout');
    expect(caddy).toContain('Strict-Transport-Security "max-age=15552000"');
    expect(caddy).toContain('/api/v1/health/ready');
    for (const header of ['Forwarded', 'X-Forwarded-For', 'X-Forwarded-Host', 'X-Forwarded-Proto']) expect(caddy).toContain(`header_up -${header}`);
  });
});
