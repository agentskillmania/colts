/**
 * Step-level blocking vs streaming equivalence tests.
 *
 * These tests verify that for the same mock LLM input, `step()` (blocking)
 * and `stepStream()` (streaming) produce equivalent final state and StepResult.
 *
 * This is the regression safety net for the StepRunner unification refactor.
 */

import { describe, it, expect, vi } from 'vitest';
import type { LLMClient, LLMResponse } from '@agentskillmania/llm-client';
import { AgentRunner } from '../../../src/runner/index.js';
import { createAgentState } from '../../../src/state/index.js';
import type { AgentConfig, AgentState } from '../../../src/types.js';
import { ToolRegistry } from '../../../src/tools/registry.js';
import { z } from 'zod';
import { createMockLLMClient as _createMockLLMClient } from '../../helpers/mock-llm.js';
import { safeEval } from '../helpers/safe-eval.js';

// --- Helpers (copied from path-equivalence.test.ts) ---

const createMockLLMClient = (responses: LLMResponse[]) =>
  _createMockLLMClient(responses, { enableThinking: true });
const defaultConfig: AgentConfig = {
  name: 'test-agent',
  instructions: 'You are a helpful assistant.',
  tools: [],
};

const mockTokens = { input: 10, output: 5 };

/**
 * Recursively delete all `timestamp` and `id` fields from an object.
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
 * Strip fields/events that are expected to differ between blocking and streaming
 * at the step level:
 * - `timestamp` (always different, recursively removed)
 * - `token` events (streaming-only)
 * - `thinking` events (streaming-only)
 * - `llm:request` / `llm:response` events (streaming-only)
 * - `state` field in step:start (streaming carries state snapshot)
 */
function normalizeStepEvents(
  events: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  return events
    .filter(
      (e) =>
        e.type !== 'token' &&
        e.type !== 'thinking' &&
        e.type !== 'llm:request' &&
        e.type !== 'llm:response'
    )
    .map((e) => {
      const copy = { ...e };
      delete copy.state;
      return stripVolatile(copy) as Record<string, unknown>;
    });
}

async function runStepBlocking(
  responses: LLMResponse[],
  registry?: ToolRegistry
): Promise<{
  state: AgentState;
  result: Record<string, unknown>;
  events: Array<Record<string, unknown>>;
}> {
  const client = createMockLLMClient(responses);
  const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
  const state = createAgentState(defaultConfig);

  const events: Array<Record<string, unknown>> = [];

  const eventTypes = [
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

  const { state: finalState, result } = await runner.step(state, registry);
  return { state: finalState, result: result as Record<string, unknown>, events };
}

async function runStepStreaming(
  responses: LLMResponse[],
  registry?: ToolRegistry
): Promise<{
  state: AgentState;
  result: Record<string, unknown>;
  events: Array<Record<string, unknown>>;
}> {
  const client = createMockLLMClient(responses);
  const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
  const state = createAgentState(defaultConfig);

  const streamEvents: Array<Record<string, unknown>> = [];
  const iterator = runner.stepStream(state, registry);

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
    throw new Error('stepStream did not return a final result');
  }

  return { state: finalResult.state, result: finalResult.result, events: streamEvents };
}

// --- Scenarios ---

describe('step() vs stepStream() equivalence', () => {
  it('Scenario A: direct answer (no tool call)', async () => {
    const responses: LLMResponse[] = [
      {
        content: 'The answer is 42',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      },
    ];

    const blocking = await runStepBlocking(responses);
    const streaming = await runStepStreaming(responses);

    // Final state equivalence
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

    // StepResult equivalence
    expect(streaming.result.type).toBe(blocking.result.type);
    expect(streaming.result).toEqual(blocking.result);

    // Event sequence equivalence (ignoring streaming-only events)
    const blockingNorm = normalizeStepEvents(blocking.events);
    const streamingNorm = normalizeStepEvents(streaming.events);
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
    ];

    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => safeEval(expression).toString(),
    });

    const blocking = await runStepBlocking(responses, registry);
    const streaming = await runStepStreaming(responses, registry);

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

    expect(streaming.result.type).toBe(blocking.result.type);
    expect(streaming.result).toEqual(blocking.result);

    const blockingNorm = normalizeStepEvents(blocking.events);
    const streamingNorm = normalizeStepEvents(streaming.events);
    expect(streamingNorm).toEqual(blockingNorm);
  });

  it('Scenario C: tool call then LLM answer', async () => {
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

    const blocking = await runStepBlocking(responses, registry);
    const streaming = await runStepStreaming(responses, registry);

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

    expect(streaming.result.type).toBe(blocking.result.type);
    expect(streaming.result).toEqual(blocking.result);

    const blockingNorm = normalizeStepEvents(blocking.events);
    const streamingNorm = normalizeStepEvents(streaming.events);
    expect(streamingNorm).toEqual(blockingNorm);
  });
});
