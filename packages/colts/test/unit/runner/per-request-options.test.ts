/**
 * @fileoverview Tests for PerRequestOptions pass-through: thinkingEnabled and model
 * should flow from run/step/runStream/stepStream → advance → CallingLLMHandler → LLM call.
 */

import { describe, it, expect, vi } from 'vitest';
import type { LLMResponse } from '@agentskillmania/llm-client';

import { AgentRunner } from '../../../src/runner/index.js';
import { createAgentState } from '../../../src/state/index.js';
import type { RunOptions, StepOptions } from '../../../src/runner/options.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockTokens = { input: 10, output: 5 };

/**
 * Create a mock LLM client that records both call() and stream() arguments.
 * Returns the client and getters to inspect captured calls.
 */
function createCapturingClient(responses: LLMResponse[]) {
  const callArgs: Array<Record<string, unknown>> = [];
  const streamArgs: Array<Record<string, unknown>> = [];
  let callIndex = 0;
  let streamIndex = 0;

  const client = {
    call: vi.fn().mockImplementation((opts: Record<string, unknown>) => {
      callArgs.push(opts);
      if (callIndex >= responses.length) {
        throw new Error(`No more mock responses (index ${callIndex})`);
      }
      return Promise.resolve(responses[callIndex++]);
    }),
    stream: vi.fn().mockImplementation(async function* (opts: Record<string, unknown>) {
      streamArgs.push(opts);
      if (streamIndex >= responses.length) {
        throw new Error('No more mock responses for stream');
      }
      const response = responses[streamIndex++];
      yield {
        type: 'text' as const,
        delta: response.content,
        accumulatedContent: response.content,
      };
      yield { type: 'done' as const, roundTotalTokens: response.tokens };
    }),
  };

  return {
    client: client as unknown as import('@agentskillmania/llm-client').LLMClient,
    getLastCallArg: () => callArgs[callArgs.length - 1],
    getLastStreamArg: () => streamArgs[streamArgs.length - 1],
  };
}

// ---------------------------------------------------------------------------
// run()
// ---------------------------------------------------------------------------

