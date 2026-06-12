/**
 * @fileoverview run() and runStream() tests
 */

import { describe, it, expect, vi } from 'vitest';
import type { LLMClient, LLMResponse } from '@agentskillmania/llm-client';
import {
  AgentRunner,
  DEFAULT_RUNNER_MAX_STEPS,
  RUN_HARD_LIMIT,
} from '../../../src/runner/index.js';
import { createAgentState } from '../../../src/state/index.js';
import type { AgentConfig } from '../../../src/types.js';
import { createMockLLMClient as _createMockLLMClient } from '../../helpers/mock-llm.js';
import { safeEval } from '../helpers/safe-eval.js';
import type { SubAgentConfig } from '../../../src/subagent/types.js';
import { ToolRegistry } from '../../../src/tools/registry.js';
import { z } from 'zod';

// Helper to create mock LLM client
const createMockLLMClient = (responses: LLMResponse[]) =>
  _createMockLLMClient(responses, { enableThinking: true });
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

describe('run()', () => {
  it('should return success for single-step direct answer', async () => {
    const mockResponse: LLMResponse = {
      content: 'The answer is 42',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const { state: finalState, result } = await runner.run(state);

    expect(result.type).toBe('success');
    if (result.type === 'success') {
      expect(result.answer).toBe('The answer is 42');
      expect(result.totalSteps).toBe(1);
    }

    // Token tracking
    expect(result.tokens).toEqual(mockTokens);
    expect(finalState.context.totalTokens).toEqual(mockTokens);

    // Original state is immutable
    expect(state.context.stepCount).toBe(0);
    expect(finalState.context.stepCount).toBe(1);
  });

  it('should loop through tool execution to final answer', async () => {
    const responses: LLMResponse[] = [
      {
        // Step 1: LLM calls tool
        content: 'Let me calculate',
        toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '2+2' } }],
        tokens: mockTokens,
        stopReason: 'tool_calls',
      },
      {
        // Step 2: LLM gives final answer
        content: 'The result is 4',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      },
    ];

    const client = createMockLLMClient(responses);
    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => safeEval(expression).toString(),
    });

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const { state: finalState, result } = await runner.run(state, undefined, registry);

    expect(result.type).toBe('success');
    if (result.type === 'success') {
      expect(result.answer).toBe('The result is 4');
      expect(result.totalSteps).toBe(2);
    }

    // Token tracking: accumulated across 2 steps
    expect(result.tokens).toEqual({ input: 20, output: 10 });
    expect(finalState.context.totalTokens).toEqual({ input: 20, output: 10 });

    expect(finalState.context.stepCount).toBe(2);
    expect(state.context.stepCount).toBe(0);
  });

  it('should return max_steps when limit is reached', async () => {
    // LLM calls tool every time, never stops
    const toolCallResponse: LLMResponse = {
      content: 'Thinking...',
      toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '1+1' } }],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };

    // Return enough tool call responses
    const responses = Array(10).fill(toolCallResponse);
    const client = createMockLLMClient(responses);

    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => safeEval(expression).toString(),
    });

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const { result } = await runner.run(state, { maxSteps: 3 }, registry);

    expect(result.type).toBe('max_steps');
    if (result.type === 'max_steps') {
      expect(result.totalSteps).toBe(3);
    }
  });

  it('should use default maxSteps of 500', () => {
    expect(DEFAULT_RUNNER_MAX_STEPS).toBe(500);
  });

  it('should handle LLM error and return error result', async () => {
    const client = {
      call: vi.fn().mockRejectedValue(new Error('API error')),
      stream: vi.fn(),
    } as unknown as LLMClient;

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const { result } = await runner.run(state);

    // step() catches error internally, returns error
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.error.message).toBe('API error');
      expect(result.totalSteps).toBe(1);
    }
  });

  it('should use runner tool registry as default', async () => {
    const responses: LLMResponse[] = [
      {
        content: 'Calculating',
        toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '5*5' } }],
        tokens: mockTokens,
        stopReason: 'tool_calls',
      },
      {
        content: 'The result is 25',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      },
    ];

    const client = createMockLLMClient(responses);
    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => safeEval(expression).toString(),
    });

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, toolRegistry: registry });
    const state = createAgentState(defaultConfig);

    const { result } = await runner.run(state);

    expect(result.type).toBe('success');
    if (result.type === 'success') {
      expect(result.answer).toBe('The result is 25');
    }
  });
});

