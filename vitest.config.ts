import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  // esbuild (Vite/Vitest's default TS transform) doesn't emit the
  // `design:paramtypes` metadata Nest's DI relies on, so constructor
  // injection silently resolves to undefined. swc does emit it.
  plugins: [swc.vite()],
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    environment: 'node',
    globals: true,
    testTimeout: 30_000,
  },
});