describe('PerRequestOptions — run()', () => {
  it('should pass thinkingEnabled from RunOptions to LLM call', async () => {
    const mockResponse: LLMResponse = {
      content: 'ok',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };
    const { client, getLastCallArg } = createCapturingClient([mockResponse]);

    const runner = new AgentRunner({
      model: 'default-model',
      llmClient: client,
      thinkingEnabled: false,
    });

    const state = createAgentState({
      name: 'test',
      instructions: 'You are a test assistant.',
      tools: [],
    });

    const opts: RunOptions = { thinkingEnabled: true, maxSteps: 1 };
    await runner.run(state, opts);

    const lastCall = getLastCallArg();
    expect(lastCall).toBeDefined();
    expect(lastCall!.thinkingEnabled).toBe(true);
    expect(lastCall!.model).toBe('default-model');
  });

  it('should pass model override from RunOptions to LLM call', async () => {
    const mockResponse: LLMResponse = {
      content: 'ok',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };
    const { client, getLastCallArg } = createCapturingClient([mockResponse]);

    const runner = new AgentRunner({
      model: 'default-model',
      llmClient: client,
    });

    const state = createAgentState({
      name: 'test',
      instructions: 'You are a test assistant.',
      tools: [],
    });

    const opts: RunOptions = { model: 'override-model', maxSteps: 1 };
    await runner.run(state, opts);

    const lastCall = getLastCallArg();
    expect(lastCall).toBeDefined();
    expect(lastCall!.model).toBe('override-model');
  });

  it('should fallback to runner default model when per-request model is undefined', async () => {
    const mockResponse: LLMResponse = {
      content: 'ok',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };
    const { client, getLastCallArg } = createCapturingClient([mockResponse]);

    const runner = new AgentRunner({
      model: 'runner-default',
      llmClient: client,
    });

    const state = createAgentState({
      name: 'test',
      instructions: 'You are a test assistant.',
      tools: [],
    });

    // No model override in options
    const opts: RunOptions = { maxSteps: 1 };
    await runner.run(state, opts);

    const lastCall = getLastCallArg();
    expect(lastCall).toBeDefined();
    expect(lastCall!.model).toBe('runner-default');
  });

  it('should fallback to runner default thinkingEnabled when per-request is undefined', async () => {
    const mockResponse: LLMResponse = {
      content: 'ok',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };
    const { client, getLastCallArg } = createCapturingClient([mockResponse]);

    const runner = new AgentRunner({
      model: 'test-model',
      llmClient: client,
      thinkingEnabled: true,
    });

    const state = createAgentState({
      name: 'test',
      instructions: 'You are a test assistant.',
      tools: [],
    });

    // No thinkingEnabled override — should use runner default (true)
    const opts: RunOptions = { maxSteps: 1 };
    await runner.run(state, opts);

    const lastCall = getLastCallArg();
    expect(lastCall).toBeDefined();
    expect(lastCall!.thinkingEnabled).toBe(true);
  });

  it('should override both model and thinkingEnabled simultaneously', async () => {
    const mockResponse: LLMResponse = {
      content: 'ok',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };
    const { client, getLastCallArg } = createCapturingClient([mockResponse]);

    const runner = new AgentRunner({
      model: 'default-model',
      llmClient: client,
      thinkingEnabled: false,
    });

    const state = createAgentState({
      name: 'test',
      instructions: 'You are a test assistant.',
      tools: [],
    });

    const opts: RunOptions = {
      model: 'new-model',
      thinkingEnabled: true,
      maxSteps: 1,
    };
    await runner.run(state, opts);

    const lastCall = getLastCallArg();
    expect(lastCall).toBeDefined();
    expect(lastCall!.model).toBe('new-model');
    expect(lastCall!.thinkingEnabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runStream()
// ---------------------------------------------------------------------------

describe('PerRequestOptions — runStream()', () => {
  it('should pass thinkingEnabled and model from RunOptions to LLM stream call', async () => {
    const mockResponse: LLMResponse = {
      content: 'streamed answer',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };
    const { client, getLastStreamArg } = createCapturingClient([mockResponse]);

    const runner = new AgentRunner({
      model: 'default-model',
      llmClient: client,
      thinkingEnabled: false,
    });

    const state = createAgentState({
      name: 'test',
      instructions: 'You are a test assistant.',
      tools: [],
    });

    const opts: RunOptions = {
      thinkingEnabled: true,
      model: 'stream-override-model',
      maxSteps: 1,
    };

    // Drain the stream
    for await (const _event of runner.runStream(state, opts)) {
      // consume
    }

    const lastStream = getLastStreamArg();
    expect(lastStream).toBeDefined();
    expect(lastStream!.thinkingEnabled).toBe(true);
    expect(lastStream!.model).toBe('stream-override-model');
  });
});

// ---------------------------------------------------------------------------
// step()
// ---------------------------------------------------------------------------

describe('PerRequestOptions — step()', () => {
  it('should pass thinkingEnabled from StepOptions to LLM call', async () => {
    const mockResponse: LLMResponse = {
      content: 'step answer',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };
    const { client, getLastCallArg } = createCapturingClient([mockResponse]);

    const runner = new AgentRunner({
      model: 'test-model',
      llmClient: client,
      thinkingEnabled: false,
    });

    const state = createAgentState({
      name: 'test',
      instructions: 'You are a test assistant.',
      tools: [],
    });

    const stepOpts: StepOptions = { thinkingEnabled: true };
    await runner.step(state, undefined, stepOpts);

    const lastCall = getLastCallArg();
    expect(lastCall).toBeDefined();
    expect(lastCall!.thinkingEnabled).toBe(true);
  });

  it('should pass model override from StepOptions to LLM call', async () => {
    const mockResponse: LLMResponse = {
      content: 'step answer',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };
    const { client, getLastCallArg } = createCapturingClient([mockResponse]);

    const runner = new AgentRunner({
      model: 'default-model',
      llmClient: client,
    });

    const state = createAgentState({
      name: 'test',
      instructions: 'You are a test assistant.',
      tools: [],
    });

    const stepOpts: StepOptions = { model: 'step-override-model' };
    await runner.step(state, undefined, stepOpts);

    const lastCall = getLastCallArg();
    expect(lastCall).toBeDefined();
    expect(lastCall!.model).toBe('step-override-model');
  });
});

// ---------------------------------------------------------------------------
// stepStream()
// ---------------------------------------------------------------------------

describe('PerRequestOptions — stepStream()', () => {
  it('should pass model override from StepOptions to LLM stream call', async () => {
    const mockResponse: LLMResponse = {
      content: 'streamed step answer',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };
    const { client, getLastStreamArg } = createCapturingClient([mockResponse]);

    const runner = new AgentRunner({
      model: 'default-model',
      llmClient: client,
    });

    const state = createAgentState({
      name: 'test',
      instructions: 'You are a test assistant.',
      tools: [],
    });

    const stepOpts: StepOptions = { model: 'step-stream-model' };

    // Drain the stream
    for await (const _event of runner.stepStream(state, undefined, stepOpts)) {
      // consume
    }

    const lastStream = getLastStreamArg();
    expect(lastStream).toBeDefined();
    expect(lastStream!.model).toBe('step-stream-model');
  });
});

// ---------------------------------------------------------------------------
// Negative paths
// ---------------------------------------------------------------------------

describe('PerRequestOptions — negative paths', () => {
  it('should use runner default when empty RunOptions is passed', async () => {
    const mockResponse: LLMResponse = {
      content: 'ok',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };
    const { client, getLastCallArg } = createCapturingClient([mockResponse]);

    const runner = new AgentRunner({
      model: 'runner-model',
      llmClient: client,
      thinkingEnabled: true,
    });

    const state = createAgentState({
      name: 'test',
      instructions: 'You are a test assistant.',
      tools: [],
    });

    // Empty options object — all fields undefined
    const opts: RunOptions = {};
    await runner.run(state, opts);

    const lastCall = getLastCallArg();
    expect(lastCall).toBeDefined();
    expect(lastCall!.model).toBe('runner-model');
    expect(lastCall!.thinkingEnabled).toBe(true);
  });

  it('should use runner default when step() receives no options', async () => {
    const mockResponse: LLMResponse = {
      content: 'ok',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };
    const { client, getLastCallArg } = createCapturingClient([mockResponse]);

    const runner = new AgentRunner({
      model: 'default-model',
      llmClient: client,
      thinkingEnabled: false,
    });

    const state = createAgentState({
      name: 'test',
      instructions: 'You are a test assistant.',
      tools: [],
    });

    // No options at all
    await runner.step(state);

    const lastCall = getLastCallArg();
    expect(lastCall).toBeDefined();
    expect(lastCall!.model).toBe('default-model');
    expect(lastCall!.thinkingEnabled).toBe(false);
  });

  it('should allow model override without thinkingEnabled', async () => {
    const mockResponse: LLMResponse = {
      content: 'ok',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };
    const { client, getLastCallArg } = createCapturingClient([mockResponse]);

    const runner = new AgentRunner({
      model: 'default',
      llmClient: client,
      thinkingEnabled: true,
    });

    const state = createAgentState({
      name: 'test',
      instructions: 'You are a test assistant.',
      tools: [],
    });

    // Only model override, thinkingEnabled not specified
    const opts: RunOptions = { model: 'other-model', maxSteps: 1 };
    await runner.run(state, opts);

    const lastCall = getLastCallArg();
    expect(lastCall).toBeDefined();
    expect(lastCall!.model).toBe('other-model');
    // Falls back to runner default (true)
    expect(lastCall!.thinkingEnabled).toBe(true);
  });

  it('should allow thinkingEnabled override without model', async () => {
    const mockResponse: LLMResponse = {
      content: 'ok',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };
    const { client, getLastCallArg } = createCapturingClient([mockResponse]);

    const runner = new AgentRunner({
      model: 'default',
      llmClient: client,
      thinkingEnabled: true,
    });

    const state = createAgentState({
      name: 'test',
      instructions: 'You are a test assistant.',
      tools: [],
    });

    // Only thinkingEnabled override, model not specified
    const opts: RunOptions = { thinkingEnabled: false, maxSteps: 1 };
    await runner.run(state, opts);

    const lastCall = getLastCallArg();
    expect(lastCall).toBeDefined();
    expect(lastCall!.model).toBe('default');
    expect(lastCall!.thinkingEnabled).toBe(false);
  });
});