describe('runStream()', () => {
  it('should emit step:start, token, step:end, and complete events', async () => {
    const mockResponse: LLMResponse = {
      content: 'Hello world',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const events: { type: string }[] = [];
    for await (const event of runner.runStream(state)) {
      events.push(event as { type: string });
    }

    // Should have step:start
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['step:start', 'token', 'step:end', 'complete'])
    );
  });

  it('should yield token events for real-time output', async () => {
    const mockResponse: LLMResponse = {
      content: 'One two three',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const tokens: string[] = [];
    for await (const event of runner.runStream(state)) {
      if (event.type === 'token') {
        tokens.push(event.token);
      }
    }

    expect(tokens.length).toBeGreaterThan(0);
    // Concatenated result should contain full content
    expect(tokens.join('')).toBe('One two three');
  });

  it('should emit events across multiple steps', async () => {
    const responses: LLMResponse[] = [
      {
        content: 'Calculating',
        toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '1+1' } }],
        tokens: mockTokens,
        stopReason: 'tool_calls',
      },
      {
        content: 'The result is 2',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      },
    ];

    const client = createMockLLMClient(responses);
    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => safeEval(expression).toString(),
    });

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const stepStarts: number[] = [];
    const stepEnds: number[] = [];

    for await (const event of runner.runStream(state, undefined, registry)) {
      if (event.type === 'step:start') stepStarts.push(event.step);
      if (event.type === 'step:end') stepEnds.push(event.step);
    }

    expect(stepStarts).toHaveLength(2);
    expect(stepEnds).toHaveLength(2);
    expect(stepStarts[0]).toBe(0);
    expect(stepStarts[1]).toBe(1);
  });

  it('should return final result via generator return value', async () => {
    const mockResponse: LLMResponse = {
      content: 'Final answer',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const iterator = runner.runStream(state);
    let returnValue;
    while (true) {
      const { done, value } = await iterator.next();
      if (done) {
        returnValue = value;
        break;
      }
    }

    expect(returnValue.result.type).toBe('success');
    if (returnValue.result.type === 'success') {
      expect(returnValue.result.answer).toBe('Final answer');
      expect(returnValue.result.totalSteps).toBe(1);
    }
    expect(returnValue.state.context.stepCount).toBe(1);
  });

  it('should handle maxSteps in streaming mode', async () => {
    const toolCallResponse: LLMResponse = {
      content: 'Thinking...',
      toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '1+1' } }],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };

    const responses = Array(5).fill(toolCallResponse);
    const client = createMockLLMClient(responses);

    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => safeEval(expression).toString(),
    });

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const iterator = runner.runStream(state, { maxSteps: 2 }, registry);
    let returnValue;
    while (true) {
      const { done, value } = await iterator.next();
      if (done) {
        returnValue = value;
        break;
      }
    }

    expect(returnValue.result.type).toBe('max_steps');
    if (returnValue.result.type === 'max_steps') {
      expect(returnValue.result.totalSteps).toBe(2);
    }
  });

  it('should support interruption via break', async () => {
    const toolCallResponse: LLMResponse = {
      content: 'Thinking...',
      toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '1+1' } }],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };

    const responses = Array(10).fill(toolCallResponse);
    const client = createMockLLMClient(responses);

    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => safeEval(expression).toString(),
    });

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    let stepCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const event of runner.runStream(state, undefined, registry)) {
      stepCount++;
      if (stepCount > 5) break; // interrupt streaming
    }

    // Should have interrupted without error
    expect(stepCount).toBeGreaterThan(0);
  });

  it('should emit tool:start and tool:end events', async () => {
    const responses: LLMResponse[] = [
      {
        content: 'Calculating',
        toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '3+3' } }],
        tokens: mockTokens,
        stopReason: 'tool_calls',
      },
      {
        content: 'The result is 6',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      },
    ];

    const client = createMockLLMClient(responses);
    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => safeEval(expression).toString(),
    });

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const events: { type: string }[] = [];
    for await (const event of runner.runStream(state, undefined, registry)) {
      events.push(event as { type: string });
    }

    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['tool:start', 'tool:end']));
  });

  it('should maintain immutability across streaming steps', async () => {
    const responses: LLMResponse[] = [
      {
        content: 'Calculating',
        toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '1+1' } }],
        tokens: mockTokens,
        stopReason: 'tool_calls',
      },
      {
        content: 'Done',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      },
    ];

    const client = createMockLLMClient(responses);
    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => safeEval(expression).toString(),
    });

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const originalState = createAgentState(defaultConfig);
    const originalStepCount = originalState.context.stepCount;

    const iterator = runner.runStream(originalState, undefined, registry);
    let returnValue;
    while (true) {
      const { done, value } = await iterator.next();
      if (done) {
        returnValue = value;
        break;
      }
    }

    // Original state is immutable
    expect(originalState.context.stepCount).toBe(originalStepCount);
    // Final state is updated
    expect(returnValue.state.context.stepCount).toBe(2);
  });

  it('should handle error via runStream', async () => {
    const client = {
      call: vi.fn().mockRejectedValue(new Error('LLM down')),
      stream: vi.fn().mockImplementation(async function* () {
        throw new Error('LLM down');
      }),
    } as unknown as LLMClient;

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const events: { type: string }[] = [];
    let returnValue: { result: { type: string } } | undefined;
    const iterator = runner.runStream(state);
    while (true) {
      const { done, value } = await iterator.next();
      if (done) {
        returnValue = value;
        break;
      }
      events.push(value as { type: string });
    }

    // Should emit complete event with error result
    expect(events.map((e) => e.type)).toContain('complete');
    expect(returnValue!.result.type).toBe('error');
    if (returnValue!.result.type === 'error') {
      expect(returnValue!.result.error.message).toBe('LLM down');
    }
  });

  // ============================================================
  // SubAgent runStream event propagation
  // ============================================================
  it('should propagate subagent events through runStream', async () => {
    /** Create test sub-agent configs */
    const createTestSubAgents = (): SubAgentConfig[] => [
      {
        name: 'researcher',
        description: 'Information research specialist',
        config: {
          name: 'researcher',
          instructions: 'You are a research specialist.',
          tools: [],
        },
        maxSteps: 5,
      },
    ];

    // Step 1: Main agent delegates to sub-agent
    const delegateResponse: LLMResponse = {
      content: 'Delegating to researcher',
      toolCalls: [
        {
          id: 'call-delegate-1',
          name: 'delegate',
          arguments: { agent: 'researcher', task: 'Research topic X' },
        },
      ],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };

    // Sub-agent LLM response (inside delegate tool)
    const subAgentResponse: LLMResponse = {
      content: 'Research result: found relevant info.',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    // Step 2: Main agent gives final answer based on sub-agent result
    const finalResponse: LLMResponse = {
      content: 'Based on research, the answer is X.',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([delegateResponse, subAgentResponse, finalResponse]);
    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      subAgents: createTestSubAgents(),
    });

    const state = createAgentState(defaultConfig);
    const events: { type: string }[] = [];

    for await (const event of runner.runStream(state)) {
      events.push(event as { type: string });
    }

    // Should have subagent, step, and complete events
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining([
        'subagent:start',
        'subagent:end',
        'step:start',
        'step:end',
        'complete',
      ])
    );

    // Verify subagent:start is before subagent:end
    const startIndex = events.findIndex((e) => e.type === 'subagent:start');
    const endIndex = events.findIndex((e) => e.type === 'subagent:end');
    expect(startIndex).toBeLessThan(endIndex);

    // Verify final result
    const completeEvent = events.find((e) => e.type === 'complete') as {
      type: string;
      result: { type: string; answer: string; totalSteps: number };
    };
    expect(completeEvent.result.type).toBe('success');
    expect(completeEvent.result.answer).toBe('Based on research, the answer is X.');
    expect(completeEvent.result.totalSteps).toBe(2);
  });

  it('should handle error in runStream', async () => {
    const errorClient = {
      call: vi.fn().mockRejectedValue(new Error('LLM Error')),
      stream: vi.fn().mockImplementation(async function* () {
        throw new Error('LLM Error');
      }),
    };

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: errorClient as unknown as LLMClient,
    });
    const state = createAgentState(defaultConfig);

    const events: { type: string; error?: Error }[] = [];
    let finalResult;

    try {
      const iterator = runner.runStream(state);
      while (true) {
        const { done, value } = await iterator.next();
        if (done) {
          finalResult = value;
          break;
        }
        events.push(value as { type: string; error?: Error });
      }
    } catch (error) {
      // Error may or may not be thrown depending on where it occurs
    }

    // Should either have error events or error result
    const hasErrorEvent = events.some((e) => e.type === 'error');
    const hasErrorResult = finalResult?.result?.type === 'error';
    expect(hasErrorEvent).toBe(true);
    expect(hasErrorResult).toBe(true);
  });

  it('should handle error in stepStream when LLM fails', async () => {
    const errorClient = {
      call: vi.fn().mockRejectedValue(new Error('Step Error')),
      stream: vi.fn().mockImplementation(async function* () {
        throw new Error('Step Error');
      }),
    };

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: errorClient as unknown as LLMClient,
    });
    const state = createAgentState(defaultConfig);

    // stepStream catches execution errors and returns error result (does not throw)
    const events: { type: string; error?: Error }[] = [];
    let finalResult: { state: AgentState; result: { type: string; error?: Error } } | undefined;

    const iterator = runner.stepStream(state);
    while (true) {
      const { done, value } = await iterator.next();
      if (done) {
        finalResult = value as typeof finalResult;
        break;
      }
      events.push(value as { type: string; error?: Error });
    }

    // Should return error result
    expect(finalResult).toBeDefined();
    expect(finalResult!.result.type).toBe('error');
    expect(finalResult!.result.error!.message).toBe('Step Error');

    // Should have yielded an error event before returning
    const errorEvents = events.filter((e) => e.type === 'error');
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
    expect(errorEvents[0]!.error!.message).toBe('Step Error');
  });

  it('should reach maxSteps in runStream', async () => {
    // Use maxSteps: 1 with a simple answer to test the max_steps path
    const answerResponse: LLMResponse = {
      content: 'Answer',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([answerResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, maxSteps: 1 });
    const state = createAgentState(defaultConfig);

    let finalResult;
    for await (const event of runner.runStream(state)) {
      if (event.type === 'complete') {
        finalResult = event.result;
      }
    }

    expect(finalResult?.type).toBe('success');
    expect(finalResult?.totalSteps).toBe(1);
  });

  it('should emit compress events in run when compression is triggered', async () => {
    // Need at least 3 steps with 2 compressions to cover all ?? branches
    const toolCallResponse: LLMResponse = {
      content: 'Calculating',
      toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '1+1' } }],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };
    const finalResponse: LLMResponse = {
      content: 'Answer',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([toolCallResponse, toolCallResponse, finalResponse]);

    let compressCount = 0;
    const mockCompressor: import('../../../src/types.js').IContextCompressor = {
      shouldCompress: vi.fn().mockReturnValue(true),
      compress: vi.fn().mockImplementation(() => {
        compressCount++;
        return Promise.resolve({
          summary: 'Test summary ' + compressCount,
          anchor: 5 * compressCount,
        });
      }),
    };

    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => safeEval(expression).toString(),
    });

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      compressor: mockCompressor,
    });

    const state = createAgentState(defaultConfig);

    const events: string[] = [];
    runner.on('compressing', () => events.push('compressing'));
    runner.on('compressed', () => events.push('compressed'));

    await runner.run(state, undefined, registry);

    expect(events).toEqual(['compressing', 'compressed', 'compressing', 'compressed']);
  });

  it('should emit abort event when custom policy returns abort in run()', async () => {
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

    const events: string[] = [];
    runner.on('abort', () => events.push('abort'));

    const { result } = await runner.run(state);

    expect(result.type).toBe('abort');
    expect(events).toContain('abort');
  });

  it('should emit compress events in runStream when compression is triggered', async () => {
    const mockResponse: LLMResponse = {
      content: 'Answer',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);

    // Create a mock compressor that implements IContextCompressor
    const mockCompressor: import('../../../src/types.js').IContextCompressor = {
      shouldCompress: vi.fn().mockReturnValue(true),
      compress: vi.fn().mockResolvedValue({
        summary: 'Test summary',
        anchor: 5,
      }),
    };

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      compressor: mockCompressor,
    });

    const state = createAgentState(defaultConfig);

    const events: string[] = [];
    runner.on('compressing', () => events.push('compressing'));
    runner.on('compressed', () => events.push('compressed'));

    for await (const _ of runner.runStream(state, { maxSteps: 1 })) {
      // consume stream
    }

    expect(events).toEqual(['compressing', 'compressed']);
  });

  it('should emit error event in runStream when error occurs', async () => {
    const errorClient = {
      call: vi.fn().mockRejectedValue(new Error('Stream Error')),
      stream: vi.fn().mockImplementation(async function* () {
        throw new Error('Stream Error');
      }),
    };

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: errorClient as unknown as LLMClient,
    });
    const state = createAgentState(defaultConfig);

    const errors: Array<{ message: string }> = [];
    runner.on('error', (e) => {
      errors.push({ message: e.error.message });
    });

    // runStream catches execution errors and returns error result (does not throw)
    let finalResult: { state: AgentState; result: { type: string; error?: Error } } | undefined;
    const iterator = runner.runStream(state, { maxSteps: 1 });
    while (true) {
      const { done, value } = await iterator.next();
      if (done) {
        finalResult = value as typeof finalResult;
        break;
      }
    }

    // Should return error result
    expect(finalResult).toBeDefined();
    expect(finalResult!.result.type).toBe('error');
    expect(finalResult!.result.error!.message).toBe('Stream Error');

    // Should have emitted error event
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]!.message).toBe('Stream Error');
  });

  it('should preserve content in assistant message when tool_calls are present', async () => {
    // LLM outputs explanatory text before tool_call — standard behavior, not misbehavior
    const responses: LLMResponse[] = [
      {
        content: 'Let me calculate that for you.',
        toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '3+3' } }],
        tokens: mockTokens,
        stopReason: 'tool_calls',
      },
      {
        content: 'The result is 6',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      },
    ];

    const client = createMockLLMClient(responses);
    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => safeEval(expression).toString(),
    });

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const { state: finalState } = await runner.run(state, undefined, registry);

    // Find the assistant message with tool_calls — content should be preserved
    const assistantMsgs = finalState.context.messages.filter((m) => m.role === 'assistant');
    expect(assistantMsgs.length).toBeGreaterThanOrEqual(1);

    const actionMsg = assistantMsgs.find((m) => m.type === 'action');
    expect(actionMsg).toBeDefined();
    expect(actionMsg!.content).toBe('Let me calculate that for you.');
    expect(actionMsg!.toolCalls).toHaveLength(1);
    expect(actionMsg!.toolCalls![0].name).toBe('calculate');
  });
});

