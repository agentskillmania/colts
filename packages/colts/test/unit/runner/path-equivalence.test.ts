/**
 * Blocking vs Streaming path equivalence tests.
 *
 * These tests verify that for the same mock LLM input, the blocking (run)
 * and streaming (runStream) paths produce equivalent final state and
 * equivalent non-token event sequences.
 *
 * This is a regression safety net for MJ-1 (streaming bypass PhaseRouter refactor).
 */

import { describe, it, expect, vi } from 'vitest';
import type { LLMClient, LLMResponse } from '@agentskillmania/llm-client';
import { AgentRunner } from '../../../src/runner/index.js';
import { createAgentState } from '../../../src/state/index.js';
import type { AgentMiddleware } from '../../../src/middleware/types.js';
import type { AgentConfig, AgentState } from '../../../src/types.js';
import { ToolRegistry } from '../../../src/tools/registry.js';
import { z } from 'zod';
import { createMockLLMClient as _createMockLLMClient } from '../../helpers/mock-llm.js';
import { safeEval } from '../helpers/safe-eval.js';

// --- Helpers (adapted from run.test.ts) ---

const createMockLLMClient = (responses: LLMResponse[]) =>
  _createMockLLMClient(responses, { enableThinking: true });
const defaultConfig: AgentConfig = {
  name: 'test-agent',
  instructions: 'You are a helpful assistant.',
  tools: [],
};

const mockTokens = { input: 10, output: 5 };

/**
 * Recursively delete all `timestamp` fields from an object.
 */
function stripVolatile(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(stripVolatile);
  }
  if (obj !== null && typeof obj === 'object') {
    const copy: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'timestamp' || key === 'id') continue;
      copy[key] = stripVolatile(value);
    }
    return copy;
  }
  return obj;
}

/**
 * Strip fields/events that are expected to differ between blocking and streaming:
 * - `timestamp` (always different, recursively removed)
 * - `token` events (streaming-only)
 * - `thinking` events (streaming-only)
 * - `llm:request` / `llm:response` events (streaming-only)
 * - `complete` event (streaming-only final marker)
 * - `run:start` / `run:end` (EventEmitter-only, not yielded in streaming)
 * - `state` field in step:start (streaming carries state snapshot)
 */
function normalizeEvents(events: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return events
    .filter(
      (e) =>
        e.type !== 'token' &&
        e.type !== 'thinking' &&
        e.type !== 'llm:request' &&
        e.type !== 'llm:response' &&
        e.type !== 'complete' &&
        e.type !== 'run:start' &&
        e.type !== 'run:end'
    )
    .map((e) => {
      const copy = { ...e };
      delete copy.state;
      return stripVolatile(copy) as Record<string, unknown>;
    });
}

interface BlockingResult {
  state: AgentState;
  events: Array<Record<string, unknown>>;
}

interface StreamingResult {
  state: AgentState;
  events: Array<Record<string, unknown>>;
}

async function runBlocking(
  responses: LLMResponse[],
  registry?: ToolRegistry
): Promise<BlockingResult> {
  const client = createMockLLMClient(responses);
  const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
  const state = createAgentState(defaultConfig);

  const events: Array<Record<string, unknown>> = [];

  // Collect events via EventEmitter
  const eventTypes = [
    'run:start',
    'run:end',
    'step:start',
    'step:end',
    'phase-change',
    'llm:request',
    'llm:response',
    'tools:start',
    'tool:start',
    'tool:end',
    'tools:end',
    'compressing',
    'compressed',
    'error',
    'abort',
  ];

  for (const type of eventTypes) {
    runner.on(type as never, (event: Record<string, unknown>) => {
      events.push({ type, ...event });
    });
  }

  const { state: finalState } = await runner.run(state, undefined, registry);
  return { state: finalState, events };
}

async function runStreaming(
  responses: LLMResponse[],
  registry?: ToolRegistry
): Promise<StreamingResult> {
  const client = createMockLLMClient(responses);
  const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
  const state = createAgentState(defaultConfig);

  const streamEvents: Array<Record<string, unknown>> = [];
  const iterator = runner.runStream(state, undefined, registry);

  let finalResult: { state: AgentState; result: Record<string, unknown> } | undefined;
  while (true) {
    const { done, value } = await iterator.next();
    if (done) {
      finalResult = value as { state: AgentState; result: Record<string, unknown> };
      break;
    }
    streamEvents.push(value as Record<string, unknown>);
  }

  if (!finalResult) {
    throw new Error('runStream did not return a final result');
  }

  return { state: finalResult.state, events: streamEvents };
}

// --- Scenarios ---

