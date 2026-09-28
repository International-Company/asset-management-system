import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/** Integration + API tests against a real PostgreSQL (TEST_DATABASE_URL). */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/env.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Tests share one database; run files sequentially.
    fileParallelism: false,
  },
});
