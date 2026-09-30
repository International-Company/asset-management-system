// Starts the built API against the test database for E2E runs.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { config } from 'dotenv';

const apiDir = resolve(import.meta.dirname, '..', 'apps', 'api');
config({ path: resolve(apiDir, '.env') });

const env = {
  ...process.env,
  APP_ENV: 'test',
  NODE_ENV: 'test',
  LOG_LEVEL: 'warn',
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  AUTH_PROVIDER: 'mock',
  MOCK_AUTH_PASSWORD: process.env.MOCK_AUTH_PASSWORD ?? 'dev-password',
  MOCK_AUTH_FINGERPRINT: process.env.MOCK_AUTH_FINGERPRINT ?? '000000',
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_DIR: './storage-data/e2e',
  WEB_ORIGIN: process.env.E2E_WEB_ORIGIN ?? 'http://localhost:4173',
  // 'passkey' for the server pair that tests real fingerprints (e2e/passkey.spec.ts).
  FINGERPRINT_MODE: process.env.E2E_FINGERPRINT_MODE ?? 'code',
};
if (!env.DATABASE_URL) throw new Error('TEST_DATABASE_URL is required for E2E');

const child = spawn(process.execPath, ['dist/main.js'], { cwd: apiDir, env, stdio: 'inherit' });
const stop = () => child.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));
