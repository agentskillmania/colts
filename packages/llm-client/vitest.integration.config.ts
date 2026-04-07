import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    globals: true,
    testTimeout: 120000, // Integration tests need longer timeout for API calls
    hookTimeout: 30000,
  },
});
