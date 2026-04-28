/**
 * @fileoverview Step 14: Concurrency isolation test
 *
 * Verifies that Runner's stateless design ensures multiple AgentStates can execute concurrently without interference.
 */

import { describe, it, expect, vi } from 'vitest';
import type { LLMClient, LLMResponse } from '@agentskillmania/llm-client';
import { AgentRunner } from '../../../src/runner/index.js';
import { createAgentState } from '../../../src/state/index.js';
import type { AgentConfig } from '../../../src/types.js';
import { ToolRegistry } from '../../../src/tools/registry.js';
import { z } from 'zod';

const mockTokens = { input: 10, output: 5 };

function createMockLLMClient(responses: LLMResponse[]): LLMClient {
  let callIndex = 0;
  return {
    call: vi.fn().mockImplementation(() => {
      if (callIndex >= responses.length) {
        throw new Error(`No more mock responses (index ${callIndex})`);
      }
      // Simulate async delay for more realistic concurrency testing
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

describe('Step 14: Concurrency isolation', () => {
  it('two Agents running simultaneously do not conflict', async () => {
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

    // Run concurrently
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

  it('each has independent messages', async () => {
    const client = createMockLLMClient([
      { content: 'Hello back', toolCalls: [], tokens: mockTokens, stopReason: 'stop' },
      { content: 'Hello back', toolCalls: [], tokens: mockTokens, stopReason: 'stop' },
    ]);

    // Same Runner running two AgentStates
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });

    const state1 = createAgentState({ ...defaultConfig, name: 'agent-1' });
    const state2 = createAgentState({ ...defaultConfig, name: 'agent-2' });

    // Add a historical message to state1
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

    // state1 has historical messages + new messages
    expect(result1.state.context.messages.length).toBeGreaterThan(
      result2.state.context.messages.length
    );
    // state2 is not polluted by state1's messages
    expect(result2.state.context.messages.every((m) => m.content !== 'Previous message')).toBe(
      true
    );
  });

  it('each has independent stepCount', async () => {
    const toolCallResponse = {
      content: 'Calculating',
      toolCalls: [{ id: 'call-1', name: 'calc', arguments: { expression: '1+1' } }],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };

    // Each runner uses an independent client to avoid race conditions from shared callIndex
    const client1 = createMockLLMClient(Array(4).fill(toolCallResponse) as LLMResponse[]);
    const client2 = createMockLLMClient(Array(4).fill(toolCallResponse) as LLMResponse[]);

    const registry = new ToolRegistry();
    registry.register({
      name: 'calc',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }: { expression: string }) => eval(expression).toString(),
    });

    // Runner 1: maxSteps=2
    const runner1 = new AgentRunner({ model: 'gpt-4', llmClient: client1 });
    // Runner 2: maxSteps=3
    const runner2 = new AgentRunner({ model: 'gpt-4', llmClient: client2 });

    const state1 = createAgentState(defaultConfig);
    const state2 = createAgentState(defaultConfig);

    const [result1, result2] = await Promise.all([
      runner1.run(state1, { maxSteps: 2 }, registry),
      runner2.run(state2, { maxSteps: 3 }, registry),
    ]);

    // Each stepCount matches its respective maxSteps
    expect(result1.state.context.stepCount).toBe(2);
    expect(result2.state.context.stepCount).toBe(3);

    // Original states unchanged
    expect(state1.context.stepCount).toBe(0);
    expect(state2.context.stepCount).toBe(0);
  });

  it('one error does not affect the other', async () => {
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

    // Run concurrently, runner1 will fail
    const [result1, result2] = await Promise.all([runner1.run(state1), runner2.run(state2)]);

    // runner1 error is caught, returns error result
    expect(result1.result.type).toBe('error');
    if (result1.result.type === 'error') {
      expect(result1.result.error.message).toContain('API exploded');
    }

    // runner2 is unaffected and completes normally
    expect(result2.result.type).toBe('success');
    if (result2.result.type === 'success') {
      expect(result2.result.answer).toBe('I am fine');
    }
  });

  it('same Runner concurrently runs multiple AgentStates', async () => {
    // One Runner runs 3 different AgentStates
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

    // Each got its own answer
    expect(answers).toContain('Answer A');
    expect(answers).toContain('Answer B');
    expect(answers).toContain('Answer C');

    // All original states unchanged
    states.forEach((s) => {
      expect(s.context.stepCount).toBe(0);
      expect(s.context.messages).toHaveLength(0);
    });
  });
});
