/**
 * @fileoverview Streaming path normal boundary tests
 *
 * Tests standard streaming behaviors that are not errors or misbehavior:
 * empty responses, large deltas, and other edge cases of the happy path.
 */

import { describe, it, expect, vi } from 'vitest';
import type { LLMClient, LLMResponse } from '@agentskillmania/llm-client';
import { AgentRunner } from '../../../src/runner/index.js';
import { createAgentState } from '../../../src/state/index.js';
import type { AgentConfig } from '../../../src/types.js';

const mockTokens = { input: 10, output: 5 };

const defaultConfig: AgentConfig = {
  name: 'test-agent',
  instructions: 'You are a helpful assistant.',
  tools: [],
};

function createMockLLMClient(responses: LLMResponse[]): LLMClient {
  let callIndex = 0;
  return {
    call: vi.fn().mockImplementation(() => {
      if (callIndex >= responses.length) {
        throw new Error(`No more mock responses (index ${callIndex})`);
      }
      return Promise.resolve(responses[callIndex++]);
    }),
    stream: vi.fn().mockImplementation(async function* () {
      if (callIndex >= responses.length) {
        throw new Error('No more mock responses for stream');
      }
      const response = responses[callIndex];
      const content = response.content;
      // Only yield text events when content is non-empty
      if (content.length > 0) {
        const tokens = content.split(' ');
        for (let i = 0; i < tokens.length; i++) {
          yield {
            type: 'text',
            delta: tokens[i] + (i < tokens.length - 1 ? ' ' : ''),
            accumulatedContent: tokens.slice(0, i + 1).join(' '),
          };
        }
      }
      if (response.toolCalls && response.toolCalls.length > 0) {
        for (const toolCall of response.toolCalls) {
          yield {
            type: 'tool_call',
            toolCall: { id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments },
          };
        }
      }
      yield { type: 'done', roundTotalTokens: response.tokens };
      callIndex++;
    }),
  } as unknown as LLMClient;
}

describe('Streaming normal boundaries', () => {
  it('should handle empty content + empty toolCalls', async () => {
    // LLM yields nothing useful — empty content, no tool calls
    const client = createMockLLMClient([
      { content: '', toolCalls: [], tokens: mockTokens, stopReason: 'stop' },
    ]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const events: Array<{ type: string; [key: string]: unknown }> = [];
    for await (const event of runner.runStream(state)) {
      events.push(event as { type: string; [key: string]: unknown });
    }

    // No tokens emitted
    const tokens = events.filter((e) => e.type === 'token');
    expect(tokens.length).toBe(0);

    // Should still complete (empty response counts as done)
    const complete = events.find((e) => e.type === 'complete');
    expect(complete).toBeTruthy();
  });

  it('should handle oversized token delta', async () => {
    const hugeDelta = 'A'.repeat(500);
    const client = {
      call: vi.fn(),
      stream: vi.fn().mockImplementation(async function* () {
        yield { type: 'text', delta: hugeDelta, accumulatedContent: hugeDelta };
        yield { type: 'done', roundTotalTokens: mockTokens };
      }),
    } as unknown as LLMClient;

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const events: Array<{ type: string; [key: string]: unknown }> = [];
    for await (const event of runner.runStream(state)) {
      events.push(event as { type: string; [key: string]: unknown });
    }

    const tokens = events.filter((e) => e.type === 'token');
    expect(tokens.length).toBe(1);
    expect((tokens[0] as { token: string }).token).toBe(hugeDelta);

    const complete = events.find((e) => e.type === 'complete');
    expect(complete).toBeTruthy();
    expect((complete as { result: { type: string } }).result.type).toBe('success');
  });
});