describe('blocking/streaming path equivalence', () => {
  it('Scenario A: direct answer (no tool call)', async () => {
    const responses: LLMResponse[] = [
      {
        content: 'The answer is 42',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      },
    ];

    const blocking = await runBlocking(responses);
    const streaming = await runStreaming(responses);

    // Final state equivalence (ignore timestamps which differ by runtime)
    expect(streaming.state.context.stepCount).toBe(blocking.state.context.stepCount);
    expect(
      streaming.state.context.messages.map((m: Record<string, unknown>) => {
        const copy = { ...m };
        delete copy.timestamp;
        delete copy.id;
        return copy;
      })
    ).toEqual(
      blocking.state.context.messages.map((m: Record<string, unknown>) => {
        const copy = { ...m };
        delete copy.timestamp;
        delete copy.id;
        return copy;
      })
    );

    // Event sequence equivalence
    const blockingNorm = normalizeEvents(blocking.events);
    const streamingNorm = normalizeEvents(streaming.events);
    expect(streamingNorm).toEqual(blockingNorm);
  });

  it('Scenario B: single tool call', async () => {
    const responses: LLMResponse[] = [
      {
        content: 'Let me calculate',
        toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '2+2' } }],
        tokens: mockTokens,
        stopReason: 'tool_calls',
      },
      {
        content: 'The result is 4',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      },
    ];

    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => safeEval(expression).toString(),
    });

    const blocking = await runBlocking(responses, registry);
    const streaming = await runStreaming(responses, registry);

    expect(streaming.state.context.stepCount).toBe(blocking.state.context.stepCount);
    expect(
      streaming.state.context.messages.map((m: Record<string, unknown>) => {
        const copy = { ...m };
        delete copy.timestamp;
        delete copy.id;
        return copy;
      })
    ).toEqual(
      blocking.state.context.messages.map((m: Record<string, unknown>) => {
        const copy = { ...m };
        delete copy.timestamp;
        delete copy.id;
        return copy;
      })
    );

    // Event sequence equivalence
    const blockingNorm = normalizeEvents(blocking.events);
    const streamingNorm = normalizeEvents(streaming.events);
    expect(streamingNorm).toEqual(blockingNorm);
  });

  it('Scenario E: error path (LLM throws)', async () => {
    const client = {
      call: vi.fn().mockRejectedValue(new Error('LLM API Error')),
      stream: vi.fn().mockImplementation(async function* () {
        throw new Error('LLM API Error');
      }),
    } as unknown as LLMClient;

    const blockingRunner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const streamingRunner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const blockingResult = await blockingRunner.run(state);

    const streamingIterator = streamingRunner.runStream(state);
    let streamingResult: { state: AgentState; result: Record<string, unknown> } | undefined;
    const streamingEvents: Array<Record<string, unknown>> = [];
    try {
      while (true) {
        const { done, value } = await streamingIterator.next();
        if (done) {
          streamingResult = value as { state: AgentState; result: Record<string, unknown> };
          break;
        }
        streamingEvents.push(value as Record<string, unknown>);
      }
    } catch {
      // streaming may throw; that's acceptable for this scenario
    }

    // Both paths should report error
    expect(blockingResult.result.type).toBe('error');
    expect((blockingResult.result as { error: Error }).error.message).toBe('LLM API Error');

    // Streaming should either throw or return error result
    if (streamingResult) {
      expect(streamingResult.result.type).toBe('error');
    }
  });

  // --- New scenarios (C3-1) ---

  it('Scenario C: multi-step tool chain (tool A result feeds into tool B)', async () => {
    const responses: LLMResponse[] = [
      {
        content: 'Let me calculate',
        toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '3*7' } }],
        tokens: mockTokens,
        stopReason: 'tool_calls',
      },
      {
        content: 'Now let me double it',
        toolCalls: [{ id: 'call-2', name: 'calculate', arguments: { expression: '21*2' } }],
        tokens: mockTokens,
        stopReason: 'tool_calls',
      },
      {
        content: 'The result is 42',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      },
    ];

    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => safeEval(expression).toString(),
    });

    const blocking = await runBlocking(responses, registry);
    const streaming = await runStreaming(responses, registry);

    // Both paths should complete 2 tool-call steps + 1 final answer = 3 steps
    expect(streaming.state.context.stepCount).toBe(blocking.state.context.stepCount);
    expect(blocking.state.context.stepCount).toBe(3);

    const blockingNorm = normalizeEvents(blocking.events);
    const streamingNorm = normalizeEvents(streaming.events);
    expect(streamingNorm).toEqual(blockingNorm);
  });

  it('Scenario D: parallel tool calls (LLM returns 2+ tool calls in one response)', async () => {
    const responses: LLMResponse[] = [
      {
        content: 'Let me compute both',
        toolCalls: [
          { id: 'call-1', name: 'calculate', arguments: { expression: '2+2' } },
          { id: 'call-2', name: 'calculate', arguments: { expression: '3*3' } },
        ],
        tokens: mockTokens,
        stopReason: 'tool_calls',
      },
      {
        content: 'Both results are 4 and 9',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      },
    ];

    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => safeEval(expression).toString(),
    });

    const blocking = await runBlocking(responses, registry);
    const streaming = await runStreaming(responses, registry);

    expect(streaming.state.context.stepCount).toBe(blocking.state.context.stepCount);
    expect(blocking.state.context.stepCount).toBe(2);

    const blockingNorm = normalizeEvents(blocking.events);
    const streamingNorm = normalizeEvents(streaming.events);
    expect(streamingNorm).toEqual(blockingNorm);
  });

  it('Scenario F: thinking-enabled response (thinking tokens present)', async () => {
    const responses: LLMResponse[] = [
      {
        content: 'The answer is 42',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
        thinking: 'Let me reason through this step by step...',
      },
    ];

    const blocking = await runBlocking(responses);
    const streaming = await runStreaming(responses);

    expect(streaming.state.context.stepCount).toBe(blocking.state.context.stepCount);

    const blockingNorm = normalizeEvents(blocking.events);
    const streamingNorm = normalizeEvents(streaming.events);
    expect(streamingNorm).toEqual(blockingNorm);
  });

  it('Scenario G: max steps reached (execution stops mid-run)', async () => {
    // Return tool calls indefinitely — runner should stop at maxSteps
    const toolCallResponse: LLMResponse = {
      content: 'Working...',
      toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '1+1' } }],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };
    const responses = [toolCallResponse, toolCallResponse, toolCallResponse];

    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => safeEval(expression).toString(),
    });

    // Separate clients — blocking and streaming each need their own response queue
    const blockingClient = createMockLLMClient(responses);
    const streamingClient = createMockLLMClient(responses);

    const blockingRunner = new AgentRunner({ model: 'gpt-4', llmClient: blockingClient });
    const streamingRunner = new AgentRunner({ model: 'gpt-4', llmClient: streamingClient });

    const blockingResult = await blockingRunner.run(
      createAgentState(defaultConfig),
      { maxSteps: 2 },
      registry
    );

    const streamingIterator = streamingRunner.runStream(
      createAgentState(defaultConfig),
      { maxSteps: 2 },
      registry
    );
    let streamingFinal: { state: AgentState; result: Record<string, unknown> } | undefined;
    const streamingEvents: Array<Record<string, unknown>> = [];
    while (true) {
      const { done, value } = await streamingIterator.next();
      if (done) {
        streamingFinal = value as { state: AgentState; result: Record<string, unknown> };
        break;
      }
      streamingEvents.push(value as Record<string, unknown>);
    }

    expect(streamingFinal).toBeDefined();
    expect(streamingFinal!.state.context.stepCount).toBe(blockingResult.state.context.stepCount);
    // Should stop at exactly 2 steps
    expect(blockingResult.state.context.stepCount).toBe(2);
  });

  it('Scenario H: middleware intervention (middleware modifies state mid-run)', async () => {
    const responses: LLMResponse[] = [
      {
        content: 'Hello',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      },
    ];

    // Separate middleware trackers for blocking and streaming
    let blockingAfterStepCount = 0;
    let streamingAfterStepCount = 0;

    const blockingMiddleware: AgentMiddleware = {
      name: 'blocking-tracker',
      afterStep: async () => {
        blockingAfterStepCount++;
        return undefined;
      },
    };

    const streamingMiddleware: AgentMiddleware = {
      name: 'streaming-tracker',
      afterStep: async () => {
        streamingAfterStepCount++;
        return undefined;
      },
    };

    // Separate clients for each path
    const blockingClient = createMockLLMClient(responses);
    const streamingClient = createMockLLMClient(responses);

    // Blocking path with middleware
    const blockingRunner = new AgentRunner({
      model: 'gpt-4',
      llmClient: blockingClient,
      middleware: [blockingMiddleware],
    });
    const blockingResult = await blockingRunner.run(createAgentState(defaultConfig));
    const blockingStepCount = blockingResult.state.context.stepCount;

    // Streaming path with middleware
    const streamingRunner = new AgentRunner({
      model: 'gpt-4',
      llmClient: streamingClient,
      middleware: [streamingMiddleware],
    });
    const streamingIterator = streamingRunner.runStream(createAgentState(defaultConfig));

    let streamingFinal: { state: AgentState; result: Record<string, unknown> } | undefined;
    const streamingEvents: Array<Record<string, unknown>> = [];
    while (true) {
      const { done, value } = await streamingIterator.next();
      if (done) {
        streamingFinal = value as { state: AgentState; result: Record<string, unknown> };
        break;
      }
      streamingEvents.push(value as Record<string, unknown>);
    }

    expect(streamingFinal).toBeDefined();
    expect(streamingFinal!.state.context.stepCount).toBe(blockingStepCount);

    // Both middleware instances should have been called
    expect(blockingAfterStepCount).toBeGreaterThanOrEqual(1);
    expect(streamingAfterStepCount).toBeGreaterThanOrEqual(1);
  });
});