// ============================================================
// Custom Execution Policy tests
// ============================================================
describe('Execution Policy injection', () => {
  it('should call custom policy.shouldStop() on each step', async () => {
    const mockResponse: LLMResponse = {
      content: 'Hello',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const shouldStopCalls: { stepCount: number; resultType: string }[] = [];

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      executionPolicy: {
        shouldStop: (_state, result, meta) => {
          shouldStopCalls.push({ stepCount: meta.stepCount, resultType: result.type });
          if (result.type === 'done') {
            return { decision: 'stop', reason: result.answer, runResultType: 'success' as const };
          }
          if (result.type === 'error') {
            return {
              decision: 'stop',
              reason: result.error.message,
              runResultType: 'error' as const,
            };
          }
          if (meta.stepCount >= meta.maxSteps) {
            return { decision: 'stop', reason: 'Max steps', runResultType: 'max_steps' as const };
          }
          return { decision: 'continue' };
        },
        onToolError: () => ({ decision: 'continue' as const, sanitizedResult: 'Error' }),
        onParseError: (error) => ({ decision: 'fail' as const, error }),
      },
    });

    const state = createAgentState(defaultConfig);
    const { result } = await runner.run(state);

    expect(result.type).toBe('success');
    expect(shouldStopCalls).toHaveLength(1);
    expect(shouldStopCalls[0]).toEqual({ stepCount: 1, resultType: 'done' });
  });

  it('should allow custom policy to override stop behavior', async () => {
    // LLM gives a direct answer, but custom policy treats it as max_steps
    const mockResponse: LLMResponse = {
      content: 'Direct answer',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      executionPolicy: {
        shouldStop: () => ({
          decision: 'stop',
          reason: 'Custom override',
          runResultType: 'max_steps',
        }),
        onToolError: () => ({ decision: 'continue', sanitizedResult: 'Error' }),
        onParseError: (error) => ({ decision: 'fail', error }),
      },
    });

    const state = createAgentState(defaultConfig);
    const { result } = await runner.run(state);

    // Policy overrides: even though LLM gave a direct answer, result is max_steps
    expect(result.type).toBe('max_steps');
  });

  it('should use DefaultExecutionPolicy when no policy is provided', async () => {
    const mockResponse: LLMResponse = {
      content: 'Answer',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const { result } = await runner.run(state);

    // Default policy: direct answer → success
    expect(result.type).toBe('success');
    if (result.type === 'success') {
      expect(result.answer).toBe('Answer');
    }
  });

  it('should expose RUN_HARD_LIMIT of 1000', () => {
    expect(RUN_HARD_LIMIT).toBe(1000);
  });

  it('should stop with max_steps when policy never stops and maxSteps is reached', async () => {
    const toolCallResponse: LLMResponse = {
      content: 'Thinking...',
      toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '1+1' } }],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };

    const responses = Array(10).fill(toolCallResponse);
    const client = createMockLLMClient(responses);

    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => safeEval(expression).toString(),
    });

    // Policy that never stops (always continues)
    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      runHardLimit: 5,
      executionPolicy: {
        shouldStop: () => ({ decision: 'continue' }),
        onToolError: () => ({ decision: 'continue', sanitizedResult: 'Error' }),
        onParseError: (error) => ({ decision: 'fail', error }),
      },
    });

    const state = createAgentState(defaultConfig);
    const { result } = await runner.run(state, undefined, registry);

    expect(result.type).toBe('max_steps');
    if (result.type === 'max_steps') {
      expect(result.totalSteps).toBe(5);
    }
  });

  it('should fallback to max_steps when policy returns unknown runResultType in run()', async () => {
    const mockResponse: LLMResponse = {
      content: 'Answer',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      executionPolicy: {
        shouldStop: () => ({
          decision: 'stop',
          reason: 'Unknown type',
          runResultType:
            'unknown_type' as unknown as import('../../../src/policy/types.js').RunResultType,
        }),
        onToolError: () => ({ decision: 'continue', sanitizedResult: 'Error' }),
        onParseError: (error) => ({ decision: 'fail', error }),
      },
    });

    const state = createAgentState(defaultConfig);
    const { result } = await runner.run(state);

    expect(result.type).toBe('max_steps');
  });

  it('should fallback to max_steps when policy returns unknown runResultType in runStream()', async () => {
    const mockResponse: LLMResponse = {
      content: 'Answer',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      executionPolicy: {
        shouldStop: () => ({
          decision: 'stop',
          reason: 'Unknown type',
          runResultType:
            'unknown_type' as unknown as import('../../../src/policy/types.js').RunResultType,
        }),
        onToolError: () => ({ decision: 'continue', sanitizedResult: 'Error' }),
        onParseError: (error) => ({ decision: 'fail', error }),
      },
    });

    const state = createAgentState(defaultConfig);
    const gen = runner.runStream(state);
    let lastReturn: { result: { type: string } } | undefined;

    while (true) {
      const { done, value } = await gen.next();
      if (done) {
        lastReturn = value as { result: { type: string } };
        break;
      }
    }

    expect(lastReturn!.result.type).toBe('max_steps');
  });
});

