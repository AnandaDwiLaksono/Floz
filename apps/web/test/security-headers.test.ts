import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(__filename);
const next = require.resolve('next/dist/bin/next');
const port = 3199;
const baseUrl = `http://127.0.0.1:${port}`;
const distDir = '.next-security-headers-test';
const env = { ...process.env, FLOZ_NEXT_DIST_DIR: distDir };
let server: ChildProcess;

async function buildApp() {
  const build = spawn(process.execPath, [next, 'build'], { env, stdio: 'inherit' });
  const [code] = await once(build, 'exit');
  expect(code).toBe(0);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await fetch(`${baseUrl}/login`);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('Next server did not start');
}

describe('production security headers', () => {
  beforeAll(async () => {
    await buildApp();
    server = spawn(process.execPath, [next, 'start', '--hostname', '127.0.0.1', '--port', String(port)], { env, stdio: 'ignore' });
    await waitForServer();
  }, 240000);

  afterAll(async () => {
    if (server) {
      server.kill();
      await once(server, 'exit').catch(() => undefined);
    }
    await rm(distDir, { recursive: true, force: true });
  });

  it('serves the exact security headers', async () => {
    const response = await fetch(`${baseUrl}/login`);

    expect(response.headers.get('strict-transport-security')).toBe('max-age=15552000');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('content-security-policy')).toBe("base-uri 'self'; object-src 'none'; frame-ancestors 'none'");
  });

  it('hydrates without CSP errors', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(`${baseUrl}/login`);
    await page.getByLabel('Email').fill('hydrated@example.com');

    expect(await page.getByLabel('Email').inputValue()).toBe('hydrated@example.com');
    expect(errors.filter((error) => /content security policy|hydration/i.test(error))).toEqual([]);
    await browser.close();
  });
});
