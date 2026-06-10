import { defineConfig, devices } from '@playwright/test';

const API_URL = process.env['API_URL'] ?? 'http://localhost:3001';
const DASHBOARD_URL = process.env['DASHBOARD_URL'] ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env['CI'] ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'api',
      testMatch: /.*\.spec\.ts/,
      use: {
        baseURL: API_URL,
        extraHTTPHeaders: { 'Content-Type': 'application/json' },
      },
    },
    {
      name: 'dashboard',
      testMatch: /(connector-setup|onboarding-golden-path)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: DASHBOARD_URL,
      },
    },
  ],
});
