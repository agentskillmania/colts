/**
 * @fileoverview Step 14: 并发隔离测试
 *
 * 验证 Runner 无状态设计保证多个 AgentState 并发执行互不干扰。
 */

import { describe, it, expect, vi } from 'vitest';
import type { LLMClient, LLMResponse } from '@agentskillmania/llm-client';
import { AgentRunner } from '../../src/runner.js';
import { createAgentState } from '../../src/state.js';
import type { AgentConfig } from '../../src/types.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { z } from 'zod';

const mockTokens = { input: 10, output: 5 };

function createMockLLMClient(responses: LLMResponse[]): LLMClient {
  let callIndex = 0;
  return {
    call: vi.fn().mockImplementation(() => {
      if (callIndex >= responses.length) {
        throw new Error(`No more mock responses (index ${callIndex})`);
      }
      // 模拟异步延迟，让并发测试更真实
      return new Promise((resolve) =>
        setTimeout(() => resolve(responses[callIndex++]), Math.random() * 10)
      );
    }),
    stream: vi.fn().mockImplementation(async function* () {
      if (callIndex >= responses.length) {
        throw new Error('No more mock responses for stream');
      }
      const response = responses[callIndex++];
      yield { type: 'text', delta: response.content, accumulatedContent: response.content };
      yield { type: 'done', roundTotalTokens: response.tokens };
    }),
  } as unknown as LLMClient;
}

const defaultConfig: AgentConfig = {
  name: 'test-agent',
  instructions: 'You are a helpful assistant.',
  tools: [],
};

describe('Step 14: 并发隔离', () => {
  it('两个 Agent 同时运行不冲突', async () => {
    const client1 = createMockLLMClient([
      { content: 'Agent 1 answer', toolCalls: [], tokens: mockTokens, stopReason: 'stop' },
    ]);
    const client2 = createMockLLMClient([
      { content: 'Agent 2 answer', toolCalls: [], tokens: mockTokens, stopReason: 'stop' },
    ]);

    const runner1 = new AgentRunner({ model: 'gpt-4', llmClient: client1 });
    const runner2 = new AgentRunner({ model: 'gpt-4', llmClient: client2 });

    const state1 = createAgentState({ ...defaultConfig, name: 'agent-1' });
    const state2 = createAgentState({ ...defaultConfig, name: 'agent-2' });

    // 并发运行
    const [result1, result2] = await Promise.all([runner1.run(state1), runner2.run(state2)]);

    expect(result1.result.type).toBe('success');
    expect(result2.result.type).toBe('success');
    if (result1.result.type === 'success') {
      expect(result1.result.answer).toBe('Agent 1 answer');
    }
    if (result2.result.type === 'success') {
      expect(result2.result.answer).toBe('Agent 2 answer');
    }
  });

  it('各自的 messages 独立', async () => {
    const client = createMockLLMClient([
      { content: 'Hello back', toolCalls: [], tokens: mockTokens, stopReason: 'stop' },
      { content: 'Hello back', toolCalls: [], tokens: mockTokens, stopReason: 'stop' },
    ]);

    // 同一个 Runner 跑两个 AgentState
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });

    const state1 = createAgentState({ ...defaultConfig, name: 'agent-1' });
    const state2 = createAgentState({ ...defaultConfig, name: 'agent-2' });

    // 给 state1 加一条历史消息
    const state1WithHistory = {
      ...state1,
      context: {
        ...state1.context,
        messages: [{ role: 'user' as const, content: 'Previous message' }],
      },
    };

    const [result1, result2] = await Promise.all([
      runner.run(state1WithHistory),
      runner.run(state2),
    ]);

    // state1 有历史消息 + 新消息
    expect(result1.state.context.messages.length).toBeGreaterThan(
      result2.state.context.messages.length
    );
    // state2 没有被 state1 的消息污染
    expect(result2.state.context.messages.every((m) => m.content !== 'Previous message')).toBe(
      true
    );
  });

  it('各自的 stepCount 独立', async () => {
    const responses = Array(4).fill({
      content: 'Calculating',
      toolCalls: [{ id: 'call-1', name: 'calc', arguments: { expression: '1+1' } }],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    }) as LLMResponse[];

    const client = createMockLLMClient(responses);
    const registry = new ToolRegistry();
    registry.register({
      name: 'calc',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }: { expression: string }) => eval(expression).toString(),
    });

    // Runner 1: maxSteps=2
    const runner1 = new AgentRunner({ model: 'gpt-4', llmClient: client });
    // Runner 2: maxSteps=3
    const runner2 = new AgentRunner({ model: 'gpt-4', llmClient: client });

    const state1 = createAgentState(defaultConfig);
    const state2 = createAgentState(defaultConfig);

    const [result1, result2] = await Promise.all([
      runner1.run(state1, { maxSteps: 2 }, registry),
      runner2.run(state2, { maxSteps: 3 }, registry),
    ]);

    // 各自的 stepCount 符合各自的 maxSteps
    expect(result1.state.context.stepCount).toBe(2);
    expect(result2.state.context.stepCount).toBe(3);

    // 原状态不变
    expect(state1.context.stepCount).toBe(0);
    expect(state2.context.stepCount).toBe(0);
  });

  it('一个报错不影响另一个', async () => {
    const errorClient = {
      call: vi.fn().mockRejectedValue(new Error('API exploded')),
      stream: vi.fn(),
    } as unknown as LLMClient;

    const successClient = createMockLLMClient([
      { content: 'I am fine', toolCalls: [], tokens: mockTokens, stopReason: 'stop' },
    ]);

    const runner1 = new AgentRunner({ model: 'gpt-4', llmClient: errorClient });
    const runner2 = new AgentRunner({ model: 'gpt-4', llmClient: successClient });

    const state1 = createAgentState({ ...defaultConfig, name: 'failing-agent' });
    const state2 = createAgentState({ ...defaultConfig, name: 'succeeding-agent' });

    // 并发运行，runner1 会失败
    const [result1, result2] = await Promise.all([runner1.run(state1), runner2.run(state2)]);

    // runner1 错误被捕获，返回 error 信息
    expect(result1.result.type).toBe('success');
    if (result1.result.type === 'success') {
      expect(result1.result.answer).toContain('API exploded');
    }

    // runner2 不受影响，正常完成
    expect(result2.result.type).toBe('success');
    if (result2.result.type === 'success') {
      expect(result2.result.answer).toBe('I am fine');
    }
  });

  it('同一个 Runner 并发运行多个 AgentState', async () => {
    // 一个 Runner 跑 3 个不同的 AgentState
    const client = createMockLLMClient([
      { content: 'Answer A', toolCalls: [], tokens: mockTokens, stopReason: 'stop' },
      { content: 'Answer B', toolCalls: [], tokens: mockTokens, stopReason: 'stop' },
      { content: 'Answer C', toolCalls: [], tokens: mockTokens, stopReason: 'stop' },
    ]);

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });

    const states = ['alpha', 'beta', 'gamma'].map((name) =>
      createAgentState({ ...defaultConfig, name })
    );

    const results = await Promise.all(states.map((s) => runner.run(s)));

    const answers = results.map((r) => {
      expect(r.result.type).toBe('success');
      return r.result.type === 'success' ? r.result.answer : '';
    });

    // 每个都拿到了各自的回答
    expect(answers).toContain('Answer A');
    expect(answers).toContain('Answer B');
    expect(answers).toContain('Answer C');

    // 原状态全部不变
    states.forEach((s) => {
      expect(s.context.stepCount).toBe(0);
      expect(s.context.messages).toHaveLength(0);
    });
  });
});
