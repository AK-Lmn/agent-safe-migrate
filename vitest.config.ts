import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup/sandbox-home.ts'],
    testTimeout: 30000,
  },
});
