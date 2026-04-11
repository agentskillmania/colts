/**
 * @fileoverview useAgent streaming 逻辑单元测试
 *
 * 直接测试 parseCommand + 模拟 streaming 逻辑，验证消息状态更新正确性。
 */

import { describe, it, expect, vi } from 'vitest';
import type {
  AgentRunner,
  AgentState,
  StreamEvent,
  StepResult,
  RunResult,
} from '@agentskillmania/colts';
import { parseCommand } from '../../src/hooks/use-agent.js';
import type { ChatMessage } from '../../src/hooks/use-agent.js';

/**
 * 模拟 chatStream 返回的 chunks
 */
function createMockChatStream() {
  const chunks = [
    {
      type: 'text' as const,
      delta: 'Hello',
      accumulatedContent: 'Hello',
      state: null as unknown as AgentState,
    },
    {
      type: 'text' as const,
      delta: ' world',
      accumulatedContent: 'Hello world',
      state: null as unknown as AgentState,
    },
    {
      type: 'done' as const,
      state: {
        id: 'result-state',
        config: { name: 'test', instructions: 't', tools: [] },
        context: { messages: [], stepCount: 1 },
      } as AgentState,
      tokens: { input: 10, output: 5 },
    },
  ];
  return chunks;
}

describe('useAgent streaming logic', () => {
  describe('parseCommand', () => {
    it('所有命令类型都能解析', () => {
      expect(parseCommand('/run').type).toBe('mode-run');
      expect(parseCommand('/step').type).toBe('mode-step');
      expect(parseCommand('/advance').type).toBe('mode-advance');
      expect(parseCommand('/clear').type).toBe('clear');
      expect(parseCommand('/help').type).toBe('help');
      expect(parseCommand('/skill test').type).toBe('skill');
      expect(parseCommand('hello').type).toBe('message');
    });

    it('/skill 参数提取', () => {
      const cmd = parseCommand('/skill my-skill');
      expect(cmd.skillName).toBe('my-skill');
    });

    it('空 skill 名匹配不到', () => {
      // /skill 后跟空格但无名称 -> trim 后是 "/skill"，不匹配 startsWith('/skill ')
      const cmd = parseCommand('/skill ');
      expect(cmd.type).toBe('message');
    });
  });

  describe('消息状态更新模拟', () => {
    it('模拟 chatStream 消息累积', () => {
      const chunks = createMockChatStream();
      const assistantMsg: ChatMessage = {
        id: 'test-id',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
      };

      let messages = [assistantMsg];

      for (const chunk of chunks) {
        if (chunk.type === 'text' && chunk.delta) {
          messages = messages.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: chunk.accumulatedContent ?? m.content + chunk.delta }
              : m
          );
        }
        if (chunk.type === 'done') {
          messages = messages.map((m) =>
            m.id === assistantMsg.id ? { ...m, isStreaming: false } : m
          );
        }
      }

      expect(messages[0].content).toBe('Hello world');
      expect(messages[0].isStreaming).toBe(false);
    });

    it('模拟 chatStream 错误处理', () => {
      const chunks = [
        { type: 'error' as const, error: 'API rate limit', state: null as unknown as AgentState },
      ];

      const assistantMsg: ChatMessage = {
        id: 'test-id',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
      };

      let messages = [assistantMsg];

      for (const chunk of chunks) {
        if (chunk.type === 'error') {
          messages = messages.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: `Error: ${chunk.error}`, isStreaming: false }
              : m
          );
        }
      }

      expect(messages[0].content).toBe('Error: API rate limit');
      expect(messages[0].isStreaming).toBe(false);
    });

    it('模拟 stepStream token 累积', () => {
      const events: StreamEvent[] = [
        { type: 'token', token: 'Step ' },
        { type: 'token', token: 'result' },
        { type: 'tool:start', action: { tool: 'read_file', parameters: { path: '/test' } } },
      ];

      let accumulated = '';
      let toolCalls: string[] = [];

      for (const event of events) {
        if (event.type === 'token' && event.token) {
          accumulated += event.token;
        }
        if (event.type === 'tool:start') {
          toolCalls.push(event.action.tool);
        }
      }

      expect(accumulated).toBe('Step result');
      expect(toolCalls).toEqual(['read_file']);
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
        if (event.type === 'phase-change') {
          phases.push(`${event.from.type}->${event.to.type}`);
        }
        if (event.type === 'token' && event.token) {
          tokens += event.token;
        }
      }

      expect(phases).toEqual(['idle->calling-llm', 'calling-llm->executing-tool']);
      expect(tokens).toBe('thinking...');
    });
  });

  describe('用户消息 + 助手消息组合', () => {
    it('完整对话流程模拟', () => {
      // 1. 用户消息
      const userMsg: ChatMessage = {
        id: 'user-1',
        role: 'user',
        content: 'What is 2+2?',
        timestamp: Date.now(),
      };

      // 2. 助手开始流式
      const assistantMsg: ChatMessage = {
        id: 'asst-1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
      };

      let messages = [userMsg, assistantMsg];

      // 3. 模拟流式更新
      const chunks = [
        {
          type: 'text' as const,
          delta: '2+2',
          accumulatedContent: '2+2',
          state: null as unknown as AgentState,
        },
        {
          type: 'text' as const,
          delta: ' equals 4',
          accumulatedContent: '2+2 equals 4',
          state: null as unknown as AgentState,
        },
        { type: 'done' as const, state: {} as AgentState },
      ];

      for (const chunk of chunks) {
        if (chunk.type === 'text') {
          messages = messages.map((m) =>
            m.id === assistantMsg.id ? { ...m, content: chunk.accumulatedContent! } : m
          );
        }
        if (chunk.type === 'done') {
          messages = messages.map((m) =>
            m.id === assistantMsg.id ? { ...m, isStreaming: false } : m
          );
        }
      }

      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('What is 2+2?');
      expect(messages[1].role).toBe('assistant');
      expect(messages[1].content).toBe('2+2 equals 4');
      expect(messages[1].isStreaming).toBe(false);
    });
  });
});
