import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the real API + PostgreSQL + built web app.
 * The API runs against TEST_DATABASE_URL (see apps/api/test/env.ts);
 * run `npm run test:integration` first so the test DB is migrated and seeded.
 */
const API_PORT = 3100;
/** A second API + web pair with real passkeys (FINGERPRINT_MODE=passkey), for e2e/passkey.spec.ts. */
const PASSKEY_API_PORT = 3200;
const PASSKEY_WEB_PORT = 4273;

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
    // The quick sign-in offer after each full sign-in is turned off ("don't ask
    // again"); e2e/quick-login.spec.ts turns it back on.
    storageState: {
      cookies: [],
      origins: [`http://localhost:4173`, `http://localhost:${PASSKEY_WEB_PORT}`].map((origin) => ({ origin, localStorage: [{ name: 'osooli.quickNever', value: '1' }] })),
    },
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
    {
      command: 'node e2e/start-api.mjs',
      url: `http://localhost:${PASSKEY_API_PORT}/api/v1/health`,
      env: { PORT: String(PASSKEY_API_PORT), E2E_FINGERPRINT_MODE: 'passkey', E2E_WEB_ORIGIN: `http://localhost:${PASSKEY_WEB_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npm run preview -w @osooli/web -- --port ${PASSKEY_WEB_PORT} --strictPort`,
      url: `http://localhost:${PASSKEY_WEB_PORT}`,
      env: { API_URL: `http://localhost:${PASSKEY_API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
