import { defineConfig, devices } from '@playwright/test';
import { getE2eEnvironment } from './e2e-environment';

// Config is evaluated in the runner and workers, before any fixture or server can mutate data.
const env = getE2eEnvironment();
Object.assign(process.env, env);

export default defineConfig({
  testDir: './e2e',
  timeout: 45000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  globalTeardown: './e2e/teardown.ts',
  use: {
    baseURL: env.PLAYWRIGHT_TEST_BASE_URL,
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'node ../api/dist/src/main.js',
      url: `${env.PLAYWRIGHT_API_URL}/health/ready`,
      reuseExistingServer: false,
      timeout: 30000,
      env,
    },
    {
      command: `node node_modules/next/dist/bin/next start -H 127.0.0.1 -p ${env.PORT}`,
      url: `${env.PLAYWRIGHT_TEST_BASE_URL}/login`,
      reuseExistingServer: false,
      timeout: 30000,
      env,
    },
    {
      command: 'node ../worker/dist/main.js',
      wait: { stdout: /worker started/ },
      timeout: 30000,
      env,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
