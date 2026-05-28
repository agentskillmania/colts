/**
 * @fileoverview Streaming path error handling tests
 *
 * Tests error recovery and fault tolerance specific to the streaming path:
 * LLM provider exceptions mid-stream, invalid tool arguments, etc.
 */

import { describe, it, expect, vi } from 'vitest';
import type { LLMClient, LLMResponse } from '@agentskillmania/llm-client';
import { AgentRunner } from '../../../src/runner/index.js';
import { createAgentState } from '../../../src/state/index.js';
import type { AgentConfig } from '../../../src/types.js';
import { ToolRegistry } from '../../../src/tools/registry.js';
import { z } from 'zod';
import { createMockLLMClient as _createMockLLMClient } from '../../helpers/mock-llm.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createMockLLMClient = (responses: LLMResponse[]) =>
  _createMockLLMClient(responses, { skipEmptyContent: true });
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
// Streaming error handling
// ---------------------------------------------------------------------------

describe('Streaming error handling', () => {
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

  it('should emit abort event when custom policy returns abort', async () => {
    const client = createMockLLMClient([
      { content: 'Hello', toolCalls: [], tokens: mockTokens, stopReason: 'stop' },
    ]);

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      executionPolicy: {
        shouldStop: () => ({ decision: 'stop', reason: 'abort', runResultType: 'abort' }),
        onToolError: () => ({ decision: 'continue', sanitizedResult: 'Error' }),
        onParseError: (error) => ({ decision: 'fail', error }),
      },
    });

    const state = createAgentState(defaultConfig);

    const events: Array<{ type: string }> = [];
    const gen = runner.runStream(state);
    let lastReturn: { result: { type: string } } | undefined;
    while (true) {
      const { done, value } = await gen.next();
      if (done) {
        lastReturn = value as { result: { type: string } };
        break;
      }
      events.push(value as { type: string });
    }

    expect(lastReturn!.result.type).toBe('abort');
  });
});
