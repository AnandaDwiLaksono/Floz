import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { getE2eEnvironment, assertQaDatabase, removeQaContainers, cleanupOwnedQaContainers, qaDockerHost } from '../e2e-environment';

vi.mock('node:child_process', () => { const execFileSync = vi.fn(); return { execFileSync, default: { execFileSync } }; });
const owner = 'a'.repeat(32);
const databaseId = 'b'.repeat(64);
const redisId = 'c'.repeat(64);
const input = () => ({
  FLOZ_QA_OWNER: owner, FLOZ_QA_DATABASE_CONTAINER: databaseId, FLOZ_QA_REDIS_CONTAINER: redisId,
  DATABASE_URL: `postgres://postgres@127.0.0.1:15432/floz_qa_${owner}`,
  REDIS_URL: 'redis://127.0.0.1:16379', PLAYWRIGHT_API_URL: 'http://127.0.0.1:13001/api/v1',
  PLAYWRIGHT_TEST_BASE_URL: 'http://127.0.0.1:13005', BETTER_AUTH_SECRET: 'qa-secret-at-least-32-characters-long',
});
const inspect = (id: string, kind: 'pg' | 'redis', port: number) => ({
  Id: id, Name: `/floz-e2e-${kind}-${owner}`, State: { Running: true }, Mounts: [],
  HostConfig: { Tmpfs: { [kind === 'pg' ? '/var/lib/postgresql/data' : '/data']: '' } },
  Config: { Image: kind === 'pg' ? 'postgres:16-alpine' : 'redis:7-alpine', Labels: { 'floz.qa.owner': owner, 'floz.qa.disposable': 'true' }, Env: kind === 'pg' ? [`POSTGRES_DB=floz_qa_${owner}`, 'POSTGRES_USER=postgres', 'POSTGRES_HOST_AUTH_METHOD=trust'] : [] },
  NetworkSettings: { Ports: { [kind === 'pg' ? '5432/tcp' : '6379/tcp']: [{ HostIp: '127.0.0.1', HostPort: String(port) }] } },
});
const proof = () => vi.mocked(execFileSync).mockImplementation((_file, args) => args?.[2] === 'ps' ? `${databaseId}\n${redisId}` : JSON.stringify([args?.[3] === databaseId ? inspect(databaseId, 'pg', 15432) : inspect(redisId, 'redis', 16379)]));

describe('disposable E2E environment', () => {
  it('proves Docker identity before accepting a database and propagates runner defaults', () => {
    proof();
    const env = getE2eEnvironment(input());
    expect(env.DATABASE_URL).toBe(input().DATABASE_URL);
    expect(env.PLAYWRIGHT_API_URL).toBe('http://127.0.0.1:13001/api/v1');
    expect(env.NEXT_PUBLIC_API_URL).toBe('http://127.0.0.1:13001');
    expect(env.BETTER_AUTH_URL).toBe('http://127.0.0.1:13001');
    expect(env.API_PORT).toBe('13001');
    expect(env.PORT).toBe('13005');
    expect(env.AUTH_RATE_LIMIT_MAX).toBe('1000');
    expect(execFileSync).toHaveBeenCalledWith('docker', ['--host', qaDockerHost, 'inspect', databaseId], expect.any(Object));
  });
  it.each([
    { DATABASE_URL: undefined }, { DATABASE_URL: 'postgres://postgres@localhost:5433/floz' },
    { DATABASE_URL: `postgres://postgres@127.0.0.1:15433/floz_qa_${owner}` },
    { DATABASE_URL: `postgres://postgres@127.0.0.1:15432/floz_qa_${owner}?host=production` },
    { FLOZ_QA_OWNER: undefined }, { FLOZ_QA_DATABASE_CONTAINER: 'postgres' },
  ])('rejects unproven or redirected database targets %j', (change) => {
    proof();
    expect(() => assertQaDatabase({ ...input(), ...change })).toThrow();
  });
  it.each(['owner', 'mount', 'missing mount', 'stopped', 'identity', 'address', 'database'])('fails closed on invalid Docker proof: %s', (failure) => {
    const info = inspect(databaseId, 'pg', 15432);
    if (failure === 'owner') info.Config.Labels['floz.qa.owner'] = 'wrong';
    if (failure === 'mount') Object.assign(info, { Mounts: [{ Type: 'bind' }] });
    if (failure === 'missing mount') info.HostConfig.Tmpfs = {};
    if (failure === 'stopped') info.State.Running = false;
    if (failure === 'identity') info.Id = redisId;
    if (failure === 'address') info.NetworkSettings.Ports['5432/tcp'][0].HostIp = '0.0.0.0';
    if (failure === 'database') info.Config.Env = ['POSTGRES_DB=floz'];
    vi.mocked(execFileSync).mockReturnValue(JSON.stringify([info]));
    expect(() => assertQaDatabase(input())).toThrow();
  });
  it('fails closed when Docker cannot prove ownership', () => {
    vi.mocked(execFileSync).mockImplementation(() => { throw new Error('Docker unavailable'); });
    expect(() => assertQaDatabase(input())).toThrow();
  });
  it('removes only reverified immutable QA container IDs, including volumes', () => {
    proof();
    removeQaContainers(input());
    expect(execFileSync).toHaveBeenCalledWith('docker', ['--host', qaDockerHost, 'rm', '-f', '-v', databaseId], expect.any(Object));
    expect(execFileSync).toHaveBeenCalledWith('docker', ['--host', qaDockerHost, 'rm', '-f', '-v', redisId], expect.any(Object));
  });
  it('does not run cleanup when ownership cannot be proven', () => {
    vi.mocked(execFileSync).mockClear().mockImplementation(() => { throw new Error('not owned'); });
    expect(() => removeQaContainers(input())).toThrow();
    expect(vi.mocked(execFileSync).mock.calls.every((call) => call[1]?.[2] === 'inspect')).toBe(true);
  });
  it('cleans the remaining owned container even if removal of the first fails', () => {
    proof();
    const implementation = vi.mocked(execFileSync).getMockImplementation()!;
    vi.mocked(execFileSync).mockImplementation((file, args, options) => {
      if (args?.[2] === 'rm' && args[5] === databaseId) throw new Error('remove failed');
      return implementation(file, args, options);
    });
    expect(() => cleanupOwnedQaContainers(owner)).toThrow('Disposable QA cleanup failed');
    expect(execFileSync).toHaveBeenCalledWith('docker', ['--host', qaDockerHost, 'rm', '-f', '-v', redisId], expect.any(Object));
  });
  it('recovers containers created before docker run returned an ID', () => {
    proof();
    cleanupOwnedQaContainers(owner);
    expect(execFileSync).toHaveBeenCalledWith('docker', ['--host', qaDockerHost, 'ps', '-aq', '--no-trunc', '--filter', `label=floz.qa.owner=${owner}`], expect.any(Object));
  });
  it.each([
    { PLAYWRIGHT_API_URL: 'https://example.com/api/v1' }, { PLAYWRIGHT_TEST_BASE_URL: 'http://localhost:13005' },
    { NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001' }, { BETTER_AUTH_URL: 'http://127.0.0.1:3001' },
    { API_PORT: '3001' }, { PORT: '3005' }, { BETTER_AUTH_SECRET: 'short' },
    { REDIS_URL: 'redis://127.0.0.1:6379' },
  ])('rejects divergent or unsafe service environment %j', (change) => {
    proof();
    expect(() => getE2eEnvironment({ ...input(), ...change })).toThrow();
  });
});
