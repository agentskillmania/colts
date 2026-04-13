/**
 * @fileoverview useAgent 流式逻辑单元测试
 *
 * 测试 parseCommand + 模拟流式逻辑，验证 TimelineEntry 状态更新正确性。
 */

import { describe, it, expect, vi } from 'vitest';
import type { AgentState, StreamEvent } from '@agentskillmania/colts';
import { parseCommand } from '../../src/hooks/use-agent.js';
import type { TimelineEntry } from '../../src/types/timeline.js';
import { filterByDetailLevel } from '../../src/types/timeline.js';

describe('useAgent 流式逻辑', () => {
  describe('parseCommand', () => {
    it('应该解析所有命令类型', () => {
      expect(parseCommand('/run').type).toBe('mode-run');
      expect(parseCommand('/step').type).toBe('mode-step');
      expect(parseCommand('/advance').type).toBe('mode-advance');
      expect(parseCommand('/clear').type).toBe('clear');
      expect(parseCommand('/help').type).toBe('help');
      expect(parseCommand('/skill test').type).toBe('skill');
      expect(parseCommand('hello').type).toBe('message');
      expect(parseCommand('/show:compact').type).toBe('show-compact');
      expect(parseCommand('/show:detail').type).toBe('show-detail');
      expect(parseCommand('/show:verbose').type).toBe('show-verbose');
    });

    it('应该提取 /skill 参数', () => {
      const cmd = parseCommand('/skill my-skill');
      expect(cmd.skillName).toBe('my-skill');
    });

    it('空 skill 名不匹配', () => {
      const cmd = parseCommand('/skill ');
      expect(cmd.type).toBe('message');
    });
  });

  describe('TimelineEntry 状态更新模拟', () => {
    it('模拟 token 累积到 assistant 条目', () => {
      const assistantId = 'asst-1';
      let entries: TimelineEntry[] = [
        {
          type: 'assistant',
          id: assistantId,
          content: '',
          timestamp: Date.now(),
          isStreaming: true,
        },
      ];

      // 模拟 token 事件
      const tokens = ['Hello', ' world'];
      let accumulated = '';
      for (const token of tokens) {
        accumulated += token;
        entries = entries.map((e) =>
          e.type === 'assistant' && e.id === assistantId ? { ...e, content: accumulated } : e
        );
      }

      expect(entries[0].type).toBe('assistant');
      const asstEntry = entries[0] as Extract<TimelineEntry, { type: 'assistant' }>;
      expect(asstEntry.content).toBe('Hello world');
      expect(asstEntry.isStreaming).toBe(true);
    });

    it('模拟 tool:start + tool:end 条目', () => {
      let entries: TimelineEntry[] = [];

      // tool:start
      const toolId = 'tool-1';
      entries = [
        ...entries,
        { type: 'tool', id: toolId, tool: 'read_file', isRunning: true, timestamp: Date.now() },
      ];

      // tool:end — 更新最近的 running tool
      const idx = entries.findLastIndex
        ? entries.findLastIndex((e) => e.type === 'tool' && e.isRunning)
        : (() => {
            for (let i = entries.length - 1; i >= 0; i--) {
              const e = entries[i];
              if (e.type === 'tool' && e.isRunning) return i;
            }
            return -1;
          })();
      if (idx >= 0) {
        entries = entries.map((e, i) =>
          i === idx ? { ...e, result: 'file content', isRunning: false } : e
        );
      }

      expect(entries).toHaveLength(1);
      const toolEntry = entries[0] as Extract<TimelineEntry, { type: 'tool' }>;
      expect(toolEntry.tool).toBe('read_file');
      expect(toolEntry.result).toBe('file content');
      expect(toolEntry.isRunning).toBe(false);
    });

    it('模拟 stepStream token 累积', () => {
      const events: StreamEvent[] = [
        { type: 'token', token: 'Step ' },
        { type: 'token', token: 'result' },
        {
          type: 'tool:start',
          action: { id: 'a1', tool: 'read_file', arguments: { path: '/test' } },
        },
      ];

      let accumulated = '';
      const tools: string[] = [];

      for (const event of events) {
        if (event.type === 'token' && event.token) accumulated += event.token;
        if (event.type === 'tool:start') tools.push(event.action.tool);
      }

      expect(accumulated).toBe('Step result');
      expect(tools).toEqual(['read_file']);
    });

    it('模拟 advanceStream phase 变化', () => {
      const events: StreamEvent[] = [
        { type: 'phase-change', from: { type: 'idle' }, to: { type: 'calling-llm' } },
        { type: 'token', token: 'thinking...' },
        { type: 'phase-change', from: { type: 'calling-llm' }, to: { type: 'executing-tool' } },
      ];

      const phases: string[] = [];
      let tokens = '';

      for (const event of events) {
        if (event.type === 'phase-change') phases.push(`${event.from.type}->${event.to.type}`);
        if (event.type === 'token' && event.token) tokens += event.token;
      }

      expect(phases).toEqual(['idle->calling-llm', 'calling-llm->executing-tool']);
      expect(tokens).toBe('thinking...');
    });
  });

  describe('完整对话流模拟', () => {
    it('用户消息 + 助手流式 + 完成', () => {
      const assistantId = 'asst-1';
      let entries: TimelineEntry[] = [
        { type: 'user', id: 'user-1', content: 'What is 2+2?', timestamp: Date.now() },
        {
          type: 'assistant',
          id: assistantId,
          content: '',
          timestamp: Date.now(),
          isStreaming: true,
        },
      ];

      // 模拟流式 token
      const tokens = ['2+2', ' equals 4'];
      let accumulated = '';
      for (const token of tokens) {
        accumulated += token;
        entries = entries.map((e) =>
          e.type === 'assistant' && e.id === assistantId ? { ...e, content: accumulated } : e
        );
      }

      // 模拟完成
      entries = entries.map((e) =>
        e.type === 'assistant' && e.id === assistantId ? { ...e, isStreaming: false } : e
      );

      expect(entries).toHaveLength(2);
      const user = entries[0] as Extract<TimelineEntry, { type: 'user' }>;
      const asst = entries[1] as Extract<TimelineEntry, { type: 'assistant' }>;
      expect(user.content).toBe('What is 2+2?');
      expect(asst.content).toBe('2+2 equals 4');
      expect(asst.isStreaming).toBe(false);
    });

    it('DetailLevel 过滤正确性', () => {
      const entries: TimelineEntry[] = [
        { type: 'user', id: '1', content: 'hi', timestamp: Date.now() },
        { type: 'phase', id: '2', from: 'idle', to: 'calling-llm', timestamp: Date.now() },
        { type: 'assistant', id: '3', content: 'hello', timestamp: Date.now() },
        { type: 'thought', id: '4', content: 'thinking', timestamp: Date.now() },
      ];

      const compact = filterByDetailLevel(entries, 'compact');
      expect(compact.map((e) => e.type)).toEqual(['user', 'assistant']);

      const verbose = filterByDetailLevel(entries, 'verbose');
      expect(verbose.map((e) => e.type)).toEqual(['user', 'phase', 'assistant', 'thought']);
    });
  });
});
