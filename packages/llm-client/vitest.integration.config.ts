import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables from root .env file
config({ path: resolve(process.cwd(), '../../.env') });

export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    globals: true,
    testTimeout: 120000, // Integration tests need longer timeout for API calls
    hookTimeout: 30000,
    env: {
      // Ensure env vars are available in test environment
      ...process.env,
    },
  },
});
