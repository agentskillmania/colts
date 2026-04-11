/**
 * theme.ts 单元测试
 *
 * 测试语义颜色定义和 ThemeColor 类型。
 */

import { describe, it, expect } from 'vitest';
import { theme } from '../../src/utils/theme.js';

describe('theme', () => {
  describe('颜色值', () => {
    it('success 颜色为 green', () => {
      expect(theme.success).toBe('green');
    });

    it('error 颜色为 red', () => {
      expect(theme.error).toBe('red');
    });

    it('info 颜色为 cyan', () => {
      expect(theme.info).toBe('cyan');
    });

    it('warning 颜色为 yellow', () => {
      expect(theme.warning).toBe('yellow');
    });

    it('tool 颜色为 gray', () => {
      expect(theme.tool).toBe('gray');
    });

    it('dim 颜色为 gray', () => {
      expect(theme.dim).toBe('gray');
    });

    it('user 颜色为 blue', () => {
      expect(theme.user).toBe('blue');
    });

    it('assistant 颜色为 white', () => {
      expect(theme.assistant).toBe('white');
    });

    it('accent 颜色为 magenta', () => {
      expect(theme.accent).toBe('magenta');
    });
  });

  describe('结构完整性', () => {
    it('包含所有 9 个语义颜色键', () => {
      const keys = Object.keys(theme);
      expect(keys).toHaveLength(9);
    });

    it('所有颜色值都是非空字符串', () => {
      for (const value of Object.values(theme)) {
        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
      }
    });

    it('对象被标记为 const（readonly）', () => {
      // theme 被 as const 标记，验证所有值确实是字符串字面量类型
      expect(theme.success).toBe('green' as const);
      expect(theme.error).toBe('red' as const);
    });
  });
});
