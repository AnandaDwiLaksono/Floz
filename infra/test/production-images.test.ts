import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');

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
    expect(compose).toContain('TRUSTED_PROXY_IPS');
    expect(compose).toContain('ALLOWED_ORIGINS');
    expect(compose).toContain('BETTER_AUTH_SECRET');
    expect(caddy).toContain('dial_timeout 5s');
    expect(caddy).not.toContain('response_header_timeout');
    expect(caddy).toContain(`{$CADDY_TLS_MODE}
  header Strict-Transport-Security "max-age=15552000"
  @ready path /api/v1/health/ready`);
    expect(caddy).not.toMatch(/handle @ready[\s\S]*?header Strict-Transport-Security/);
    expect(caddy).toContain('/api/v1/health/ready');
    expect(caddy).toContain('trusted_proxies static');
    expect(caddy).toContain('{$TRUSTED_PROXY_IPS}');
    expect(caddy).toContain('{$CADDY_TLS_MODE}');
    expect(compose).toContain('CADDY_TLS_MODE: ${CADDY_TLS_MODE:?CADDY_TLS_MODE required}');
    expect(compose).toContain('ipv4_address: 172.30.0.2');
    expect(compose).toContain('TRUSTED_PROXY_IPS: 172.30.0.2');
    expect(caddy.match(/header_up -Forwarded/g)?.length).toBe(1);
    expect(caddy).toContain('header_up X-Forwarded-For {client_ip}');
    expect(caddy).not.toContain('header_up X-Forwarded-For {http.request.remote.host}');
  });

  test('workflow uses immutable disposable services and real runtime checks', () => {
    const workflow = read('.github/workflows/phase12-multiarch-smoke.yml');
    expect(workflow).toMatch(/postgres:17-bookworm@sha256:[a-f0-9]{64}/);
    expect(workflow).toMatch(/redis:7-bookworm@sha256:[a-f0-9]{64}/);
    expect(workflow).toContain('phase12-image-smoke.ps1 -Platform linux/arm64');
    expect(workflow).not.toContain('http://127.0.0.1:3001');
    expect(workflow).not.toContain('docker run -d --name floz-api --network host');
  });

  test('smoke executes every service and verifies uid, CA and digest', () => {
    const script = read('scripts/phase12-image-smoke.ps1');
    expect(script).toContain('docker image inspect');
    expect(script).toContain('id -u');
    expect(script).toContain('node');
    expect(script).toContain('caddy validate');
    expect(script).toContain('phase12-caddy');
    expect(script).toContain('https://localhost:8443/api/v1/health/ready');
    expect(script).toContain('X-Forwarded-For');
    expect(script).toContain('Invoke-WebRequest');
    expect(script).toContain('migrator');
    expect(script).toContain('next');
    expect(script.indexOf('try {')).toBeLessThan(script.indexOf('docker run -d --name phase12-api'));
    expect(script).toMatch(/finally\s*\{\s*docker rm -f phase12-api phase12-worker phase12-web/);
  });
});
