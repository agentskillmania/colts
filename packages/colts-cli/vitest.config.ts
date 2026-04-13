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
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/types.ts',
        'src/index.ts',
        'src/app.tsx',
        'src/hooks/use-agent.ts',
        'src/hooks/use-events.ts',
        'src/theme/colts-theme.ts',
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 88,
        statements: 90,
      },
    },
  },
});
