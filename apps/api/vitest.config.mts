import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/** Unit tests: no database, no network. SWC emits the decorator metadata NestJS needs. */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
