import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup-env.js'],
    globalSetup: ['./tests/global-setup.js'],
    // Test files share one database, so run them one at a time.
    fileParallelism: false,
    testTimeout: 15000,
  },
});
