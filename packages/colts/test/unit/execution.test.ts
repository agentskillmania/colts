/**
 * @fileoverview Step 4: Step Control Unit Tests
 *
 * Tests for step(), stepStream(), advance(), and advanceStream() methods.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMClient, LLMResponse } from '@agentskillmania/llm-client';
import { AgentRunner } from '../../src/runner.js';
import { createAgentState } from '../../src/state.js';
import type { AgentConfig } from '../../src/types.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { createExecutionState, isTerminalPhase } from '../../src/execution.js';
import type { ExecutionState } from '../../src/execution.js';
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

describe('Step Control', () => {
  describe('advance()', () => {
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
        expect(result.phase.thought).toBe('The answer is 42');
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

      // Progress to parsed phase
      await runner.advance(state, execState); // idle -> preparing
      await runner.advance(state, execState); // preparing -> calling-llm
      await runner.advance(state, execState, registry); // calling-llm -> llm-response
      await runner.advance(state, execState); // llm-response -> parsing
      let result = await runner.advance(state, execState); // parsing -> parsed

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
        expect(result.phase.result).toBe('4');
      }

      // Phase: tool-result -> completed
      result = await runner.advance(result.state, execState);
      expect(result.phase.type).toBe('completed');
      expect(result.done).toBe(true);
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

      // Progress to parsed phase
      await runner.advance(state, execState);
      await runner.advance(state, execState);
      await runner.advance(state, execState);
      await runner.advance(state, execState);
      const result = await runner.advance(state, execState);

      expect(result.phase.type).toBe('parsed');

      // Simulate intervention: modify the action before executing
      if (result.phase.type === 'parsed' && execState.action) {
        execState.action.arguments = { expression: '3 + 3' };
      }

      // Continue execution with modified action
      const registry = new ToolRegistry();
      registry.register({
        name: 'calculate',
        description: 'Calculate',
        parameters: z.object({ expression: z.string() }),
        execute: async ({ expression }) => eval(expression).toString(),
      });

      await runner.advance(result.state, execState, registry); // parsed -> executing-tool
      const finalResult = await runner.advance(result.state, execState, registry); // executing-tool -> tool-result

      if (finalResult.phase.type === 'tool-result') {
        // Should be 6, not 4, because we modified the action
        expect(finalResult.phase.result).toBe('6');
      }
    });
  });

  describe('step()', () => {
    it('should complete with done result for direct answer', async () => {
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
      const { state: newState, result } = await runner.step(state);

      expect(result.type).toBe('done');
      if (result.type === 'done') {
        expect(result.answer).toBe('The answer is 42');
      }

      // State should be updated
      expect(newState.context.stepCount).toBe(1);
      expect(newState.context.messages).toHaveLength(1);

      // Original state unchanged
      expect(state.context.stepCount).toBe(0);
    });

    it('should return continue result when tool is called', async () => {
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
        description: 'Calculate',
        parameters: z.object({ expression: z.string() }),
        execute: async ({ expression }) => eval(expression).toString(),
      });

      const state = createAgentState(defaultConfig);
      const { state: newState, result } = await runner.step(state, registry);

      expect(result.type).toBe('continue');
      if (result.type === 'continue') {
        expect(result.toolResult).toBe('4');
      }

      // State should have assistant thought and tool result
      expect(newState.context.stepCount).toBe(1);
      expect(newState.context.messages).toHaveLength(2);
    });

    it('should handle missing tool registry gracefully', async () => {
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

      // No tool registry provided
      const state = createAgentState(defaultConfig);
      const { result } = await runner.step(state);

      expect(result.type).toBe('continue');
      if (result.type === 'continue') {
        expect(result.toolResult).toContain('not executed');
        expect(result.toolResult).toContain('no tool registry');
      }
    });

    it('should handle LLM error', async () => {
      const client = {
        call: vi.fn().mockRejectedValue(new Error('LLM API error')),
        stream: vi.fn(),
      } as unknown as LLMClient;

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      const state = createAgentState(defaultConfig);
      const { state: newState, result } = await runner.step(state);

      expect(result.type).toBe('done');
      if (result.type === 'done') {
        expect(result.answer).toContain('LLM API error');
      }

      // Original state should be unchanged
      expect(state.context.stepCount).toBe(0);
      // Error is recorded in messages, so step count increments
      expect(newState.context.stepCount).toBe(1);
      expect(newState.context.messages.length).toBe(1);
    });

    it('should use runner tool registry as default', async () => {
      const mockResponse: LLMResponse = {
        content: 'Calculating',
        toolCalls: [
          {
            id: 'call-123',
            name: 'calculate',
            arguments: { expression: '5 * 5' },
          },
        ],
        tokens: mockTokens,
        stopReason: 'tool_calls',
      };

      const client = createMockLLMClient([mockResponse]);

      const registry = new ToolRegistry();
      registry.register({
        name: 'calculate',
        description: 'Calculate math expression',
        parameters: z.object({ expression: z.string() }),
        execute: async ({ expression }) => eval(expression).toString(),
      });

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        toolRegistry: registry,
      });

      const state = createAgentState(defaultConfig);
      const { result } = await runner.step(state);

      expect(result.type).toBe('continue');
      if (result.type === 'continue') {
        expect(result.toolResult).toBe('25');
      }
    });

    it('should prefer passed registry over runner default', async () => {
      const mockResponse: LLMResponse = {
        content: 'Calculating',
        toolCalls: [
          {
            id: 'call-123',
            name: 'multiply',
            arguments: { a: 3, b: 4 },
          },
        ],
        tokens: mockTokens,
        stopReason: 'tool_calls',
      };

      const client = createMockLLMClient([mockResponse]);

      const defaultRegistry = new ToolRegistry();
      defaultRegistry.register({
        name: 'calculate',
        description: 'Calculate',
        parameters: z.object({ expression: z.string() }),
        execute: async () => 'default',
      });

      const passedRegistry = new ToolRegistry();
      passedRegistry.register({
        name: 'multiply',
        description: 'Multiply two numbers',
        parameters: z.object({ a: z.number(), b: z.number() }),
        execute: async ({ a, b }) => (a * b).toString(),
      });

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        toolRegistry: defaultRegistry,
      });

      const state = createAgentState(defaultConfig);
      const { result } = await runner.step(state, passedRegistry);

      expect(result.type).toBe('continue');
      if (result.type === 'continue') {
        expect(result.toolResult).toBe('12');
      }
    });
  });

  describe('stepStream()', () => {
    it('should emit phase-change events', async () => {
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
      const events: { type: string }[] = [];

      for await (const event of runner.stepStream(state)) {
        events.push(event as { type: string });
      }

      // Should have phase-change events
      const phaseChanges = events.filter((e) => e.type === 'phase-change');
      expect(phaseChanges.length).toBeGreaterThan(0);

      // Should end with step completion
      expect(events[events.length - 1].type).toBe('phase-change');
    });

    it('should emit token events during streaming', async () => {
      const mockResponse: LLMResponse = {
        content: 'The answer is here',
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
      const events: { type: string }[] = [];

      for await (const event of runner.stepStream(state)) {
        events.push(event as { type: string });
      }

      // Should have token events
      const tokenEvents = events.filter((e) => e.type === 'token');
      expect(tokenEvents.length).toBeGreaterThan(0);
    });

    it('should emit tool events when tool is called', async () => {
      const mockResponse: LLMResponse = {
        content: 'Let me calculate',
        toolCalls: [
          {
            id: 'call-123',
            name: 'calculate',
            arguments: { expression: '10 / 2' },
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
        description: 'Calculate',
        parameters: z.object({ expression: z.string() }),
        execute: async ({ expression }) => eval(expression).toString(),
      });

      const state = createAgentState(defaultConfig);
      const events: { type: string }[] = [];

      for await (const event of runner.stepStream(state, registry)) {
        events.push(event as { type: string });
      }

      expect(events.some((e) => e.type === 'tool:start')).toBe(true);
      expect(events.some((e) => e.type === 'tool:end')).toBe(true);
    });

    it('should return final result', async () => {
      const mockResponse: LLMResponse = {
        content: 'Final answer',
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
      const iterator = runner.stepStream(state);

      // Manually iterate to get return value
      let result;
      while (true) {
        const { done, value } = await iterator.next();
        if (done) {
          result = value;
          break;
        }
      }

      expect(result).toBeDefined();
      expect(result.state).toBeDefined();
      expect(result.result).toBeDefined();
      expect(result.result.type).toBe('done');
    });

    it('should return continue result when tool is called', async () => {
      const mockResponse: LLMResponse = {
        content: 'Calculating',
        toolCalls: [
          {
            id: 'call-123',
            name: 'calculate',
            arguments: { expression: '10 / 2' },
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
        description: 'Calculate',
        parameters: z.object({ expression: z.string() }),
        execute: async ({ expression }) => eval(expression).toString(),
      });

      const state = createAgentState(defaultConfig);
      const iterator = runner.stepStream(state, registry);

      // Manually iterate to get return value
      let result;
      while (true) {
        const { done, value } = await iterator.next();
        if (done) {
          result = value;
          break;
        }
      }

      expect(result.result.type).toBe('continue');
      if (result.result.type === 'continue') {
        expect(result.result.toolResult).toBe('5');
      }
    });

    it('should handle error case', async () => {
      const client = {
        call: vi.fn().mockRejectedValue(new Error('LLM API error')),
        stream: vi.fn(),
      } as unknown as LLMClient;

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      const state = createAgentState(defaultConfig);

      // Use step() to trigger error handling
      const { result } = await runner.step(state);

      expect(result.type).toBe('done');
      if (result.type === 'done') {
        expect(result.answer).toContain('LLM API error');
      }
    });

    it('should handle tool returning object result', async () => {
      const mockResponse: LLMResponse = {
        content: 'Getting data',
        toolCalls: [
          {
            id: 'call-123',
            name: 'getData',
            arguments: { id: '123' },
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
        name: 'getData',
        description: 'Get data',
        parameters: z.object({ id: z.string() }),
        execute: async ({ id }) => ({ id, name: 'Test Item', value: 42 }),
      });

      const state = createAgentState(defaultConfig);

      // Test stepStream with object result
      const iterator = runner.stepStream(state, registry);
      let result;
      while (true) {
        const { done, value } = await iterator.next();
        if (done) {
          result = value;
          break;
        }
      }

      expect(result.result.type).toBe('continue');
      if (result.result.type === 'continue') {
        expect(typeof result.result.toolResult).toBe('object');
        expect(result.result.toolResult).toEqual({ id: '123', name: 'Test Item', value: 42 });
      }
    });

    it('should handle missing registry in stepStream', async () => {
      const mockResponse: LLMResponse = {
        content: 'Trying to calculate',
        toolCalls: [
          {
            id: 'call-123',
            name: 'someTool',
            arguments: {},
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

      // No registry provided
      const state = createAgentState(defaultConfig);

      const iterator = runner.stepStream(state);
      let result;
      while (true) {
        const { done, value } = await iterator.next();
        if (done) {
          result = value;
          break;
        }
      }

      expect(result.result.type).toBe('continue');
      if (result.result.type === 'continue') {
        expect(result.result.toolResult).toContain('not executed');
        expect(result.result.toolResult).toContain('no tool registry');
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

      // Progress to calling-llm first
      await runner.advance(state, execState); // idle -> preparing
      await runner.advance(state, execState); // preparing -> calling-llm

      // Now use advanceStream
      const events: { type: string }[] = [];
      for await (const event of runner.advanceStream(state, execState)) {
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

      while (!isTerminalPhase(execState.phase)) {
        const result = await runner.advance(phases.length > 0 ? state : state, execState);
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
});
