import 'dotenv/config';

/** Points every test at the dedicated test database, never at dev data. */
export function applyTestEnv(): void {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error('TEST_DATABASE_URL is required for integration tests');
  process.env.DATABASE_URL = testUrl;
  process.env.APP_ENV = 'test';
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'warn';
  process.env.AUTH_PROVIDER = 'mock';
  process.env.MOCK_AUTH_PASSWORD ??= 'dev-password';
  process.env.MOCK_AUTH_FINGERPRINT ??= '000000';
  process.env.FINGERPRINT_MODE = 'code';
  process.env.STORAGE_DRIVER = 'local';
  process.env.STORAGE_LOCAL_DIR = './storage-data/test';
  process.env.ENCRYPTION_KEY ??= 'test-only-encryption-key-0123456789abcdef';
}

applyTestEnv();
