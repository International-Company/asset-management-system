import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the real API + PostgreSQL + built web app.
 * The API runs against TEST_DATABASE_URL (see apps/api/test/env.ts);
 * run `npm run test:integration` first so the test DB is migrated and seeded.
 */
const API_PORT = 3100;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    locale: 'ar',
    timezoneId: 'Asia/Hebron',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'node e2e/start-api.mjs',
      url: `http://localhost:${API_PORT}/api/v1/health`,
      env: { PORT: String(API_PORT) },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npm run preview -w @osooli/web',
      url: 'http://localhost:4173',
      env: { API_URL: `http://localhost:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
