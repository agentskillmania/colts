/**
 * @fileoverview Execution state type tests
 */

import { describe, it, expect, vi } from 'vitest';
import type { LLMClient, LLMResponse } from '@agentskillmania/llm-client';
import { AgentRunner } from '../../../src/runner/index.js';
import { createAgentState } from '../../../src/state/index.js';
import type { AgentConfig } from '../../../src/types.js';
import { createExecutionState, isTerminalPhase } from '../../../src/execution/index.js';
import type { ExecutionState } from '../../../src/execution/index.js';

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

describe('Invariants', () => {
  it('should maintain state data integrity across all operations', async () => {
    const mockResponse: LLMResponse = {
      content: 'Test response',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
    });

    const originalState = createAgentState(defaultConfig);
    const originalId = originalState.id;
    const originalStepCount = originalState.context.stepCount;

    // Perform step operation
    const { state: newState } = await runner.step(originalState);

    // Original state should be unchanged
    expect(originalState.id).toBe(originalId);
    expect(originalState.context.stepCount).toBe(originalStepCount);

    // New state should have updates
    expect(newState.context.stepCount).toBe(1);
    expect(newState.context.messages.length).toBe(1);
  });

  it('should correctly transition through all phases', async () => {
    const mockResponse: LLMResponse = {
      content: 'Test',
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
    const execState = createExecutionState();
    const phases: string[] = [];
    let currentState = state;

    while (!isTerminalPhase(execState.phase)) {
      const result = await runner.advance(currentState, execState);
      currentState = result.state;
      phases.push(result.phase.type);

      // Safety limit
      if (phases.length > 20) break;
    }

    // Should have progressed through expected phases
    expect(phases).toContain('preparing');
    expect(phases).toContain('calling-llm');
    expect(phases).toContain('llm-response');
    expect(phases).toContain('parsing');
    expect(phases).toContain('parsed');
    expect(phases).toContain('completed');
  });
});
