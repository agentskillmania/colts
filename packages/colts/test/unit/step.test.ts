/**
 * @fileoverview step() and stepStream() tests
 */

import { describe, it, expect, vi } from 'vitest';
import type { LLMClient, LLMResponse } from '@agentskillmania/llm-client';
import { AgentRunner } from '../../src/runner.js';
import { createAgentState } from '../../src/state.js';
import type { AgentConfig } from '../../src/types.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { createExecutionState } from '../../src/execution.js';
import { z } from 'zod';

// Helper to create mock LLM client
function createMockLLMClient(responses: LLMResponse[]): LLMClient {
  let callIndex = 0;

  return {
    call: vi.fn().mockImplementation(() => {
      if (callIndex >= responses.length) {
        throw new Error(`No more mock responses (index ${callIndex}, total ${responses.length})`);
      }
      return Promise.resolve(responses[callIndex++]);
    }),
    stream: vi.fn().mockImplementation(async function* () {
      if (callIndex >= responses.length) {
        throw new Error('No more mock responses for stream');
      }
      const response = responses[callIndex];

      // Yield content as tokens
      const content = response.content;
      const tokens = content.split(' ');
      for (let i = 0; i < tokens.length; i++) {
        yield {
          type: 'text',
          delta: tokens[i] + (i < tokens.length - 1 ? ' ' : ''),
          accumulatedContent: tokens.slice(0, i + 1).join(' '),
        };
      }

      // Yield tool calls if present
      if (response.toolCalls && response.toolCalls.length > 0) {
        for (const toolCall of response.toolCalls) {
          yield {
            type: 'tool_call',
            toolCall: {
              id: toolCall.id,
              name: toolCall.name,
              arguments: toolCall.arguments,
            },
          };
        }
      }

      yield {
        type: 'done',
        roundTotalTokens: response.tokens,
      };

      // Increment for next call
      callIndex++;
    }),
  } as unknown as LLMClient;
}

// Default config for tests
const defaultConfig: AgentConfig = {
  name: 'test-agent',
  instructions: 'You are a helpful assistant.',
  tools: [],
};

// Mock token stats
const mockTokens = {
  input: 10,
  output: 5,
};

