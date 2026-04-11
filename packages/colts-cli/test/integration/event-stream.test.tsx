/**
 * 事件流端到端集成测试
 *
 * User Story: Event Stream End-to-End
 * 作为 TUI 开发者，我希望 AgentRunner 产生的 StreamEvent 能被正确格式化和缓冲，
 * 以便在事件面板中展示。
 *
 * 测试 formatEvent 对所有事件类型的格式化、事件缓冲的定时刷新、唯一 ID 等完整流程。
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { formatEvent, useEvents } from '../../src/hooks/use-events.js';
import type { StreamEvent } from '@agentskillmania/colts';

describe('事件流端到端', () => {
  describe('formatEvent 事件类型覆盖', () => {
    /**
     * 场景 1: formatEvent 能正确处理所有事件类型
     */

    it('格式化 phase-change 事件', () => {
      const event: StreamEvent = {
        type: 'phase-change',
        from: { type: 'idle' },
        to: { type: 'calling-llm' },
      };
      expect(formatEvent(event)).toBe('Phase: idle → calling-llm');
    });

    it('格式化 token 事件', () => {
      const event: StreamEvent = {
        type: 'token',
        token: '你好世界',
      };
      expect(formatEvent(event)).toBe('你好世界');
    });

    it('格式化 tool:start 事件', () => {
      const event: StreamEvent = {
        type: 'tool:start',
        action: {
          id: 'call_123',
          tool: 'file-reader',
          arguments: { path: '/tmp/test.txt' },
        },
      };
      expect(formatEvent(event)).toBe('Tool: file-reader');
    });

    it('格式化 tool:end 事件（字符串结果）', () => {
      const event: StreamEvent = {
        type: 'tool:end',
        result: '这是一个很长很长很长很长很长很长很长很长的工具执行结果需要被截断',
      };
      const text = formatEvent(event);
      expect(text).toContain('Result: ');
      // 字符串结果截断到 50 字符
      expect(text.length).toBeLessThanOrEqual('Result: '.length + 50);
    });

    it('格式化 tool:end 事件（对象结果）', () => {
      const event: StreamEvent = {
        type: 'tool:end',
        result: { files: ['a.ts', 'b.ts'], count: 2 },
      };
      const text = formatEvent(event);
      expect(text).toContain('Result: ');
      expect(text).toContain('files');
    });

    it('格式化 error 事件', () => {
      const event: StreamEvent = {
        type: 'error',
        error: new Error('连接超时'),
        context: { step: 3, toolName: 'http-client' },
      };
      expect(formatEvent(event)).toBe('Error: 连接超时');
    });

    it('格式化 compressing 事件', () => {
      const event: StreamEvent = {
        type: 'compressing',
      };
      expect(formatEvent(event)).toBe('Compressing context...');
    });

    it('格式化 compressed 事件', () => {
      const event: StreamEvent = {
        type: 'compressed',
        summary: '摘要内容',
        removedCount: 42,
      };
      expect(formatEvent(event)).toBe('Compressed: 42 messages');
    });

    it('格式化 skill:loading 事件', () => {
      const event: StreamEvent = {
        type: 'skill:loading',
        name: 'code-review',
      };
      expect(formatEvent(event)).toBe('Skill loading: code-review...');
    });

    it('格式化 skill:loaded 事件', () => {
      const event: StreamEvent = {
        type: 'skill:loaded',
        name: 'code-review',
        tokenCount: 4096,
      };
      expect(formatEvent(event)).toBe('Skill loaded: code-review (4096 chars)');
    });

    it('格式化 subagent:start 事件', () => {
      const event: StreamEvent = {
        type: 'subagent:start',
        name: 'researcher',
        task: '搜索最新文档',
      };
      expect(formatEvent(event)).toBe('[researcher] Starting: 搜索最新文档');
    });

    it('格式化 subagent:token 事件', () => {
      const event: StreamEvent = {
        type: 'subagent:token',
        name: 'researcher',
        token: '正在分析...',
      };
      expect(formatEvent(event)).toBe('[researcher] 正在分析...');
    });

    it('格式化 subagent:step:end 事件', () => {
      const event: StreamEvent = {
        type: 'subagent:step:end',
        name: 'researcher',
        step: 7,
      };
      expect(formatEvent(event)).toBe('[researcher] Step 7 complete');
    });

    it('格式化 subagent:end 事件', () => {
      const event: StreamEvent = {
        type: 'subagent:end',
        name: 'researcher',
        result: { answer: '完成', totalSteps: 7, finalState: null },
      };
      expect(formatEvent(event)).toBe('[researcher] Done');
    });
  });

  /**
   * 场景 2: formatEvent 处理未知事件类型，使用 JSON.stringify 回退
   */
  it('formatEvent 处理未知事件类型时返回 JSON 字符串', () => {
    const unknownEvent = {
      type: 'custom-unknown-type',
      data: { foo: 'bar', nested: { value: 42 } },
    } as unknown as StreamEvent;

    const text = formatEvent(unknownEvent);
    expect(text).toContain('custom-unknown-type');
    expect(text).toContain('foo');
    // 应该是合法的 JSON 字符串
    expect(() => JSON.parse(text)).not.toThrow();
  });

  describe('useEvents hook 事件缓冲', () => {
    /**
     * 创建一个使用 useEvents hook 的测试包装组件。
     *
     * 使用响应式容器对象（reactive）保存 hook 返回值。
     * 每次 React 重渲染时，容器中的 hookResult 会被更新。
     * 由于 useEvents 通过 useState 管理 events，flushEvents 触发
     * setState 后组件会重渲染，hookResult 会指向最新的返回值。
     */
    function createWrapper() {
      // 使用可变容器，确保每次渲染都能拿到最新 hook 返回值
      const container: { current: ReturnType<typeof useEvents> | null } = {
        current: null,
      };

      function Wrapper() {
        // 每次渲染（包括 setState 触发的重渲染）都会更新 container.current
        container.current = useEvents();
        return null;
      }

      return {
        Wrapper,
        /** 获取最新的 hook 返回值 */
        getHook: () => container.current!,
      };
    }

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /**
     * 场景 3: 事件缓冲区在 100ms 后刷新（使用 vi.useFakeTimers）
     */
    it('事件缓冲区在 100ms 后刷新', () => {
      const { Wrapper, getHook } = createWrapper();
      render(<Wrapper />);

      // 添加事件，此时在缓冲区中
      getHook().addEvent({ type: 'token', token: '缓冲测试' } as StreamEvent);

      // 定时器未触发，events 仍为空
      expect(getHook().events).toEqual([]);

      // 推进 100ms，触发刷新（React setState 后组件重渲染，hook 返回值更新）
      vi.advanceTimersByTime(100);

      // 刷新后事件应该出现在列表中
      expect(getHook().events).toHaveLength(1);
      expect(getHook().events[0].text).toBe('缓冲测试');
    });

    /**
     * 场景 4: 快速连续添加多个事件 → 单次刷新
     */
    it('快速连续添加多个事件后仅触发单次刷新', () => {
      const { Wrapper, getHook } = createWrapper();
      render(<Wrapper />);

      // 快速连续添加 5 个事件
      getHook().addEvent({ type: 'token', token: '事件1' } as StreamEvent);
      getHook().addEvent({ type: 'token', token: '事件2' } as StreamEvent);
      getHook().addEvent({ type: 'token', token: '事件3' } as StreamEvent);
      getHook().addEvent({ type: 'token', token: '事件4' } as StreamEvent);
      getHook().addEvent({ type: 'token', token: '事件5' } as StreamEvent);

      // 推进 100ms，应该只触发一次 flush，但所有事件都应该被刷新
      vi.advanceTimersByTime(100);

      // 所有 5 个事件应该一起出现在列表中
      expect(getHook().events).toHaveLength(5);
      expect(getHook().events[0].text).toBe('事件1');
      expect(getHook().events[4].text).toBe('事件5');
    });

    /**
     * 场景 5: clearEvents 取消待执行的定时器
     */
    it('clearEvents 取消待执行的定时器', () => {
      const { Wrapper, getHook } = createWrapper();
      render(<Wrapper />);

      // 添加事件，启动 100ms 定时器
      getHook().addEvent({ type: 'token', token: '待清除' } as StreamEvent);

      // 在定时器触发前清除事件
      getHook().clearEvents();

      // 推进时间超过 100ms
      vi.advanceTimersByTime(200);

      // 事件列表应该为空（定时器被取消，缓冲区被清空）
      expect(getHook().events).toEqual([]);
    });

    /**
     * 场景 6: 事件有唯一 ID
     */
    it('每个事件都有唯一 ID', () => {
      const { Wrapper, getHook } = createWrapper();
      render(<Wrapper />);

      // 添加多个同类型事件
      getHook().addEvent({ type: 'token', token: 'A' } as StreamEvent);
      getHook().addEvent({ type: 'token', token: 'B' } as StreamEvent);
      getHook().addEvent({ type: 'token', token: 'C' } as StreamEvent);

      vi.advanceTimersByTime(100);

      const events = getHook().events;
      expect(events).toHaveLength(3);

      // 所有 ID 应该是唯一的
      const ids = events.map((e) => e.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);

      // ID 不应为空
      for (const id of ids) {
        expect(id).toBeTruthy();
        expect(typeof id).toBe('string');
      }
    });
  });
});
