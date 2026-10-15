import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { cleanupOwnedQaContainers, getE2eEnvironment, qaDocker, qaDockerHost } from './e2e-environment';

if (process.versions.node.split('.')[0] !== '22') throw new Error('E2E requires Node.js 22');
const owner = randomBytes(16).toString('hex');
const resources: string[] = [];
const env = { ...process.env };
for (const key of ['DATABASE_URL', 'REDIS_URL', 'BETTER_AUTH_URL', 'NEXT_PUBLIC_API_URL', 'API_PORT', 'PORT', 'ALLOWED_ORIGINS', 'FLOZ_TEST_REPORTING_NOW', 'FLOZ_NEXT_DIST_DIR']) delete env[key];
const docker = (...args: string[]) => qaDocker(args);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  try { cleanupOwnedQaContainers(owner); } finally { process.exit(1); }
});
const port = () => new Promise<number>((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const address = server.address(); server.close(() => typeof address === 'object' && address ? resolve(address.port) : reject(new Error('Port allocation failed'))); });
});
function run(args: string[], cwd = process.cwd()) {
  const result = spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw result.error || new Error(`QA command failed (${result.status}): ${args.join(' ')}`);
}

async function main() {
  try {
    const ports = new Set<number>();
    while (ports.size < 4) ports.add(await port());
    const [database, redis, api, web] = [...ports];
    for (const [kind, image, hostPort, internal, extra] of [
      ['pg', 'postgres:16-alpine', database, 5432, ['-e', `POSTGRES_DB=floz_qa_${owner}`, '-e', 'POSTGRES_USER=postgres', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '--tmpfs', '/var/lib/postgresql/data']],
      ['redis', 'redis:7-alpine', redis, 6379, ['--tmpfs', '/data']],
    ] as const) {
      resources.push(docker('run', '--rm', '-d', '--name', `floz-e2e-${kind}-${owner}`, '--label', `floz.qa.owner=${owner}`, '--label', 'floz.qa.disposable=true', '-p', `127.0.0.1:${hostPort}:${internal}`, ...extra, image));
    }
    Object.assign(env, {
      FLOZ_QA_OWNER: owner, FLOZ_QA_DATABASE_CONTAINER: resources[0], FLOZ_QA_REDIS_CONTAINER: resources[1],
      DATABASE_URL: `postgres://postgres@127.0.0.1:${database}/floz_qa_${owner}`, REDIS_URL: `redis://127.0.0.1:${redis}`,
      PLAYWRIGHT_API_URL: `http://127.0.0.1:${api}/api/v1`, PLAYWRIGHT_TEST_BASE_URL: `http://127.0.0.1:${web}`,
      BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    });
    Object.assign(env, getE2eEnvironment(env));
    console.log(`Disposable QA proven: owner=${owner}; ports db=${database}, redis=${redis}, api=${api}, web=${web}`);
    for (let attempt = 0; ; attempt++) {
      if (spawnSync('docker', ['--host', qaDockerHost, 'exec', resources[0], 'pg_isready', '-U', 'postgres', '-d', `floz_qa_${owner}`], { stdio: 'ignore' }).status === 0) break;
      if (attempt === 59) throw new Error('Disposable PostgreSQL not ready');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const pnpm = process.env.npm_execpath;
    if (!pnpm) throw new Error('Run E2E via pnpm --filter @floz/web e2e');
    run([pnpm, '--filter', '@floz/database', 'migrate']);
    env.NODE_ENV = 'production';
    run([pnpm, 'run', 'build'], '../..');
    env.NODE_ENV = 'test';
    run(['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)]);
  } finally {
    cleanupOwnedQaContainers(owner);
  }
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
