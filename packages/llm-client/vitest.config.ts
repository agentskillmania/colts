import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';

// 从根 .env 文件加载环境变量（集成测试需要 API key 和 ENABLE_INTEGRATION_TESTS）
dotenv.config({ path: '../../.env' });

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['node_modules/', 'dist/', '**/*.test.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
