/**
 * @fileoverview advance(), advanceStream(), and isTerminalPhase tests
 */

import { describe, it, expect, vi } from 'vitest';
import type { LLMClient, LLMResponse } from '@agentskillmania/llm-client';
import { AgentRunner } from '../../../src/runner/index.js';
import { createAgentState } from '../../../src/state/index.js';
import type { AgentConfig } from '../../../src/types.js';
import { ToolRegistry } from '../../../src/tools/registry.js';
import { createExecutionState, isTerminalPhase } from '../../../src/execution/index.js';
import type { ExecutionState } from '../../../src/execution/index.js';
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

describe('advance()', () => {
  it('should expose internal providers via getter methods', async () => {
    const client = createMockLLMClient([]);
    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
    });

    // When: Get providers
    const llmProvider = runner.getLLMProvider();
    const toolRegistry = runner.getToolRegistry();

    // Then: Should return valid providers
    expect(llmProvider).toBeDefined();
    expect(typeof llmProvider.call).toBe('function');
    expect(typeof llmProvider.stream).toBe('function');

    expect(toolRegistry).toBeDefined();
    expect(typeof toolRegistry.execute).toBe('function');
    expect(typeof toolRegistry.toToolSchemas).toBe('function');
  });

  it('should register and unregister tools at runtime', async () => {
    const client = createMockLLMClient([]);
    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
    });

    // Register a tool
    const testTool = {
      name: 'testTool',
      description: 'Test tool',
      parameters: z.object({ value: z.number() }),
      execute: async ({ value }: { value: number }) => value * 2,
    };
    runner.registerTool(testTool);
    expect(runner.getToolRegistry().has('testTool')).toBe(true);

    // Unregister the tool
    const removed = runner.unregisterTool('testTool');
    expect(removed).toBe(true);
    expect(runner.getToolRegistry().has('testTool')).toBe(false);

    // Unregister non-existent tool returns false
    const notRemoved = runner.unregisterTool('nonexistent');
    expect(notRemoved).toBe(false);
  });

  it('should use default values for LLM quick init', async () => {
    // This test verifies the default branch coverage for createLLMFromQuickInit
    // Note: We cannot fully test this without real API credentials,
    // but we can verify the runner accepts the config
    expect(() => {
      new AgentRunner({
        model: 'gpt-4',
        llm: {
          apiKey: 'test-key',
          // Not providing provider and maxConcurrency to test defaults
        },
      });
    }).not.toThrow();
  });

  it('should handle empty tools array', async () => {
    const client = createMockLLMClient([]);

    // Create runner with empty tools array
    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      tools: [], // Empty array should not throw
    });

    // Registry should be created but empty
    expect(runner.getToolRegistry()).toBeDefined();
    expect(runner.getToolRegistry().getToolNames()).toHaveLength(0);
  });

  it('should return unchanged when advancing from error phase', async () => {
    const client = createMockLLMClient([]);
    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
    });

    const state = createAgentState(defaultConfig);
    const execState = createExecutionState();

    // Set phase to error
    const testError = new Error('Test error');
    execState.phase = { type: 'error', error: testError };

    // When: Advance from error phase
    const result = await runner.advance(state, execState);

    // Then: Should return unchanged with done=true
    expect(result.phase.type).toBe('error');
    expect(result.done).toBe(true);
    expect(result.state).toBe(state); // Same state reference
  });

  it('should handle unknown phase by converting to error', async () => {
    const client = createMockLLMClient([]);
    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
    });

    const state = createAgentState(defaultConfig);
    const execState = createExecutionState();

    // Set an invalid phase type
    (execState.phase as any) = { type: 'unknown-phase' };

    // When: Advance with unknown phase
    const result = await runner.advance(state, execState);

    // Then: Should convert to error phase
    expect(result.phase.type).toBe('error');
    expect(result.done).toBe(true);
    if (result.phase.type === 'error') {
      expect(result.phase.error.message).toContain('Unknown phase');
    }
  });

  it('should handle non-Error thrown value in advance', async () => {
    // Force advance() to catch a non-Error value (covers else branch of instanceof check)
    const client = createMockLLMClient([]);
    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
    });

    const state = createAgentState(defaultConfig);
    const execState = createExecutionState();

    // Use a phase that triggers advanceToLLMResponse, but mock call to throw a string
    const throwClient = {
      call: vi.fn().mockRejectedValue('string error'),
      stream: vi.fn(),
    } as unknown as LLMClient;
    const throwRunner = new AgentRunner({ model: 'gpt-4', llmClient: throwClient });

    execState.phase = { type: 'calling-llm' };
    const result = await throwRunner.advance(state, execState);

    expect(result.phase.type).toBe('error');
    if (result.phase.type === 'error') {
      expect(result.phase.error.message).toBe('string error');
    }
  });

  it('should convert missing action error to error phase', async () => {
    // Given: An execState in executing-tool phase but without action
    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => eval(expression).toString(),
    });

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

    const state = createAgentState(defaultConfig);
    const execState = createExecutionState();

    // Progress to executing-tool phase, correctly pass result.state
    let result = await runner.advance(state, execState); // idle -> preparing
    result = await runner.advance(result.state, execState); // preparing -> calling-llm
    result = await runner.advance(result.state, execState, registry); // calling-llm -> llm-response
    result = await runner.advance(result.state, execState); // llm-response -> parsing
    result = await runner.advance(result.state, execState); // parsing -> parsed
    result = await runner.advance(result.state, execState, registry); // parsed -> executing-tool

    expect(execState.phase.type).toBe('executing-tool');

    // Manually clear actions to simulate invalid state
    if (execState.phase.type === 'executing-tool') {
      execState.phase.actions = [];
    }

    // When: Advance to tool-result without actions
    result = await runner.advance(result.state, execState, registry);

    // Then: Error should be caught and converted to error phase
    expect(result.phase.type).toBe('error');
    expect(result.done).toBe(true);
    if (result.phase.type === 'error') {
      expect(result.phase.error.message).toBe('No actions to execute');
    }
  });

  it('should progress through phases for direct answer', async () => {
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
    const execState = createExecutionState();

    // Phase: idle -> preparing
    let result = await runner.advance(state, execState);
    expect(result.phase.type).toBe('preparing');
    expect(result.done).toBe(false);

    // Phase: preparing -> calling-llm
    result = await runner.advance(result.state, execState);
    expect(result.phase.type).toBe('calling-llm');
    expect(result.done).toBe(false);

    // Phase: calling-llm -> llm-response (makes actual LLM call)
    result = await runner.advance(result.state, execState);
    expect(result.phase.type).toBe('llm-response');
    expect(result.done).toBe(false);
    expect(result.tokens).toEqual(mockTokens);
    expect(execState.llmResponse).toBe('The answer is 42');

    // Phase: llm-response -> parsing
    result = await runner.advance(result.state, execState);
    expect(result.phase.type).toBe('parsing');
    expect(result.done).toBe(false);

    // Phase: parsing -> parsed
    result = await runner.advance(result.state, execState);
    expect(result.phase.type).toBe('parsed');
    expect(result.done).toBe(false);
    if (result.phase.type === 'parsed') {
      // No explicit thinking in the response, so thought is empty
      expect(result.phase.thought).toBe('');
      expect(result.phase.action).toBeUndefined();
    }

    // Phase: parsed -> completed (no action needed)
    result = await runner.advance(result.state, execState);
    expect(result.phase.type).toBe('completed');
    expect(result.done).toBe(true);
    if (result.phase.type === 'completed') {
      expect(result.phase.answer).toBe('The answer is 42');
    }
  });

  it('should return new immutable state on each advance', async () => {
    const mockResponse: LLMResponse = {
      content: 'The answer',
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
    let currentState = state;

    // Progress through phases and verify data integrity
    while (!isTerminalPhase(execState.phase)) {
      const result = await runner.advance(currentState, execState);
      // Update current state for next iteration
      currentState = result.state;
    }

    // Original state should be unchanged
    expect(state.context.stepCount).toBe(0);
    // All transitions completed
    expect(execState.phase.type).toBe('completed');
  });

  it('should progress through phases for tool execution', async () => {
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
      description: 'Calculate math expression',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => {
        return eval(expression).toString();
      },
    });

    const state = createAgentState(defaultConfig);
    const execState = createExecutionState();

    // Progress to parsed phase, correctly pass result.state
    let result = await runner.advance(state, execState); // idle -> preparing
    result = await runner.advance(result.state, execState); // preparing -> calling-llm
    result = await runner.advance(result.state, execState, registry); // calling-llm -> llm-response
    result = await runner.advance(result.state, execState); // llm-response -> parsing
    result = await runner.advance(result.state, execState); // parsing -> parsed

    expect(result.phase.type).toBe('parsed');
    if (result.phase.type === 'parsed') {
      expect(result.phase.action).toBeDefined();
      expect(result.phase.action?.tool).toBe('calculate');
    }

    // Phase: parsed -> executing-tool
    result = await runner.advance(result.state, execState, registry);
    expect(result.phase.type).toBe('executing-tool');
    expect(result.done).toBe(false);

    // Phase: executing-tool -> tool-result
    result = await runner.advance(result.state, execState, registry);
    expect(result.phase.type).toBe('tool-result');
    expect(result.done).toBe(false);
    if (result.phase.type === 'tool-result') {
      expect(Object.values(result.phase.results)[0]).toBe('4');
    }

    // New architecture: ToolResultHandler returns tool:end effect for plain tool result
    // phase stays tool-result, done=false (advance() does not auto-transition to completed)
    // User gets tool:end event through effects
    result = await runner.advance(result.state, execState);
    expect(result.phase.type).toBe('tool-result');
    expect(result.done).toBe(false);
    // Handler should produce tool:end effect
    expect(result.effects).toBeDefined();
    expect(result.effects!.some((e) => e.type === 'tool:end')).toBe(true);
  });

  it('should format SWITCH_SKILL signal as LLM-friendly tool result', async () => {
    const mockResponse: LLMResponse = {
      content: 'Loading skill',
      toolCalls: [
        {
          id: 'call-skill-1',
          name: 'load_skill',
          arguments: { name: 'tell-time' },
        },
      ],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      skills: [],
    });

    // Register a load_skill tool that returns a SWITCH_SKILL signal
    const registry = runner.getToolRegistry();
    registry.register({
      name: 'load_skill',
      description: 'Load a skill',
      parameters: z.object({ name: z.string() }),
      execute: async () => ({
        type: 'SWITCH_SKILL',
        to: 'tell-time',
        instructions: 'Report current time',
        task: 'Get time',
      }),
    });

    const state = createAgentState(defaultConfig);
    const execState = createExecutionState();

    // Progress through phases to tool-result
    let result = await runner.advance(state, execState); // idle -> preparing
    result = await runner.advance(result.state, execState); // preparing -> calling-llm
    result = await runner.advance(result.state, execState, registry); // calling-llm -> llm-response
    result = await runner.advance(result.state, execState); // llm-response -> parsing
    result = await runner.advance(result.state, execState); // parsing -> parsed
    result = await runner.advance(result.state, execState, registry); // parsed -> executing-tool
    result = await runner.advance(result.state, execState, registry); // executing-tool -> tool-result

    // Verify tool result message is LLM-friendly, not raw JSON
    const messages = result.state.context.messages;
    // After skill switch, a task user message is injected, so the tool message is second-to-last
    const toolMsg = messages[messages.length - 2];
    expect(toolMsg.role).toBe('tool');
    expect(toolMsg.content).toContain("Skill 'tell-time' loaded");
    expect(toolMsg.content).not.toContain('SWITCH_SKILL');
    expect(toolMsg.content).not.toContain('"type"');
    // The last message is the injected task user message
    const taskMsg = messages[messages.length - 1];
    expect(taskMsg.role).toBe('user');
    expect(taskMsg.content).toBe('Get time');
  });

  it('should format RETURN_SKILL signal with actual result text', async () => {
    const mockResponse: LLMResponse = {
      content: 'Returning',
      toolCalls: [
        {
          id: 'call-return-1',
          name: 'return_skill',
          arguments: { result: 'It is 2:30 PM' },
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

    const registry = runner.getToolRegistry();
    registry.register({
      name: 'return_skill',
      description: 'Return from skill',
      parameters: z.object({ result: z.string() }),
      execute: async () => ({
        type: 'RETURN_SKILL',
        result: 'It is 2:30 PM',
        status: 'success',
      }),
    });

    const state = createAgentState(defaultConfig);
    const execState = createExecutionState();

    let result = await runner.advance(state, execState);
    result = await runner.advance(result.state, execState);
    result = await runner.advance(result.state, execState, registry);
    result = await runner.advance(result.state, execState);
    result = await runner.advance(result.state, execState);
    result = await runner.advance(result.state, execState, registry);
    result = await runner.advance(result.state, execState, registry);

    // Verify tool result message contains the actual result text
    const lastMsg = result.state.context.messages[result.state.context.messages.length - 1];
    expect(lastMsg.role).toBe('tool');
    expect(lastMsg.content).toBe('It is 2:30 PM');
    expect(lastMsg.content).not.toContain('RETURN_SKILL');
  });

  it('should allow intervention at parsed phase', async () => {
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

    const state = createAgentState(defaultConfig);
    const execState = createExecutionState();

    // Progress to parsed phase, correctly pass result.state
    let result = await runner.advance(state, execState); // idle -> preparing
    result = await runner.advance(result.state, execState); // preparing -> calling-llm
    result = await runner.advance(result.state, execState); // calling-llm -> llm-response
    result = await runner.advance(result.state, execState); // llm-response -> parsing
    result = await runner.advance(result.state, execState); // parsing -> parsed

    expect(result.phase.type).toBe('parsed');

    // Simulate intervention: modify the action before executing
    if (result.phase.type === 'parsed' && execState.allActions && execState.allActions.length > 0) {
      execState.allActions[0].arguments = { expression: '3 + 3' };
    }

    // Continue execution with modified action
    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => eval(expression).toString(),
    });

    const stepResult = await runner.advance(result.state, execState, registry); // parsed -> executing-tool
    const finalResult = await runner.advance(stepResult.state, execState, registry); // executing-tool -> tool-result

    if (finalResult.phase.type === 'tool-result') {
      // Should be 6, not 4, because we modified the action
      expect(Object.values(finalResult.phase.results)[0]).toBe('6');
    }
  });
});

