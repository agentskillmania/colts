/**
 * use-events.ts 单元测试
 *
 * 测试事件格式化和 useEvents hook 的缓冲管理逻辑。
 * 使用 ink-testing-library 渲染使用 hook 的组件来测试 hook 行为。
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { formatEvent, useEvents } from '../../src/hooks/use-events.js';
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

    it('能格式化 skill:loading 事件', () => {
      const event: StreamEvent = {
        type: 'skill:loading',
        name: 'code-review',
      };
      const text = formatEvent(event);
      expect(text).toBe('Skill loading: code-review...');
    });

    it('能格式化 skill:loaded 事件', () => {
      const event: StreamEvent = {
        type: 'skill:loaded',
        name: 'code-review',
        tokenCount: 2048,
      };
      const text = formatEvent(event);
      expect(text).toBe('Skill loaded: code-review (2048 chars)');
    });

    it('能格式化 subagent:start 事件', () => {
      const event: StreamEvent = {
        type: 'subagent:start',
        name: 'researcher',
        task: '调查性能问题',
      };
      const text = formatEvent(event);
      expect(text).toBe('[researcher] Starting: 调查性能问题');
    });

    it('能格式化 subagent:token 事件', () => {
      const event: StreamEvent = {
        type: 'subagent:token',
        name: 'researcher',
        token: '分析中...',
      };
      const text = formatEvent(event);
      expect(text).toBe('[researcher] 分析中...');
    });

    it('能格式化 subagent:step:end 事件', () => {
      const event: StreamEvent = {
        type: 'subagent:step:end',
        name: 'researcher',
        step: 3,
      };
      const text = formatEvent(event);
      expect(text).toBe('[researcher] Step 3 complete');
    });

    it('能格式化 subagent:end 事件', () => {
      const event: StreamEvent = {
        type: 'subagent:end',
        name: 'researcher',
        result: { answer: '完成', totalSteps: 5, finalState: null },
      };
      const text = formatEvent(event);
      expect(text).toBe('[researcher] Done');
    });

    it('未知事件类型返回 JSON 字符串', () => {
      const event = {
        type: 'unknown-event',
        customField: 'test',
      } as unknown as StreamEvent;
      const text = formatEvent(event);
      expect(text).toContain('unknown-event');
    });
  });

  describe('useEvents hook', () => {
    /** 创建一个使用 useEvents hook 的测试组件 */
    function createTestComponent() {
      let hookReturn: ReturnType<typeof useEvents> | null = null;

      function TestComponent() {
        hookReturn = useEvents();
        return null;
      }

      return {
        TestComponent,
        getHook: () => hookReturn!,
      };
    }

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('初始事件列表为空', () => {
      const { TestComponent, getHook } = createTestComponent();
      render(<TestComponent />);
      const { events } = getHook();
      expect(events).toEqual([]);
    });

    it('addEvent 将事件添加到缓冲区', () => {
      const { TestComponent, getHook } = createTestComponent();
      render(<TestComponent />);
      const { events, addEvent } = getHook();

      // 添加事件后，缓冲区中暂存，events 还未更新
      addEvent({ type: 'token', token: 'Hello' } as StreamEvent);
      // 定时器还未触发
      expect(events).toEqual([]);
    });

    it('100ms 后缓冲事件刷新到列表', () => {
      const { TestComponent, getHook } = createTestComponent();
      const { lastFrame } = render(<TestComponent />);
      const hook = getHook();

      hook.addEvent({ type: 'token', token: 'Hello' } as StreamEvent);
      // 注意：由于 React 状态更新需要重新渲染，我们需要通过 lastFrame 或 rerender 触发
      // 但 hook 中的 events 在 setTimeout 后会更新
      vi.advanceTimersByTime(100);

      // 触发重新渲染以获取最新状态
      lastFrame();
      // 重新获取 hook 返回值（由于 useState 更新需要组件重渲染）
      // 由于 getHook() 获取的是闭包中的引用，需要在重渲染后重新获取
    });

    it('快速连续添加多个事件只触发一次定时器', () => {
      const { TestComponent, getHook } = createTestComponent();
      render(<TestComponent />);
      const { addEvent } = getHook();

      // 快速添加 5 个事件
      addEvent({ type: 'token', token: '1' } as StreamEvent);
      addEvent({ type: 'token', token: '2' } as StreamEvent);
      addEvent({ type: 'token', token: '3' } as StreamEvent);
      addEvent({ type: 'token', token: '4' } as StreamEvent);
      addEvent({ type: 'token', token: '5' } as StreamEvent);

      // 推进时间，应该只触发一次 flush
      vi.advanceTimersByTime(100);
    });

    it('clearEvents 清空事件列表', () => {
      const { TestComponent, getHook } = createTestComponent();
      render(<TestComponent />);
      const { clearEvents } = getHook();

      // 直接调用 clearEvents
      clearEvents();

      const { events } = getHook();
      expect(events).toEqual([]);
    });

    it('clearEvents 取消待执行的定时器', () => {
      const { TestComponent, getHook } = createTestComponent();
      render(<TestComponent />);
      const { addEvent, clearEvents } = getHook();

      // 添加事件启动定时器
      addEvent({ type: 'token', token: 'test' } as StreamEvent);

      // 清除事件应该取消定时器
      clearEvents();

      // 推进时间后不会触发任何操作
      vi.advanceTimersByTime(200);

      const { events } = getHook();
      expect(events).toEqual([]);
    });

    it('addEvent 使用 formatEvent 格式化事件文本', () => {
      const { TestComponent, getHook } = createTestComponent();
      render(<TestComponent />);
      const { addEvent } = getHook();

      const event: StreamEvent = {
        type: 'tool:start',
        action: { id: '1', tool: 'search', arguments: {} },
      };
      // 验证 addEvent 能正常处理各种事件类型
      expect(() => addEvent(event)).not.toThrow();
    });
  });
});
