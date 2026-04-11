/**
 * @fileoverview run() and runStream() tests
 */

import { describe, it, expect, vi } from 'vitest';
import type { LLMClient, LLMResponse } from '@agentskillmania/llm-client';
import { AgentRunner } from '../../src/runner.js';
import { createAgentState } from '../../src/state.js';
import type { AgentConfig } from '../../src/types.js';
import type { SubAgentConfig } from '../../src/subagent/types.js';
import { ToolRegistry } from '../../src/tools/registry.js';
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

describe('run()', () => {
  it('should return success for single-step direct answer', async () => {
    const mockResponse: LLMResponse = {
      content: 'The answer is 42',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const { state: finalState, result } = await runner.run(state);

    expect(result.type).toBe('success');
    if (result.type === 'success') {
      expect(result.answer).toBe('The answer is 42');
      expect(result.totalSteps).toBe(1);
    }

    // 原状态不可变
    expect(state.context.stepCount).toBe(0);
    expect(finalState.context.stepCount).toBe(1);
  });

  it('should loop through tool execution to final answer', async () => {
    const responses: LLMResponse[] = [
      {
        // 第一步：LLM 调用工具
        content: 'Let me calculate',
        toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '2+2' } }],
        tokens: mockTokens,
        stopReason: 'tool_calls',
      },
      {
        // 第二步：LLM 给出最终答案
        content: 'The result is 4',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      },
    ];

    const client = createMockLLMClient(responses);
    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => eval(expression).toString(),
    });

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const { state: finalState, result } = await runner.run(state, undefined, registry);

    expect(result.type).toBe('success');
    if (result.type === 'success') {
      expect(result.answer).toBe('The result is 4');
      expect(result.totalSteps).toBe(2);
    }

    expect(finalState.context.stepCount).toBe(2);
    expect(state.context.stepCount).toBe(0);
  });

  it('should return max_steps when limit is reached', async () => {
    // LLM 每次都调用工具，永远不会停止
    const toolCallResponse: LLMResponse = {
      content: 'Thinking...',
      toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '1+1' } }],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };

    // 返回足够多的工具调用响应
    const responses = Array(10).fill(toolCallResponse);
    const client = createMockLLMClient(responses);

    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => eval(expression).toString(),
    });

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const { result } = await runner.run(state, { maxSteps: 3 }, registry);

    expect(result.type).toBe('max_steps');
    if (result.type === 'max_steps') {
      expect(result.totalSteps).toBe(3);
    }
  });

  it('should use default maxSteps of 10', async () => {
    const toolCallResponse: LLMResponse = {
      content: 'Thinking...',
      toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '1+1' } }],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };

    const responses = Array(12).fill(toolCallResponse);
    const client = createMockLLMClient(responses);

    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => eval(expression).toString(),
    });

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const { result } = await runner.run(state, undefined, registry);

    expect(result.type).toBe('max_steps');
    if (result.type === 'max_steps') {
      expect(result.totalSteps).toBe(10);
    }
  });

  it('should handle LLM error and return error result', async () => {
    const client = {
      call: vi.fn().mockRejectedValue(new Error('API error')),
      stream: vi.fn(),
    } as unknown as LLMClient;

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const { result } = await runner.run(state);

    // step() 内部捕获错误，返回 error
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.error.message).toContain('API error');
      expect(result.totalSteps).toBe(1);
    }
  });

  it('should use runner tool registry as default', async () => {
    const responses: LLMResponse[] = [
      {
        content: 'Calculating',
        toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '5*5' } }],
        tokens: mockTokens,
        stopReason: 'tool_calls',
      },
      {
        content: 'The result is 25',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      },
    ];

    const client = createMockLLMClient(responses);
    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => eval(expression).toString(),
    });

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, toolRegistry: registry });
    const state = createAgentState(defaultConfig);

    const { result } = await runner.run(state);

    expect(result.type).toBe('success');
    if (result.type === 'success') {
      expect(result.answer).toBe('The result is 25');
    }
  });
});

