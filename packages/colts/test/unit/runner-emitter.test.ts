/**
 * @fileoverview Runner EventEmitter 单元测试
 *
 * 测试 AgentRunner 的事件发射功能：
 * - 'event' 事件在 runStream 中触发
 * - 'complete' 事件在 run 和 runStream 完成时触发
 * - 'error' 事件在执行出错时触发
 * - on/off 方法可以添加和移除监听器
 */

import { describe, it, expect, vi } from 'vitest';
import { AgentRunner } from '../../src/runner.js';
import { createAgentState } from '../../src/state.js';
import type { LLMResponse } from '@agentskillmania/llm-client';
import type { AgentConfig } from '../../src/types.js';

const mockTokens = { input: 10, output: 5 };

const defaultConfig: AgentConfig = {
  name: 'test-agent',
  instructions: 'You are a test agent.',
  tools: [],
};

/**
 * 创建 mock LLM Client
 */
function createMockLLMClient(responses: LLMResponse[]) {
  let index = 0;
  return {
    call: vi.fn().mockImplementation(() => {
      if (index >= responses.length) {
        return Promise.resolve({
          content: 'Default response',
          toolCalls: [],
          tokens: mockTokens,
          stopReason: 'stop',
        });
      }
      return Promise.resolve(responses[index++]);
    }),
    stream: vi.fn().mockImplementation(async function* () {
      if (index >= responses.length) return;
      const response = responses[index++];
      yield { type: 'text', delta: response.content, accumulatedContent: response.content };
      yield {
        type: 'done',
        accumulatedContent: response.content,
        roundTotalTokens: response.tokens,
      };
    }),
  } as any;
}

describe('AgentRunner EventEmitter', () => {
  it('should emit complete event after run finishes', async () => {
    const client = createMockLLMClient([
      {
        content: 'Hello!',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      },
    ]);

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
    });

    const completeHandler = vi.fn();
    runner.on('complete', completeHandler);

    const state = createAgentState(defaultConfig);
    const result = await runner.run(state);

    expect(completeHandler).toHaveBeenCalledOnce();
    expect(completeHandler).toHaveBeenCalledWith({
      state: expect.any(Object),
      result: expect.objectContaining({
        type: 'success',
        answer: 'Hello!',
      }),
    });
    expect(result.result.type).toBe('success');
  });

  it('should emit error event when run returns error result', async () => {
    const client = {
      call: vi.fn().mockRejectedValue(new Error('API Error')),
      stream: vi.fn(),
    };

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
    });

    const errorHandler = vi.fn();
    runner.on('error', errorHandler);

    const state = createAgentState(defaultConfig);
    const result = await runner.run(state);

    // Should return error result (not throw)
    expect(result.result.type).toBe('error');
    expect(errorHandler).toHaveBeenCalledOnce();
    expect(errorHandler).toHaveBeenCalledWith({
      error: expect.objectContaining({
        message: 'API Error',
      }),
    });
  });

  it('should emit events during runStream', async () => {
    const client = createMockLLMClient([
      {
        content: 'Hello World',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      },
    ]);

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
    });

    const eventHandler = vi.fn();
    runner.on('event', eventHandler);

    const state = createAgentState(defaultConfig);
    const events: any[] = [];

    for await (const event of runner.runStream(state)) {
      events.push(event);
    }

    // Should have emitted events
    expect(eventHandler).toHaveBeenCalled();
    // Event handler should have received the same events
    expect(eventHandler.mock.calls.length).toBeGreaterThan(0);
  });

  it('should emit complete event after runStream finishes', async () => {
    const client = createMockLLMClient([
      {
        content: 'Done!',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      },
    ]);

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
    });

    const completeHandler = vi.fn();
    runner.on('complete', completeHandler);

    const state = createAgentState(defaultConfig);

    for await (const _ of runner.runStream(state)) {
      // Consume stream
    }

    expect(completeHandler).toHaveBeenCalledOnce();
    expect(completeHandler).toHaveBeenCalledWith({
      state: expect.any(Object),
      result: expect.objectContaining({
        type: 'success',
      }),
    });
  });

  it('should allow removing event listener with off', async () => {
    const client = createMockLLMClient([
      {
        content: 'Hello!',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      },
    ]);

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
    });

    const handler = vi.fn();
    runner.on('complete', handler);

    // Remove listener
    runner.off('complete', handler);

    const state = createAgentState(defaultConfig);
    await runner.run(state);

    // Handler should not have been called
    expect(handler).not.toHaveBeenCalled();
  });

  it('should support multiple event listeners', async () => {
    const client = createMockLLMClient([
      {
        content: 'Hello!',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      },
    ]);

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
    });

    const handler1 = vi.fn();
    const handler2 = vi.fn();

    runner.on('complete', handler1);
    runner.on('complete', handler2);

    const state = createAgentState(defaultConfig);
    await runner.run(state);

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it('should work with chat() method', async () => {
    const client = createMockLLMClient([
      {
        content: 'Chat response',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      },
    ]);

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
    });

    const eventHandler = vi.fn();
    runner.on('event', eventHandler);

    const state = createAgentState(defaultConfig);
    await runner.chat(state, 'Hello');

    // Chat method doesn't emit events in current implementation
    // This test documents current behavior
    expect(eventHandler).not.toHaveBeenCalled();
  });
});