describe('step()', () => {
  it('should complete with done result for direct answer', async () => {
    const mockResponse: LLMResponse = {
      content: 'The answer is 42',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
    });

    const state = createAgentState(defaultConfig);
    const { state: newState, result } = await runner.step(state);

    // 验证 LLM 被正确调用
    expect(client.call).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4',
        messages: expect.arrayContaining([expect.objectContaining({ role: 'user' })]),
      })
    );

    expect(result.type).toBe('done');
    if (result.type === 'done') {
      expect(result.answer).toBe('The answer is 42');
    }

    // State should be updated
    expect(newState.context.stepCount).toBe(1);
    expect(newState.context.messages).toHaveLength(1);

    // Original state unchanged
    expect(state.context.stepCount).toBe(0);
  });

  it('should return continue result when tool is called', async () => {
    const mockResponse: LLMResponse = {
      content: 'Let me calculate',
      toolCalls: [
        {
          id: 'call-123',
          name: 'calculate',
          arguments: { expression: '2 + 2' },
        },
      ],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
    });

    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => eval(expression).toString(),
    });

    const state = createAgentState(defaultConfig);
    const { state: newState, result } = await runner.step(state, registry);

    // 验证工具 schema 传给了 LLM
    expect(client.call).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([expect.objectContaining({ name: 'calculate' })]),
      })
    );

    expect(result.type).toBe('continue');
    if (result.type === 'continue') {
      expect(result.toolResult).toBe('4');
    }

    // State should have assistant thought and tool result
    expect(newState.context.stepCount).toBe(1);
    expect(newState.context.messages).toHaveLength(2);
  });

  it('should handle missing tool registry gracefully', async () => {
    const mockResponse: LLMResponse = {
      content: 'Let me calculate',
      toolCalls: [
        {
          id: 'call-123',
          name: 'calculate',
          arguments: { expression: '2+2' },
        },
      ],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
    });

    // No tool registry provided - Step 6: Runner internally creates empty registry
    const state = createAgentState(defaultConfig);
    const { result } = await runner.step(state);

    expect(result.type).toBe('continue');
    if (result.type === 'continue') {
      // Empty registry returns "Tool not found" error
      expect(result.toolResult).toContain('Error');
      expect(result.toolResult).toContain('Tool not found');
    }
  });

  it('should handle LLM error', async () => {
    const client = {
      call: vi.fn().mockRejectedValue(new Error('LLM API error')),
      stream: vi.fn(),
    } as unknown as LLMClient;

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
    });

    const state = createAgentState(defaultConfig);
    const { state: newState, result } = await runner.step(state);

    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.error.message).toContain('LLM API error');
    }

    // Original state should be unchanged
    expect(state.context.stepCount).toBe(0);
    // Error does not write to state, step count stays 0
    expect(newState.context.stepCount).toBe(0);
    expect(newState.context.messages.length).toBe(0);
  });

  it('should use runner tool registry as default', async () => {
    const mockResponse: LLMResponse = {
      content: 'Calculating',
      toolCalls: [
        {
          id: 'call-123',
          name: 'calculate',
          arguments: { expression: '5 * 5' },
        },
      ],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };

    const client = createMockLLMClient([mockResponse]);

    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate math expression',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => eval(expression).toString(),
    });

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      toolRegistry: registry,
    });

    const state = createAgentState(defaultConfig);
    const { result } = await runner.step(state);

    expect(result.type).toBe('continue');
    if (result.type === 'continue') {
      expect(result.toolResult).toBe('25');
    }
  });

  it('should prefer passed registry over runner default', async () => {
    const mockResponse: LLMResponse = {
      content: 'Calculating',
      toolCalls: [
        {
          id: 'call-123',
          name: 'multiply',
          arguments: { a: 3, b: 4 },
        },
      ],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };

    const client = createMockLLMClient([mockResponse]);

    const defaultRegistry = new ToolRegistry();
    defaultRegistry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async () => 'default',
    });

    const passedRegistry = new ToolRegistry();
    passedRegistry.register({
      name: 'multiply',
      description: 'Multiply two numbers',
      parameters: z.object({ a: z.number(), b: z.number() }),
      execute: async ({ a, b }) => (a * b).toString(),
    });

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      toolRegistry: defaultRegistry,
    });

    const state = createAgentState(defaultConfig);
    const { result } = await runner.step(state, passedRegistry);

    expect(result.type).toBe('continue');
    if (result.type === 'continue') {
      expect(result.toolResult).toBe('12');
    }
  });

  describe('stepStream()', () => {
    it('should emit phase-change events', async () => {
      const mockResponse: LLMResponse = {
        content: 'The answer',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      };

      const client = createMockLLMClient([mockResponse]);
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      const state = createAgentState(defaultConfig);
      const events: { type: string }[] = [];

      for await (const event of runner.stepStream(state)) {
        events.push(event as { type: string });
      }

      const phaseChanges = events.filter((e) => e.type === 'phase-change');
      expect(phaseChanges.length).toBeGreaterThan(0);
      expect(events[events.length - 1].type).toBe('phase-change');
    });

    it('should emit token events during streaming', async () => {
      const mockResponse: LLMResponse = {
        content: 'The answer is here',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      };

      const client = createMockLLMClient([mockResponse]);
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      const state = createAgentState(defaultConfig);
      const events: { type: string }[] = [];

      for await (const event of runner.stepStream(state)) {
        events.push(event as { type: string });
      }

      const tokenEvents = events.filter((e) => e.type === 'token');
      expect(tokenEvents.length).toBeGreaterThan(0);
    });

    it('should emit tool events when tool is called', async () => {
      const mockResponse: LLMResponse = {
        content: 'Let me calculate',
        toolCalls: [
          {
            id: 'call-123',
            name: 'calculate',
            arguments: { expression: '10 / 2' },
          },
        ],
        tokens: mockTokens,
        stopReason: 'tool_calls',
      };

      const client = createMockLLMClient([mockResponse]);
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      const registry = new ToolRegistry();
      registry.register({
        name: 'calculate',
        description: 'Calculate',
        parameters: z.object({ expression: z.string() }),
        execute: async ({ expression }) => eval(expression).toString(),
      });

      const state = createAgentState(defaultConfig);
      const events: { type: string }[] = [];

      for await (const event of runner.stepStream(state, registry)) {
        events.push(event as { type: string });
      }

      expect(events.some((e) => e.type === 'tool:start')).toBe(true);
      expect(events.some((e) => e.type === 'tool:end')).toBe(true);
    });

    it('should return final result', async () => {
      const mockResponse: LLMResponse = {
        content: 'Final answer',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      };

      const client = createMockLLMClient([mockResponse]);
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      const state = createAgentState(defaultConfig);
      const iterator = runner.stepStream(state);

      let result;
      while (true) {
        const { done, value } = await iterator.next();
        if (done) {
          result = value;
          break;
        }
      }

      expect(result).toBeDefined();
      expect(result.state).toBeDefined();
      expect(result.result).toBeDefined();
      expect(result.result.type).toBe('done');
    });

    it('should return continue result when tool is called', async () => {
      const mockResponse: LLMResponse = {
        content: 'Calculating',
        toolCalls: [
          {
            id: 'call-123',
            name: 'calculate',
            arguments: { expression: '10 / 2' },
          },
        ],
        tokens: mockTokens,
        stopReason: 'tool_calls',
      };

      const client = createMockLLMClient([mockResponse]);
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      const registry = new ToolRegistry();
      registry.register({
        name: 'calculate',
        description: 'Calculate',
        parameters: z.object({ expression: z.string() }),
        execute: async ({ expression }) => eval(expression).toString(),
      });

      const state = createAgentState(defaultConfig);
      const iterator = runner.stepStream(state, registry);

      let result;
      while (true) {
        const { done, value } = await iterator.next();
        if (done) {
          result = value;
          break;
        }
      }

      expect(result.result.type).toBe('continue');
      if (result.result.type === 'continue') {
        expect(result.result.toolResult).toBe('5');
      }
    });

    it('should handle error case via stepStream', async () => {
      const client = {
        call: vi.fn().mockRejectedValue(new Error('LLM API error')),
        stream: vi.fn().mockImplementation(async function* () {
          throw new Error('LLM API error');
        }),
      } as unknown as LLMClient;

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      const state = createAgentState(defaultConfig);

      const events: { type: string }[] = [];
      let returnValue: { result: { type: string } } | undefined;
      const iterator = runner.stepStream(state);
      while (true) {
        const { done, value } = await iterator.next();
        if (done) {
          returnValue = value;
          break;
        }
        events.push(value as { type: string });
      }

      expect(events.some((e) => e.type === 'error')).toBe(true);
      expect(returnValue!.result.type).toBe('error');
    });

    it('should handle tool returning object result', async () => {
      const mockResponse: LLMResponse = {
        content: 'Getting data',
        toolCalls: [
          {
            id: 'call-123',
            name: 'getData',
            arguments: { id: '123' },
          },
        ],
        tokens: mockTokens,
        stopReason: 'tool_calls',
      };

      const client = createMockLLMClient([mockResponse]);
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      const registry = new ToolRegistry();
      registry.register({
        name: 'getData',
        description: 'Get data',
        parameters: z.object({ id: z.string() }),
        execute: async ({ id }) => ({ id, name: 'Test Item', value: 42 }),
      });

      const state = createAgentState(defaultConfig);

      const iterator = runner.stepStream(state, registry);
      let result;
      while (true) {
        const { done, value } = await iterator.next();
        if (done) {
          result = value;
          break;
        }
      }

      expect(result.result.type).toBe('continue');
      if (result.result.type === 'continue') {
        expect(typeof result.result.toolResult).toBe('object');
        expect(result.result.toolResult).toEqual({ id: '123', name: 'Test Item', value: 42 });
      }
    });

    it('should handle missing registry in stepStream', async () => {
      const mockResponse: LLMResponse = {
        content: 'Trying to calculate',
        toolCalls: [
          {
            id: 'call-123',
            name: 'someTool',
            arguments: {},
          },
        ],
        tokens: mockTokens,
        stopReason: 'tool_calls',
      };

      const client = createMockLLMClient([mockResponse]);
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      const state = createAgentState(defaultConfig);

      const iterator = runner.stepStream(state);
      let result;
      while (true) {
        const { done, value } = await iterator.next();
        if (done) {
          result = value;
          break;
        }
      }

      expect(result.result.type).toBe('continue');
      if (result.result.type === 'continue') {
        expect(result.result.toolResult).toContain('Error');
        expect(result.result.toolResult).toContain('Tool not found');
      }
    });
  });
});
