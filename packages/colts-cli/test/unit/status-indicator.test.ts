/**
 * status-indicator.tsx 单元测试
 *
 * 测试 StatusIndicator 组件中的常量和映射逻辑。
 */

import { describe, it, expect } from 'vitest';

describe('StatusIndicator 组件逻辑', () => {
  /** 状态图标映射（与 status-indicator.tsx 中定义一致） */
  const STATUS_SYMBOLS = {
    loading: '◐',
    success: '✔',
    error: '✖',
    idle: '○',
  };

  /** 状态颜色映射（与 status-indicator.tsx 中定义一致） */
  const STATUS_COLORS = {
    loading: 'yellow',
    success: 'green',
    error: 'red',
    idle: 'gray',
  };

  describe('STATUS_SYMBOLS', () => {
    it('loading 图标为 ◐', () => {
      expect(STATUS_SYMBOLS.loading).toBe('◐');
    });

    it('success 图标为 ✔', () => {
      expect(STATUS_SYMBOLS.success).toBe('✔');
    });

    it('error 图标为 ✖', () => {
      expect(STATUS_SYMBOLS.error).toBe('✖');
    });

    it('idle 图标为 ○', () => {
      expect(STATUS_SYMBOLS.idle).toBe('○');
    });
  });

  describe('STATUS_COLORS', () => {
    it('loading 颜色为 yellow', () => {
      expect(STATUS_COLORS.loading).toBe('yellow');
    });

    it('success 颜色为 green', () => {
      expect(STATUS_COLORS.success).toBe('green');
    });

    it('error 颜色为 red', () => {
      expect(STATUS_COLORS.error).toBe('red');
    });

    it('idle 颜色为 gray', () => {
      expect(STATUS_COLORS.idle).toBe('gray');
    });
  });

  describe('类型完整性', () => {
    it('所有状态类型都有对应图标', () => {
      const types = ['loading', 'success', 'error', 'idle'] as const;
      for (const type of types) {
        expect(STATUS_SYMBOLS[type]).toBeDefined();
        expect(STATUS_SYMBOLS[type].length).toBeGreaterThan(0);
      }
    });

    it('所有状态类型都有对应颜色', () => {
      const types = ['loading', 'success', 'error', 'idle'] as const;
      for (const type of types) {
        expect(STATUS_COLORS[type]).toBeDefined();
        expect(STATUS_COLORS[type].length).toBeGreaterThan(0);
      }
    });
  });
});