describe('Thinking mechanism', () => {
  it('should save native thinking as thought message in blocking mode', async () => {
    const mockResponse: LLMResponse = {
      content: 'The answer is 42.',
      thinking: 'Let me reason through this.',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const { state: finalState } = await runner.run(state);

    const messages = finalState.context.messages;
    const thoughtMsg = messages.find((m) => m.type === 'thought');
    const textMsg = messages.find((m) => m.type === 'text');

    expect(thoughtMsg!.content).toBe('Let me reason through this.');
    expect(textMsg!.content).toBe('The answer is 42.');
  });

  it('should extract <think> tag and clean content in blocking mode', async () => {
    const mockResponse: LLMResponse = {
      content: '<think>I need to calculate this.</think>The answer is 42.',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const { state: finalState } = await runner.run(state);

    const messages = finalState.context.messages;
    const thoughtMsg = messages.find((m) => m.type === 'thought');
    const textMsg = messages.find((m) => m.type === 'text');

    expect(thoughtMsg!.content).toBe('I need to calculate this.');
    expect(textMsg!.content).toBe('The answer is 42.');
  });

  it('should save native thinking with action in blocking mode', async () => {
    const toolCallResponse: LLMResponse = {
      content: 'Let me search.',
      thinking: 'The user wants weather info.',
      toolCalls: [{ id: 'call-1', name: 'search', arguments: { query: 'weather' } }],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };

    const finalResponse: LLMResponse = {
      content: 'It is sunny.',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([toolCallResponse, finalResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });

    const registry = new ToolRegistry();
    registry.register({
      name: 'search',
      description: 'Search',
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }) => `Results for ${query}`,
    });

    const state = createAgentState(defaultConfig);
    const { state: finalState } = await runner.run(state, undefined, registry);

    const messages = finalState.context.messages;
    const thoughtMsgs = messages.filter((m) => m.type === 'thought');

    expect(thoughtMsgs.length).toBe(1);
    expect(thoughtMsgs[0].content).toBe('The user wants weather info.');
  });

  it('should NOT create thought message when no thinking exists', async () => {
    const mockResponse: LLMResponse = {
      content: 'The answer is 42.',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const { state: finalState } = await runner.run(state);

    const messages = finalState.context.messages;
    const thoughtMsg = messages.find((m) => m.type === 'thought');

    expect(thoughtMsg).toBeUndefined();
  });

  it('should yield thinking events in stream mode', async () => {
    const mockResponse: LLMResponse = {
      content: 'The answer is 42.',
      thinking: 'Let me think about this.',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const events: Array<{ type: string; content?: string }> = [];
    for await (const event of runner.runStream(state)) {
      if (event.type === 'thinking') {
        events.push({ type: 'thinking', content: event.content });
      }
    }

    // Should have yielded thinking events
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe('thinking');
  });

  it('should save thinking from stream via stepStream', async () => {
    const mockResponse: LLMResponse = {
      content: 'The answer is 42.',
      thinking: 'Let me think about this.',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    // Consume all events from stepStream
    const iterator = runner.stepStream(state);
    let result = await iterator.next();
    while (!result.done) {
      result = await iterator.next();
    }

    const finalState = result.value.state;
    const messages = finalState.context.messages;
    const thoughtMsg = messages.find((m) => m.type === 'thought');
    const textMsg = messages.find((m) => m.type === 'text');

    expect(thoughtMsg!.content).toBe('Let me think about this.');
    expect(textMsg!.content).toBe('The answer is 42.');
  });

  it('should handle <think> tag with action in blocking mode', async () => {
    const toolCallResponse: LLMResponse = {
      content: '<think>I need to search.</think>',
      toolCalls: [{ id: 'call-1', name: 'search', arguments: { query: 'weather' } }],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };

    const finalResponse: LLMResponse = {
      content: 'It is sunny.',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([toolCallResponse, finalResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });

    const registry = new ToolRegistry();
    registry.register({
      name: 'search',
      description: 'Search',
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }) => `Results for ${query}`,
    });

    const state = createAgentState(defaultConfig);
    const { state: finalState } = await runner.run(state, undefined, registry);

    const messages = finalState.context.messages;
    const thoughtMsgs = messages.filter((m) => m.type === 'thought');
    const actionMsgs = messages.filter((m) => m.type === 'action');

    expect(thoughtMsgs.length).toBe(1);
    expect(thoughtMsgs[0].content).toBe('I need to search.');
    expect(actionMsgs.length).toBe(1);
    expect(actionMsgs[0].content).toBe('');
  });

  it('should return custom result when beforeRun middleware stops with result', async () => {
    const mockResponse: LLMResponse = {
      content: 'Hello',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      middleware: [
        {
          name: 'test-beforeRun-stop',
          async beforeRun() {
            return {
              stop: true,
              result: {
                type: 'success',
                answer: 'Custom result',
                totalSteps: 0,
                tokens: { input: 0, output: 0 },
              },
            };
          },
        },
      ],
    });

    const state = createAgentState(defaultConfig);
    const { result } = await runner.run(state);

    expect(result.type).toBe('success');
    if (result.type === 'success') {
      expect(result.answer).toBe('Custom result');
    }
  });

  it('should return custom result when beforeRun middleware stops runStream with result', async () => {
    const mockResponse: LLMResponse = {
      content: 'Hello',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      middleware: [
        {
          name: 'test-beforeRun-stop-stream',
          async beforeRun() {
            return {
              stop: true,
              result: {
                type: 'success',
                answer: 'Stream custom',
                totalSteps: 0,
                tokens: { input: 0, output: 0 },
              },
            };
          },
        },
      ],
    });

    const state = createAgentState(defaultConfig);
    const gen = runner.runStream(state);
    const { done, value } = await gen.next();

    expect(done).toBe(true);
    expect(value.result.type).toBe('success');
    if (value.result.type === 'success') {
      expect(value.result.answer).toBe('Stream custom');
    }
  });

  it('should propagate error when beforeRun throws in run()', async () => {
    const mockResponse: LLMResponse = {
      content: 'Hello',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      middleware: [
        {
          name: 'test-throw-run',
          async beforeRun() {
            throw new Error('beforeRun run error');
          },
        },
      ],
    });

    const state = createAgentState(defaultConfig);
    await expect(runner.run(state)).rejects.toThrow('beforeRun run error');
  });

  it('should propagate non-Error throw from beforeRun in run()', async () => {
    const mockResponse: LLMResponse = {
      content: 'Hello',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      middleware: [
        {
          name: 'test-throw-string',
          async beforeRun() {
            throw 'string error';
          },
        },
      ],
    });

    const state = createAgentState(defaultConfig);
    await expect(runner.run(state)).rejects.toThrow('string error');
  });

  it('should stop runStream with max_steps when policy never stops and maxSteps is reached', async () => {
    const mockResponse: LLMResponse = {
      content: 'Continue',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const responses = Array(10).fill(mockResponse);
    const client = createMockLLMClient(responses, { split: 'all' });

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      runHardLimit: 5,
      executionPolicy: {
        shouldStop: () => ({ decision: 'continue' }),
        onToolError: () => ({ decision: 'continue', sanitizedResult: 'Error' }),
        onParseError: (error) => ({ decision: 'fail', error }),
      },
    });

    const state = createAgentState(defaultConfig);
    let lastReturn: { result: { type: string; totalSteps?: number } } | undefined;

    const gen = runner.runStream(state);
    while (true) {
      const { done, value } = await gen.next();
      if (done) {
        lastReturn = value as { result: { type: string; totalSteps?: number } };
        break;
      }
    }

    expect(lastReturn!.result.type).toBe('max_steps');
    if (lastReturn!.result.type === 'max_steps') {
      expect(lastReturn!.result.totalSteps).toBe(5);
    }
  });
});
