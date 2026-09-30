import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 45000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:3005',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'node ../api/dist/src/main.js',
      url: `${process.env.PLAYWRIGHT_API_URL || 'http://127.0.0.1:3001/api/v1'}/health/live`,
      reuseExistingServer: true,
      timeout: 30000,
      env: {
        DATABASE_URL: process.env.DATABASE_URL || 'postgres://postgres:***@localhost:5433/floz',
        REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || 'http://127.0.0.1:3001',
        ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || 'http://localhost:3005,http://127.0.0.1:3005',
        NODE_ENV: 'test',
        AUTH_RATE_LIMIT_MAX: '1000',
        API_PORT: process.env.API_PORT || '3001',
      },
    },
    {
      command: `npx next start -p ${process.env.PORT || '3005'}`,
      url: process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://127.0.0.1:3005',
      reuseExistingServer: true,
      timeout: 30000,
      env: {
        NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001/api/v1',
        PORT: process.env.PORT || '3005',
      },
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