describe('advanceStream()', () => {
  it('should emit events during phase advancement', async () => {
    const mockResponse: LLMResponse = {
      content: 'The answer',
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

    // Progress to calling-llm first, correctly pass result.state
    let result = await runner.advance(state, execState); // idle -> preparing
    result = await runner.advance(result.state, execState); // preparing -> calling-llm

    // Now use advanceStream
    const events: { type: string }[] = [];
    for await (const event of runner.advanceStream(result.state, execState)) {
      events.push({ type: event.type });
    }

    // Should have phase-change and token events
    expect(events.some((e) => e.type === 'phase-change')).toBe(true);
    expect(events.some((e) => e.type === 'token')).toBe(true);
  });

  it('should work from idle phase', async () => {
    const mockResponse: LLMResponse = {
      content: 'The answer',
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

    // Use advanceStream directly from idle
    const events: { type: string }[] = [];
    for await (const event of runner.advanceStream(state, execState)) {
      events.push({ type: event.type });
    }

    // Should complete with phase-change events
    expect(events.some((e) => e.type === 'phase-change')).toBe(true);
  });

  it('should yield error event when LLM fails during calling-llm phase', async () => {
    const client = {
      call: vi.fn(),
      stream: vi.fn().mockImplementation(async function* () {
        throw new Error('LLM stream error');
      }),
    } as unknown as LLMClient;

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
    });

    const state = createAgentState(defaultConfig);
    const execState = createExecutionState();

    // Progress to calling-llm phase, correctly pass result.state
    let result = await runner.advance(state, execState); // idle -> preparing
    result = await runner.advance(result.state, execState); // preparing -> calling-llm

    // Use advanceStream to trigger streaming LLM call
    const events: { type: string }[] = [];
    for await (const event of runner.advanceStream(result.state, execState)) {
      events.push({ type: event.type });
    }

    // Should emit error event
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(events.some((e) => e.type === 'phase-change')).toBe(true);
  });

  // P1 Regression: advanceStream() must yield ToolResultHandler effects
  it('should yield tool:end effect when advanceStream reaches tool-result phase', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'calculator',
      description: 'Calculates math',
      parameters: z.object({ expr: z.string() }),
      execute: async () => '42',
    });

    const mockResponse: LLMResponse = {
      content: '',
      toolCalls: [{ id: 'tc1', name: 'calculator', arguments: { expr: '6*7' } }],
      tokens: mockTokens,
      stopReason: 'toolUse',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      toolRegistry: registry,
    });

    const state = createAgentState(defaultConfig);
    const execState = createExecutionState();

    // Advance from idle, collecting events via advanceStream each step
    const eventTypes: string[] = [];
    let currentState = state;
    for (let i = 0; i < 20; i++) {
      const events: { type: string }[] = [];
      for await (const event of runner.advanceStream(currentState, execState)) {
        events.push({ type: event.type });
      }
      eventTypes.push(...events.map((e) => e.type));

      // Use blocking advance to progress execState
      const result = await runner.advance(currentState, execState);
      currentState = result.state;
      if (isTerminalPhase(result.phase)) break;
    }

    // Should yield tool:end effect (produced by ToolResultHandler)
    expect(eventTypes).toContain('tool:end');
  });
});