describe('runStream()', () => {
  it('should emit step:start, token, step:end, and complete events', async () => {
    const mockResponse: LLMResponse = {
      content: 'Hello world',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const events: { type: string }[] = [];
    for await (const event of runner.runStream(state)) {
      events.push(event as { type: string });
    }

    // 应有 step:start
    expect(events.some((e) => e.type === 'step:start')).toBe(true);
    // 应有 token 事件（逐字输出）
    expect(events.some((e) => e.type === 'token')).toBe(true);
    // 应有 step:end
    expect(events.some((e) => e.type === 'step:end')).toBe(true);
    // 应有 complete
    expect(events.some((e) => e.type === 'complete')).toBe(true);
  });

  it('should yield token events for real-time output', async () => {
    const mockResponse: LLMResponse = {
      content: 'One two three',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const tokens: string[] = [];
    for await (const event of runner.runStream(state)) {
      if (event.type === 'token') {
        tokens.push(event.token);
      }
    }

    expect(tokens.length).toBeGreaterThan(0);
    // 拼接后应包含完整内容
    expect(tokens.join('')).toContain('One');
  });

  it('should emit events across multiple steps', async () => {
    const responses: LLMResponse[] = [
      {
        content: 'Calculating',
        toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '1+1' } }],
        tokens: mockTokens,
        stopReason: 'tool_calls',
      },
      {
        content: 'The result is 2',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      },
    ];

    const client = createMockLLMClient(responses);
    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => eval(expression).toString(),
    });

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const stepStarts: number[] = [];
    const stepEnds: number[] = [];

    for await (const event of runner.runStream(state, undefined, registry)) {
      if (event.type === 'step:start') stepStarts.push(event.step);
      if (event.type === 'step:end') stepEnds.push(event.step);
    }

    expect(stepStarts).toHaveLength(2);
    expect(stepEnds).toHaveLength(2);
    expect(stepStarts[0]).toBe(0);
    expect(stepStarts[1]).toBe(1);
  });

  it('should return final result via generator return value', async () => {
    const mockResponse: LLMResponse = {
      content: 'Final answer',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const iterator = runner.runStream(state);
    let returnValue;
    while (true) {
      const { done, value } = await iterator.next();
      if (done) {
        returnValue = value;
        break;
      }
    }

    expect(returnValue).toBeDefined();
    expect(returnValue.result.type).toBe('success');
    if (returnValue.result.type === 'success') {
      expect(returnValue.result.answer).toBe('Final answer');
      expect(returnValue.result.totalSteps).toBe(1);
    }
    expect(returnValue.state.context.stepCount).toBe(1);
  });

  it('should handle maxSteps in streaming mode', async () => {
    const toolCallResponse: LLMResponse = {
      content: 'Thinking...',
      toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '1+1' } }],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };

    const responses = Array(5).fill(toolCallResponse);
    const client = createMockLLMClient(responses);

    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => eval(expression).toString(),
    });

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const iterator = runner.runStream(state, { maxSteps: 2 }, registry);
    let returnValue;
    while (true) {
      const { done, value } = await iterator.next();
      if (done) {
        returnValue = value;
        break;
      }
    }

    expect(returnValue.result.type).toBe('max_steps');
    if (returnValue.result.type === 'max_steps') {
      expect(returnValue.result.totalSteps).toBe(2);
    }
  });

  it('should support interruption via break', async () => {
    const toolCallResponse: LLMResponse = {
      content: 'Thinking...',
      toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '1+1' } }],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };

    const responses = Array(10).fill(toolCallResponse);
    const client = createMockLLMClient(responses);

    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => eval(expression).toString(),
    });

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    let stepCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const event of runner.runStream(state, undefined, registry)) {
      stepCount++;
      if (stepCount > 5) break; // 中断流式
    }

    // 应该已经中断，没有抛错
    expect(stepCount).toBeGreaterThan(0);
  });

  it('should emit tool:start and tool:end events', async () => {
    const responses: LLMResponse[] = [
      {
        content: 'Calculating',
        toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '3+3' } }],
        tokens: mockTokens,
        stopReason: 'tool_calls',
      },
      {
        content: 'The result is 6',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      },
    ];

    const client = createMockLLMClient(responses);
    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => eval(expression).toString(),
    });

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const events: { type: string }[] = [];
    for await (const event of runner.runStream(state, undefined, registry)) {
      events.push(event as { type: string });
    }

    expect(events.some((e) => e.type === 'tool:start')).toBe(true);
    expect(events.some((e) => e.type === 'tool:end')).toBe(true);
  });

  it('should maintain immutability across streaming steps', async () => {
    const responses: LLMResponse[] = [
      {
        content: 'Calculating',
        toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '1+1' } }],
        tokens: mockTokens,
        stopReason: 'tool_calls',
      },
      {
        content: 'Done',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      },
    ];

    const client = createMockLLMClient(responses);
    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => eval(expression).toString(),
    });

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const originalState = createAgentState(defaultConfig);
    const originalStepCount = originalState.context.stepCount;

    const iterator = runner.runStream(originalState, undefined, registry);
    let returnValue;
    while (true) {
      const { done, value } = await iterator.next();
      if (done) {
        returnValue = value;
        break;
      }
    }

    // 原状态不可变
    expect(originalState.context.stepCount).toBe(originalStepCount);
    // 最终状态已更新
    expect(returnValue.state.context.stepCount).toBe(2);
  });

  it('should handle error via runStream', async () => {
    const client = {
      call: vi.fn().mockRejectedValue(new Error('LLM down')),
      stream: vi.fn().mockImplementation(async function* () {
        throw new Error('LLM down');
      }),
    } as unknown as LLMClient;

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const events: { type: string }[] = [];
    let returnValue: { result: { type: string } } | undefined;
    const iterator = runner.runStream(state);
    while (true) {
      const { done, value } = await iterator.next();
      if (done) {
        returnValue = value;
        break;
      }
      events.push(value as { type: string });
    }

    // Should emit complete event with error result
    expect(events.some((e) => e.type === 'complete')).toBe(true);
    expect(returnValue!.result.type).toBe('error');
    if (returnValue!.result.type === 'error') {
      expect(returnValue!.result.error.message).toContain('LLM down');
    }
  });

  // ============================================================
  // SubAgent runStream 事件传播
  // ============================================================
  it('应该通过 runStream 传播 subagent 事件', async () => {
    /** 创建测试用子 agent 配置 */
    const createTestSubAgents = (): SubAgentConfig[] => [
      {
        name: 'researcher',
        description: 'Information research specialist',
        config: {
          name: 'researcher',
          instructions: 'You are a research specialist.',
          tools: [],
        },
        maxSteps: 5,
      },
    ];

    // 第一步：主 agent 委派给子 agent
    const delegateResponse: LLMResponse = {
      content: 'Delegating to researcher',
      toolCalls: [
        {
          id: 'call-delegate-1',
          name: 'delegate',
          arguments: { agent: 'researcher', task: 'Research topic X' },
        },
      ],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };

    // 子 agent 的 LLM 响应（在 delegate tool 内部）
    const subAgentResponse: LLMResponse = {
      content: 'Research result: found relevant info.',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    // 第二步：主 agent 基于子 agent 结果给出最终答案
    const finalResponse: LLMResponse = {
      content: 'Based on research, the answer is X.',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([delegateResponse, subAgentResponse, finalResponse]);
    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      subAgents: createTestSubAgents(),
    });

    const state = createAgentState(defaultConfig);
    const events: { type: string }[] = [];

    for await (const event of runner.runStream(state)) {
      events.push(event as { type: string });
    }

    // 应该有 subagent:start 和 subagent:end 事件
    expect(events.some((e) => e.type === 'subagent:start')).toBe(true);
    expect(events.some((e) => e.type === 'subagent:end')).toBe(true);

    // 应该有正常的 step:start、step:end 和 complete 事件
    expect(events.some((e) => e.type === 'step:start')).toBe(true);
    expect(events.some((e) => e.type === 'step:end')).toBe(true);
    expect(events.some((e) => e.type === 'complete')).toBe(true);

    // 验证 subagent:start 在 subagent:end 之前
    const startIndex = events.findIndex((e) => e.type === 'subagent:start');
    const endIndex = events.findIndex((e) => e.type === 'subagent:end');
    expect(startIndex).toBeLessThan(endIndex);

    // 验证最终结果
    const completeEvent = events.find((e) => e.type === 'complete') as {
      type: string;
      result: { type: string; answer: string; totalSteps: number };
    };
    expect(completeEvent.result.type).toBe('success');
    expect(completeEvent.result.answer).toBe('Based on research, the answer is X.');
    expect(completeEvent.result.totalSteps).toBe(2);
  });
});
