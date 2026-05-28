/**
 * Architecture contract tests — verify the delegation chain
 *
 * runStream() → stepStream() → StepRunner.runStreaming()
 *
 * These tests protect against accidental architectural regressions
 * where a public method bypasses the intermediate layer.
 */

import { describe, it, expect, vi } from 'vitest';
import type { LLMResponse } from '@agentskillmania/llm-client';
import { AgentRunner } from '../../../src/runner/index.js';
import { StepRunner } from '../../../src/runner/step-runner.js';
import { createAgentState } from '../../../src/state/index.js';
import type { AgentConfig } from '../../../src/types.js';
import { createMockLLMClient } from '../../helpers/mock-llm.js';

const defaultConfig: AgentConfig = {
  name: 'test-agent',
  instructions: 'You are a helpful assistant.',
  tools: [],
};

const mockTokens = { input: 10, output: 5 };

describe('Architecture contract: delegation chain', () => {
  it('runStream must delegate to stepStream, not directly to StepRunner', async () => {
    const mockResponse: LLMResponse = {
      content: 'Hello',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });

    const stepStreamSpy = vi.spyOn(runner, 'stepStream');

    const state = createAgentState(defaultConfig);
    const gen = runner.runStream(state);

    // Consume the stream
    while (true) {
      const { done } = await gen.next();
      if (done) break;
    }

    expect(stepStreamSpy).toHaveBeenCalled();

    stepStreamSpy.mockRestore();
  });

  it('stepStream must delegate to StepRunner.runStreaming', async () => {
    const mockResponse: LLMResponse = {
      content: 'Hello',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });

    const runStreamingSpy = vi.spyOn(StepRunner.prototype, 'runStreaming');

    const state = createAgentState(defaultConfig);
    const gen = runner.stepStream(state);

    // Consume the stream
    while (true) {
      const { done } = await gen.next();
      if (done) break;
    }

    expect(runStreamingSpy).toHaveBeenCalled();

    runStreamingSpy.mockRestore();
  });

  it('run must delegate to step, not directly to StepRunner', async () => {
    const mockResponse: LLMResponse = {
      content: 'Hello',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });

    const stepSpy = vi.spyOn(runner, 'step');

    const state = createAgentState(defaultConfig);
    await runner.run(state);

    expect(stepSpy).toHaveBeenCalled();

    stepSpy.mockRestore();
  });

  it('step must delegate to StepRunner.runBlocking', async () => {
    const mockResponse: LLMResponse = {
      content: 'Hello',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });

    const runBlockingSpy = vi.spyOn(StepRunner.prototype, 'runBlocking');

    const state = createAgentState(defaultConfig);
    await runner.step(state);

    expect(runBlockingSpy).toHaveBeenCalled();

    runBlockingSpy.mockRestore();
  });
});
