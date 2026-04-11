/**
 * @fileoverview Unit tests for useAgent streaming logic
 *
 * Directly test parseCommand + simulated streaming logic, verifying message state update correctness.
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
 * Mock chunks returned by chatStream
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
    it('should parse all command types', () => {
      expect(parseCommand('/run').type).toBe('mode-run');
      expect(parseCommand('/step').type).toBe('mode-step');
      expect(parseCommand('/advance').type).toBe('mode-advance');
      expect(parseCommand('/clear').type).toBe('clear');
      expect(parseCommand('/help').type).toBe('help');
      expect(parseCommand('/skill test').type).toBe('skill');
      expect(parseCommand('hello').type).toBe('message');
    });

    it('should extract /skill argument', () => {
      const cmd = parseCommand('/skill my-skill');
      expect(cmd.skillName).toBe('my-skill');
    });

    it('should not match empty skill name', () => {
      // /skill followed by space but no name -> trim results in "/skill", does not match startsWith('/skill ')
      const cmd = parseCommand('/skill ');
      expect(cmd.type).toBe('message');
    });
  });

  describe('Message state update simulation', () => {
    it('should simulate chatStream message accumulation', () => {
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

    it('should simulate chatStream error handling', () => {
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

    it('should simulate stepStream token accumulation', () => {
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

    it('should simulate advanceStream phase changes', () => {
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

  describe('User message + assistant message combination', () => {
    it('should simulate a complete conversation flow', () => {
      // 1. User message
      const userMsg: ChatMessage = {
        id: 'user-1',
        role: 'user',
        content: 'What is 2+2?',
        timestamp: Date.now(),
      };

      // 2. Assistant starts streaming
      const assistantMsg: ChatMessage = {
        id: 'asst-1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
      };

      let messages = [userMsg, assistantMsg];

      // 3. Simulate streaming updates
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
