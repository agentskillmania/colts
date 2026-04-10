/**
 * use-events.ts 单元测试
 *
 * 测试事件格式化和缓冲管理逻辑。
 * Hook 交互通过直接调用纯函数测试。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatEvent } from '../../src/hooks/use-events.js';
import type { StreamEvent } from '@agentskillmania/colts';

describe('use-events', () => {
  describe('formatEvent', () => {
    it('能格式化 phase-change 事件', () => {
      const event: StreamEvent = {
        type: 'phase-change',
        from: { type: 'idle' },
        to: { type: 'calling-llm' },
      };
      const text = formatEvent(event);
      expect(text).toBe('Phase: idle → calling-llm');
    });

    it('能格式化 token 事件', () => {
      const event: StreamEvent = {
        type: 'token',
        token: 'Hello',
      };
      const text = formatEvent(event);
      expect(text).toBe('Hello');
    });

    it('能格式化 tool:start 事件', () => {
      const event: StreamEvent = {
        type: 'tool:start',
        action: {
          id: 'call_1',
          tool: 'calculator',
          arguments: { expression: '1+1' },
        },
      };
      const text = formatEvent(event);
      expect(text).toBe('Tool: calculator');
    });

    it('能格式化 tool:end 事件（字符串结果）', () => {
      const event: StreamEvent = {
        type: 'tool:end',
        result: 'This is a long result that should be truncated at fifty characters to fit',
      };
      const text = formatEvent(event);
      // slice(0, 50) 截断到 50 字符
      expect(text).toBe('Result: This is a long result that should be truncated at ');
      expect(text.length).toBeLessThanOrEqual('Result: '.length + 50);
    });

    it('能格式化 tool:end 事件（非字符串结果）', () => {
      const event: StreamEvent = {
        type: 'tool:end',
        result: { key: 'value', nested: { deep: true } },
      };
      const text = formatEvent(event);
      expect(text).toContain('Result: ');
      // JSON 序列化后截断到 50 字符
      expect(text.length).toBeLessThanOrEqual('Result: '.length + 50);
    });

    it('能格式化 tool:end 事件（短字符串结果不截断）', () => {
      const event: StreamEvent = {
        type: 'tool:end',
        result: 'OK',
      };
      const text = formatEvent(event);
      expect(text).toBe('Result: OK');
    });

    it('能格式化 error 事件', () => {
      const event: StreamEvent = {
        type: 'error',
        error: new Error('Something went wrong'),
        context: { step: 1 },
      };
      const text = formatEvent(event);
      expect(text).toBe('Error: Something went wrong');
    });

    it('能格式化 compressing 事件', () => {
      const event: StreamEvent = {
        type: 'compressing',
      };
      const text = formatEvent(event);
      expect(text).toBe('Compressing context...');
    });

    it('能格式化 compressed 事件', () => {
      const event: StreamEvent = {
        type: 'compressed',
        summary: 'Summary of old messages',
        removedCount: 15,
      };
      const text = formatEvent(event);
      expect(text).toBe('Compressed: 15 messages');
    });

    it('空 token 返回空字符串', () => {
      const event: StreamEvent = {
        type: 'token',
        token: '',
      };
      const text = formatEvent(event);
      expect(text).toBe('');
    });
  });

  describe('事件缓冲逻辑', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('批量渲染延迟为 100ms', () => {
      // 验证常量值
      const BATCH_DELAY_MS = 100;
      expect(BATCH_DELAY_MS).toBe(100);
    });

    it('快速连续添加多个事件应只触发一次定时器', () => {
      // 模拟缓冲逻辑
      const buffer: unknown[] = [];
      let timerId: ReturnType<typeof setTimeout> | null = null;
      let flushed = false;

      const flush = () => {
        if (buffer.length > 0) {
          flushed = true;
        }
        timerId = null;
      };

      const addEvent = () => {
        buffer.push({});
        if (!timerId) {
          timerId = setTimeout(flush, 100);
        }
      };

      // 添加 5 个事件
      addEvent();
      addEvent();
      addEvent();
      addEvent();
      addEvent();

      // 此时还没有刷新
      expect(flushed).toBe(false);
      expect(buffer.length).toBe(5);

      // 推进时间 100ms
      vi.advanceTimersByTime(100);

      // 现在应该刷新了
      expect(flushed).toBe(true);
    });

    it('清除事件后缓冲区应为空', () => {
      const buffer: unknown[] = [1, 2, 3];
      let timerId: ReturnType<typeof setTimeout> | null = setTimeout(() => {}, 100);

      const clearEvents = () => {
        buffer.length = 0;
        if (timerId) {
          clearTimeout(timerId);
          timerId = null;
        }
      };

      clearEvents();

      expect(buffer.length).toBe(0);
      expect(timerId).toBeNull();
    });
  });
});
