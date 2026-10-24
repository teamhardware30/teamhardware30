import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    include: ['test/**/*.e2e-spec.ts'],
    environment: 'node',
    globals: true,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
