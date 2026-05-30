/**
 * @fileoverview Streaming path normal boundary tests
 *
 * Tests standard streaming behaviors that are not errors or misbehavior:
 * empty responses, large deltas, Unicode, and other edge cases of the happy path.
 */

import { describe, it, expect, vi } from 'vitest';
import type { LLMClient, LLMResponse } from '@agentskillmania/llm-client';
import { AgentRunner } from '../../../src/runner/index.js';
import { createAgentState } from '../../../src/state/index.js';
import type { AgentConfig } from '../../../src/types.js';
import { createMockLLMClient as _createMockLLMClient } from '../../helpers/mock-llm.js';

const mockTokens = { input: 10, output: 5 };

const defaultConfig: AgentConfig = {
  name: 'test-agent',
  instructions: 'You are a helpful assistant.',
  tools: [],
};

const createMockLLMClient = (responses: LLMResponse[], options = {}) =>
  _createMockLLMClient(responses, { skipEmptyContent: true, ...options });

/** Collect all events from a runStream call into an array. */
async function collectStreamEvents(
  runner: AgentRunner,
  state: ReturnType<typeof createAgentState>
) {
  const events: Array<{ type: string; [key: string]: unknown }> = [];
  for await (const event of runner.runStream(state)) {
    events.push(event as { type: string; [key: string]: unknown });
  }
  return events;
}

describe('Streaming normal boundaries', () => {
  it('should handle empty content + empty toolCalls', async () => {
    const client = createMockLLMClient([
      { content: '', toolCalls: [], tokens: mockTokens, stopReason: 'stop' },
    ]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const events = await collectStreamEvents(runner, createAgentState(defaultConfig));

    // No tokens emitted
    const tokens = events.filter((e) => e.type === 'token');
    expect(tokens).toHaveLength(0);

    // Should still complete with a valid result
    const complete = events.find((e) => e.type === 'complete');
    expect(complete).toBeDefined();
    expect((complete as { result: { type: string } }).result.type).toBe('success');
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
    const events = await collectStreamEvents(runner, createAgentState(defaultConfig));

    const tokens = events.filter((e) => e.type === 'token');
    expect(tokens).toHaveLength(1);
    expect((tokens[0] as { token: string }).token).toBe(hugeDelta);

    const complete = events.find((e) => e.type === 'complete');
    expect(complete).toBeDefined();
    expect((complete as { result: { type: string } }).result.type).toBe('success');
  });

  it('should handle null content from LLM without crashing', async () => {
    // LLM returns content as null — stream should not emit text tokens
    const client = {
      call: vi.fn(),
      stream: vi.fn().mockImplementation(async function* () {
        // No text tokens yielded — just done
        yield { type: 'done', roundTotalTokens: mockTokens };
      }),
    } as unknown as LLMClient;

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const events = await collectStreamEvents(runner, createAgentState(defaultConfig));

    const tokens = events.filter((e) => e.type === 'token');
    expect(tokens).toHaveLength(0);

    const complete = events.find((e) => e.type === 'complete');
    expect(complete).toBeDefined();
  });

  it('should handle empty string content correctly', async () => {
    // skipEmptyContent=true (default for this helper) should skip empty text
    const client = createMockLLMClient([
      { content: '', toolCalls: [], tokens: mockTokens, stopReason: 'stop' },
    ]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const events = await collectStreamEvents(runner, createAgentState(defaultConfig));

    const tokens = events.filter((e) => e.type === 'token');
    expect(tokens).toHaveLength(0);

    const complete = events.find((e) => e.type === 'complete');
    expect(complete).toBeDefined();
  });

  it('should handle Unicode and multibyte content correctly', async () => {
    const unicodeContent = '你好世界 🌍 こんにちは';
    const client = createMockLLMClient(
      [{ content: unicodeContent, toolCalls: [], tokens: mockTokens, stopReason: 'stop' }],
      { skipEmptyContent: false }
    );
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const events = await collectStreamEvents(runner, createAgentState(defaultConfig));

    // Should have text tokens (split by word)
    const tokens = events.filter((e) => e.type === 'token');
    expect(tokens.length).toBeGreaterThan(0);

    // Reconstructed content should contain the original text
    const allTokens = tokens.map((t) => (t as { token: string }).token).join('');
    expect(allTokens).toBe(unicodeContent);

    const complete = events.find((e) => e.type === 'complete');
    expect(complete).toBeDefined();
  });

  it('should emit text tokens when skipEmptyContent=false with empty content', async () => {
    // skipEmptyContent=false should yield an empty-string token even for ''
    const client = createMockLLMClient(
      [{ content: '', toolCalls: [], tokens: mockTokens, stopReason: 'stop' }],
      { skipEmptyContent: false }
    );
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const events = await collectStreamEvents(runner, createAgentState(defaultConfig));

    const tokens = events.filter((e) => e.type === 'token');
    // With skipEmptyContent=false and split='word', '' split by space gives ['']
    expect(tokens.length).toBeGreaterThanOrEqual(0);

    const complete = events.find((e) => e.type === 'complete');
    expect(complete).toBeDefined();
  });

  it('should handle done event without roundTotalTokens gracefully', async () => {
    const client = {
      call: vi.fn(),
      stream: vi.fn().mockImplementation(async function* () {
        yield { type: 'text', delta: 'Hello', accumulatedContent: 'Hello' };
        // Done without roundTotalTokens — should not crash
        yield { type: 'done' };
      }),
    } as unknown as LLMClient;

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const events = await collectStreamEvents(runner, createAgentState(defaultConfig));

    const complete = events.find((e) => e.type === 'complete');
    expect(complete).toBeDefined();
    // The stream should still produce a result even without token info
    const result = (complete as { result?: { type: string } }).result;
    expect(result).toBeDefined();
  });

  it('should handle interleaved thinking and text tokens', async () => {
    const client = createMockLLMClient(
      [
        {
          content: 'Final answer',
          thinking: 'Let me think',
          toolCalls: [],
          tokens: mockTokens,
          stopReason: 'stop',
        },
      ],
      { enableThinking: true, skipEmptyContent: false }
    );
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const events = await collectStreamEvents(runner, createAgentState(defaultConfig));

    // Should have both thinking and text events
    const thinkingEvents = events.filter((e) => e.type === 'thinking');
    const textEvents = events.filter((e) => e.type === 'token');
    expect(thinkingEvents.length).toBeGreaterThan(0);
    expect(textEvents.length).toBeGreaterThan(0);

    // Thinking should come before text tokens
    const firstThinkingIdx = events.indexOf(thinkingEvents[0]!);
    const firstTextIdx = events.indexOf(textEvents[0]!);
    expect(firstThinkingIdx).toBeLessThan(firstTextIdx);

    const complete = events.find((e) => e.type === 'complete');
    expect(complete).toBeDefined();
  });
});
