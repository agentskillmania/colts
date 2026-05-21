/**
 * @fileoverview Naughty LLM — streaming path misbehavior tests
 *
 * Tests edge cases specific to the streaming execution path where the LLM
 * yields malformed or unexpected delta events.
 */

import { describe, it, expect, vi } from 'vitest';
import type { LLMClient, LLMResponse, TokenStats } from '@agentskillmania/llm-client';
import { AgentRunner } from '../../../src/runner/index.js';
import { createAgentState } from '../../../src/state/index.js';
import type { AgentConfig } from '../../../src/types.js';
import { ToolRegistry } from '../../../src/tools/registry.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const mockTokens = { input: 10, output: 5 };

const defaultConfig: AgentConfig = {
  name: 'test-agent',
  instructions: 'You are a helpful assistant.',
  tools: [],
};

function createCalculatorRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    name: 'calculator',
    description: 'Calculate',
    parameters: z.object({ expr: z.string() }),
    execute: async ({ expr }) => `Result: ${expr}`,
  });
  return registry;
}

// ---------------------------------------------------------------------------
// Streaming misbehavior tests
// ---------------------------------------------------------------------------

describe('Naughty LLM — streaming path', () => {
  it('should handle content + tool_call coexistence in stream', async () => {
    // LLM streams text first, then emits a tool_call — both should be captured
    const client = createMockLLMClient([
      {
        content: 'Let me calculate',
        toolCalls: [{ id: 'tc1', name: 'calculator', arguments: { expr: '1+1' } }],
        tokens: mockTokens,
        stopReason: 'toolUse',
      },
      { content: 'Result: 2', toolCalls: [], tokens: mockTokens, stopReason: 'stop' },
    ]);
    const registry = createCalculatorRegistry();
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, toolRegistry: registry });
    const state = createAgentState(defaultConfig);

    const events: Array<{ type: string; [key: string]: unknown }> = [];
    for await (const event of runner.runStream(state)) {
      events.push(event as { type: string; [key: string]: unknown });
    }

    // Should have tokens from the text portion
    const tokens = events.filter((e) => e.type === 'token');
    expect(tokens.length).toBeGreaterThan(0);

    // Should have tool events
    const toolStarts = events.filter((e) => e.type === 'tool:start');
    expect(toolStarts.length).toBe(1);

    // Run should complete
    const complete = events.find((e) => e.type === 'complete');
    expect(complete).toBeTruthy();
    expect((complete as { result: { type: string } }).result.type).toBe('success');
  });

  it('should handle empty content + empty toolCalls in stream', async () => {
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

  it('should handle oversized token delta in stream', async () => {
    // Mock client that yields a single huge delta
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

  it('should catch error thrown mid-stream by LLM provider', async () => {
    const client = {
      call: vi.fn(),
      stream: vi.fn().mockImplementation(async function* () {
        yield { type: 'text', delta: 'Partial', accumulatedContent: 'Partial' };
        throw new Error('Stream connection reset');
      }),
    } as unknown as LLMClient;

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const events: Array<{ type: string; [key: string]: unknown }> = [];
    for await (const event of runner.runStream(state)) {
      events.push(event as { type: string; [key: string]: unknown });
    }

    // Should have received the partial token
    const tokens = events.filter((e) => e.type === 'token');
    expect(tokens.length).toBe(1);

    // Should have error event(s) — both handler-level and runner-level may emit
    const errors = events.filter((e) => e.type === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect((errors[0] as { error: Error }).error.message).toBe('Stream connection reset');

    // Should complete with error result
    const complete = events.find((e) => e.type === 'complete');
    expect(complete).toBeTruthy();
    expect((complete as { result: { type: string } }).result.type).toBe('error');
  });

  it('should handle tool_call with invalid arguments in stream', async () => {
    // Step 1: LLM streams a tool_call with invalid arguments (missing required 'expr')
    //         → tool execution fails → policy returns continue with error text
    // Step 2: LLM recovers with a direct answer
    const client = createMockLLMClient([
      {
        content: '',
        toolCalls: [{ id: 'tc1', name: 'calculator', arguments: {} }],
        tokens: mockTokens,
        stopReason: 'toolUse',
      },
      {
        content: 'I cannot calculate that.',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      },
    ]);

    const registry = createCalculatorRegistry();
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, toolRegistry: registry });
    const state = createAgentState(defaultConfig);

    const events: Array<{ type: string; [key: string]: unknown }> = [];
    for await (const event of runner.runStream(state)) {
      events.push(event as { type: string; [key: string]: unknown });
    }

    // Step 1 should emit tool events (even though execution fails)
    const toolStarts = events.filter((e) => e.type === 'tool:start');
    expect(toolStarts.length).toBe(1);

    // The tool error is captured as a tool:end result, not a stream error
    const toolEnds = events.filter((e) => e.type === 'tool:end');
    expect(toolEnds.length).toBe(1);

    // Run should complete successfully on step 2
    const complete = events.find((e) => e.type === 'complete');
    expect(complete).toBeTruthy();
    expect((complete as { result: { type: string } }).result.type).toBe('success');
  });
});
