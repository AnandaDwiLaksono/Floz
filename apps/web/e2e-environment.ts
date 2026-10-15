import { execFileSync } from 'node:child_process';

type Environment = Record<string, string | undefined>;
export const qaDockerHost = process.platform === 'win32' ? 'npipe:////./pipe/docker_engine' : 'unix:///var/run/docker.sock';
export function qaDocker(args: string[]) {
  return execFileSync('docker', ['--host', qaDockerHost, ...args], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
type Container = {
  Id: string; Name: string; State: { Running: boolean };
  Mounts: { Type: string; Destination: string }[];
  HostConfig: { Tmpfs?: Record<string, string> };
  Config: { Image: string; Labels: Record<string, string>; Env: string[] };
  NetworkSettings: { Ports: Record<string, { HostIp: string; HostPort: string }[]> };
};

function requireValue(env: Environment, key: string) {
  const value = env[key];
  if (!value) throw new Error(`${key} is required for disposable E2E QA`);
  return value;
}

function inspectQaContainer(env: Environment, kind: 'pg' | 'redis', port: string) {
  const owner = requireValue(env, 'FLOZ_QA_OWNER');
  const id = requireValue(env, kind === 'pg' ? 'FLOZ_QA_DATABASE_CONTAINER' : 'FLOZ_QA_REDIS_CONTAINER');
  if (!/^[a-f0-9]{32}$/.test(owner) || !/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid disposable QA identity');
  const info = (JSON.parse(qaDocker(['inspect', id])) as Container[])[0];
  const binding = info?.NetworkSettings?.Ports?.[kind === 'pg' ? '5432/tcp' : '6379/tcp'];
  if (!info || info.Id !== id || info.Name !== `/floz-e2e-${kind}-${owner}` || !info.State.Running ||
      info.Config.Labels?.['floz.qa.owner'] !== owner || info.Config.Labels?.['floz.qa.disposable'] !== 'true' ||
      info.Config.Image !== (kind === 'pg' ? 'postgres:16-alpine' : 'redis:7-alpine') ||
      !Object.hasOwn(info.HostConfig.Tmpfs ?? {}, kind === 'pg' ? '/var/lib/postgresql/data' : '/data') ||
      info.Mounts.some((mount) => mount.Type !== 'tmpfs' || mount.Destination !== (kind === 'pg' ? '/var/lib/postgresql/data' : '/data')) ||
      binding?.length !== 1 || binding[0].HostIp !== '127.0.0.1' || binding[0].HostPort !== port) {
    throw new Error('Disposable QA container ownership/isolation cannot be proven');
  }
  return info;
}

export function assertQaDatabase(env: Environment = process.env) {
  const databaseUrl = requireValue(env, 'DATABASE_URL');
  const url = new URL(databaseUrl);
  const owner = requireValue(env, 'FLOZ_QA_OWNER');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || !url.port ||
      url.username !== 'postgres' || url.password || url.pathname !== `/floz_qa_${owner}` || url.search || url.hash) {
    throw new Error('DATABASE_URL must target the owned disposable QA database without overrides');
  }
  const info = inspectQaContainer(env, 'pg', url.port);
  if (!info.Config.Env.includes(`POSTGRES_DB=floz_qa_${owner}`) || !info.Config.Env.includes('POSTGRES_USER=postgres') ||
      !info.Config.Env.includes('POSTGRES_HOST_AUTH_METHOD=trust')) throw new Error('Disposable QA database identity cannot be proven');
  return databaseUrl;
}

export function getE2eEnvironment(env: Environment = process.env) {
  const databaseUrl = assertQaDatabase(env);
  const redisUrl = new URL(requireValue(env, 'REDIS_URL'));
  if (redisUrl.protocol !== 'redis:' || redisUrl.hostname !== '127.0.0.1' || !redisUrl.port || redisUrl.username || redisUrl.password ||
      (redisUrl.pathname && redisUrl.pathname !== '/') || redisUrl.search || redisUrl.hash) throw new Error('REDIS_URL must target disposable loopback QA Redis');
  inspectQaContainer(env, 'redis', redisUrl.port);
  const api = new URL(requireValue(env, 'PLAYWRIGHT_API_URL'));
  const web = new URL(requireValue(env, 'PLAYWRIGHT_TEST_BASE_URL'));
  for (const url of [api, web]) {
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.search || url.hash) {
      throw new Error('E2E service URLs must be explicit isolated loopback origins');
    }
  }
  if (api.pathname !== '/api/v1' || web.pathname !== '/' || api.port === web.port ||
      new Set([api.port, web.port, new URL(databaseUrl).port, redisUrl.port]).size !== 4) throw new Error('Invalid E2E service paths/ports');
  const expected = { BETTER_AUTH_URL: api.origin, NEXT_PUBLIC_API_URL: api.origin, API_PORT: api.port, PORT: web.port, ALLOWED_ORIGINS: web.origin };
  for (const [key, value] of Object.entries(expected)) if (env[key] !== undefined && env[key] !== value) throw new Error(`${key} conflicts with E2E origins`);
  const secret = requireValue(env, 'BETTER_AUTH_SECRET');
  if (secret.length < 32) throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters');
  return { ...expected, DATABASE_URL: databaseUrl, REDIS_URL: redisUrl.href, BETTER_AUTH_SECRET: secret,
    PLAYWRIGHT_API_URL: api.href, PLAYWRIGHT_TEST_BASE_URL: web.origin, NODE_ENV: 'test', DB_SSL: 'false', REDIS_TLS: 'false', AUTH_RATE_LIMIT_MAX: '1000',
    FLOZ_TEST_REPORTING_NOW: '2026-09-03T00:00:00.000Z' };
}

export function removeQaContainers(env: Environment = process.env) {
  // Re-prove ownership immediately before destruction; never fall back to names or arbitrary database cleanup.
  assertQaDatabase(env);
  const redis = new URL(requireValue(env, 'REDIS_URL'));
  inspectQaContainer(env, 'redis', redis.port);
  cleanupOwnedQaContainers(requireValue(env, 'FLOZ_QA_OWNER'));
}

export function cleanupOwnedQaContainers(owner: string) {
  if (!/^[a-f0-9]{32}$/.test(owner)) throw new Error('Invalid disposable QA owner');
  const ids = qaDocker(['ps', '-aq', '--no-trunc', '--filter', `label=floz.qa.owner=${owner}`]).split(/\s+/).filter(Boolean);
  const errors: unknown[] = [];
  for (const id of ids) {
    try {
      if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid disposable QA container ID');
      const info = JSON.parse(qaDocker(['inspect', id]))[0] as Container;
      if (info.Id !== id || !['pg', 'redis'].some((kind) => info.Name === `/floz-e2e-${kind}-${owner}`) ||
          info.Config.Labels?.['floz.qa.owner'] !== owner || info.Config.Labels?.['floz.qa.disposable'] !== 'true') throw new Error('Refusing cleanup: QA ownership changed');
      qaDocker(['rm', '-f', '-v', id]);
    } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'Disposable QA cleanup failed');
}
