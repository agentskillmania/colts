import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';

// Load environment variables from root .env file
dotenv.config({ path: '../../.env' });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/types.ts', 'src/index.ts'], // type definitions and index files not counted for coverage
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
});