// T1: Regression test — skillState should update after SWITCH_SKILL via advance()
describe('advance() skillState regression (CR P0-1)', () => {
  it('should update skillState.current after SWITCH_SKILL via advance()', async () => {
    const mockResponse: LLMResponse = {
      content: 'Loading skill',
      toolCalls: [
        {
          id: 'call-skill-t1',
          name: 'load_skill',
          arguments: { name: 'test-skill' },
        },
      ],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      skills: [],
    });

    const registry = runner.getToolRegistry();
    registry.register({
      name: 'load_skill',
      description: 'Load a skill',
      parameters: z.object({ name: z.string() }),
      execute: async () => ({
        type: 'SWITCH_SKILL',
        to: 'test-skill',
        instructions: 'Test skill instructions',
        task: 'Do the test thing',
      }),
    });

    const state = createAgentState(defaultConfig);
    const execState = createExecutionState();

    // Progress to tool-result phase where SWITCH_SKILL fires
    let result = await runner.advance(state, execState); // idle → preparing
    result = await runner.advance(result.state, execState); // preparing → calling-llm
    result = await runner.advance(result.state, execState, registry); // calling-llm → llm-response
    result = await runner.advance(result.state, execState); // llm-response → parsing
    result = await runner.advance(result.state, execState); // parsing → parsed
    result = await runner.advance(result.state, execState, registry); // parsed → executing-tool
    result = await runner.advance(result.state, execState, registry); // executing-tool → tool-result

    // Executing-tool handler writes tool message and injects task user message
    // But skillState is not updated yet at this stage (handled by ToolResultHandler)

    // Advance once more: ToolResultHandler processes SWITCH_SKILL signal
    result = await runner.advance(result.state, execState);

    // New architecture: ToolResultHandler produces skill:start + tool:end effects
    // Phase becomes idle (indicating skill loaded, step loop should continue)
    expect(result.phase.type).toBe('idle');
    expect(result.done).toBe(false);
    expect(result.effects).toBeDefined();
    expect(result.effects!.map((e) => e.type)).toContain('skill:start');

    // skillState.current should be updated to 'test-skill' by applySkillSignal
    const skillState = result.state.context.skillState;
    expect(skillState).toBeDefined();
    expect(skillState?.current).toBe('test-skill');
    // loadedInstructions should contain skill instructions
    expect(skillState?.loadedInstructions).toContain('Test skill instructions');
  });
});

describe('isTerminalPhase', () => {
  it('should return true for completed phase', () => {
    expect(isTerminalPhase({ type: 'completed', answer: 'done' })).toBe(true);
  });

  it('should return true for error phase', () => {
    expect(isTerminalPhase({ type: 'error', error: new Error('test') })).toBe(true);
  });

  it('should return false for non-terminal phases', () => {
    expect(isTerminalPhase({ type: 'idle' })).toBe(false);
    expect(isTerminalPhase({ type: 'preparing', messages: [] })).toBe(false);
    expect(isTerminalPhase({ type: 'calling-llm' })).toBe(false);
    expect(isTerminalPhase({ type: 'parsed', thought: 'test' })).toBe(false);
  });
});
