/**
 * @fileoverview step() tests
 */

import { describe, it, expect, vi } from 'vitest';
import type { LLMClient, LLMResponse } from '@agentskillmania/llm-client';
import { AgentRunner } from '../../../src/runner/index.js';
import { createAgentState } from '../../../src/state/index.js';
import type { AgentConfig } from '../../../src/types.js';
import { ToolRegistry } from '../../../src/tools/registry.js';
import { createExecutionState } from '../../../src/execution/index.js';
import { z } from 'zod';
import { createMockLLMClient } from '../../helpers/mock-llm.js';
import { safeEval } from '../helpers/safe-eval.js';

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
  cacheRead: 0,
  cacheWrite: 0,
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

    // Verify LLM is called correctly
    expect(client.stream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4',
        messages: expect.arrayContaining([expect.objectContaining({ role: 'user' })]),
      })
    );

    expect(result.type).toBe('done');
    if (result.type === 'done') {
      expect(result.answer).toBe('The answer is 42');
    }

    // Token tracking
    expect(result.tokens).toEqual(mockTokens);
    expect(newState.context.totalTokens).toEqual(mockTokens);

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
      execute: async ({ expression }) => safeEval(expression).toString(),
    });

    const state = createAgentState(defaultConfig);
    const { state: newState, result } = await runner.step(state, registry);

    // Verify tool schema is passed to LLM
    expect(client.stream).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([expect.objectContaining({ name: 'calculate' })]),
      })
    );

    expect(result.type).toBe('continue');
    if (result.type === 'continue') {
      expect(result.toolResult).toBe('4');
    }

    // Token tracking
    expect(result.tokens).toEqual(mockTokens);
    expect(newState.context.totalTokens).toEqual(mockTokens);

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
      expect(result.toolResult).toContain('not found');
      expect(result.toolResult).toContain('Tool not found');
    }
  });

  it('should handle LLM error', async () => {
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
      execute: async ({ expression }) => safeEval(expression).toString(),
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

  // ============================================================
  // Middleware error propagation
  // ============================================================
  describe('middleware error propagation', () => {
    it('should handle error fallback from afterAdvance middleware', async () => {
      const mockResponse: LLMResponse = {
        content: 'Hello',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      };

      const client = createMockLLMClient([mockResponse]);
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        middleware: [
          {
            name: 'test-unrecognized-phase',
            async afterAdvance() {
              return {
                stop: true,
                result: {
                  state: createAgentState(defaultConfig),
                  execState: createExecutionState(),
                  phase: {
                    type: 'unknown-phase',
                  } as unknown as import('../../../src/execution/index.js').ExecutionState['phase'],
                  done: true,
                },
              };
            },
          },
        ],
      });

      const state = createAgentState(defaultConfig);
      const result = await runner.step(state);

      expect(result.result.type).toBe('error');
      if (result.result.type === 'error') {
        expect(result.result.error.message).toBe('Stopped by middleware');
      }
    });

    it('should propagate error when beforeAdvance throws', async () => {
      const mockResponse: LLMResponse = {
        content: 'Hello',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      };

      const client = createMockLLMClient([mockResponse]);
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        middleware: [
          {
            name: 'test-throw',
            async beforeAdvance() {
              throw new Error('beforeAdvance error');
            },
          },
        ],
      });

      const state = createAgentState(defaultConfig);
      // beforeAdvance throw is an execution error → returns error result
      const { result } = await runner.step(state);
      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.error.message).toBe('beforeAdvance error');
      }
    });

    it('should propagate error when afterStep throws', async () => {
      const mockResponse: LLMResponse = {
        content: 'Hello',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      };

      const client = createMockLLMClient([mockResponse]);
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        middleware: [
          {
            name: 'test-afterStep-throw',
            async afterStep() {
              throw new Error('afterStep error');
            },
          },
        ],
      });

      const state = createAgentState(defaultConfig);
      // afterStep throw is an execution error → returns error result
      const { result } = await runner.step(state);
      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.error.message).toBe('afterStep error');
      }
    });
  });
});
