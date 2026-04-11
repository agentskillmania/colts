import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';

// 从根 .env 文件加载环境变量
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
