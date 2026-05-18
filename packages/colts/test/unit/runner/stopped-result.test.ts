/**
 * @fileoverview Tests for stopped result propagation through runner
 *
 * Verifies that middleware can stop execution with custom results,
 * and those results are properly propagated through the advance → step → run chain.
 */

import { describe, it, expect } from 'vitest';
import { AgentRunner } from '../../../src/runner/index.js';
import type { AgentMiddleware } from '../../../src/middleware/types.js';
import type { StepResult, RunResult } from '../../../src/execution/index.js';
import { createAgentState } from '../../../src/state/index.js';

describe('Runner: stopped result propagation', () => {
  it('should propagate stopped result from beforeAdvance in run()', async () => {
    const customData = 'Custom stopped result from beforeAdvance';

    const middleware: AgentMiddleware = {
      name: 'test-middleware',
      beforeAdvance: async ({ fromPhase }) => {
        // Stop on first advance with a completed phase
        if (fromPhase.type === 'idle') {
          return {
            stop: true,
            result: {
              state: createAgentState({
                config: { model: 'gpt-4', instructions: 'Test' },
                context: { messages: [] },
              }),
              execState: {
                phase: { type: 'completed', answer: customData },
              },
              done: true,
              phase: { type: 'completed', answer: customData },
            },
          };
        }
        return;
      },
    };

    const runner = new AgentRunner({
      model: 'gpt-4',
      llm: {
        provider: 'openai',
        apiKey: 'test-key',
      },
      middleware: [middleware],
    });

    const initialState = createAgentState({
      config: { model: 'gpt-4', instructions: 'Test agent' },
      context: { messages: [] },
    });

    const { result } = await runner.run(initialState);

    // Verify the result is stopped with the custom data
    expect(result.type).toBe('stopped');
    expect(result.data).toBe(customData);
  });

  it('should propagate stopped result from beforeStep in run()', async () => {
    const customData = 'Custom stopped result from beforeStep';

    const middleware: AgentMiddleware = {
      name: 'test-middleware',
      beforeStep: async () => {
        return {
          stop: true,
          result: {
            type: 'stopped',
            data: customData,
            tokens: { input: 10, output: 5 },
          },
        };
      },
    };

    const runner = new AgentRunner({
      model: 'gpt-4',
      llm: {
        provider: 'openai',
        apiKey: 'test-key',
      },
      middleware: [middleware],
    });

    const initialState = createAgentState({
      config: { model: 'gpt-4', instructions: 'Test agent' },
      context: { messages: [] },
    });

    const { result } = await runner.run(initialState);

    // Verify the result is stopped with the custom data
    expect(result.type).toBe('stopped');
    expect(result.data).toBe(customData);
  });

  it('should propagate stopped result from afterStep in run()', async () => {
    const customData = 'Custom stopped result from afterStep';
    let callCount = 0;

    const middleware: AgentMiddleware = {
      name: 'test-middleware',
      afterStep: async ({ result }) => {
        callCount++;
        // Stop after first step
        if (callCount === 1) {
          return {
            stop: true,
            result: {
              type: 'stopped',
              data: customData,
              tokens: result.tokens,
            },
          };
        }
        return;
      },
    };

    // Create a mock LLM that returns a simple text response (no tools)
    const mockLLM = {
      call: async () => ({
        content: 'Hello!',
        stopReason: 'stop',
        tokens: { input: 10, output: 5 },
      }),
      stream: async function* () {
        yield { type: 'text', delta: 'Hello!' };
        yield {
          type: 'done',
          accumulatedContent: 'Hello!',
          roundTotalTokens: { input: 10, output: 5 },
        };
      },
    };

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: mockLLM as any,
      middleware: [middleware],
    });

    const initialState = createAgentState({
      config: { model: 'gpt-4', instructions: 'Test agent' },
      context: { messages: [] },
    });

    const { result } = await runner.run(initialState);

    // Verify the result is stopped with the custom data
    expect(result.type).toBe('stopped');
    expect(result.data).toBe(customData);
  });

  it('should propagate stopped result from beforeRun in run()', async () => {
    const customData = 'Custom stopped result from beforeRun';

    const middleware: AgentMiddleware = {
      name: 'test-middleware',
      beforeRun: async () => {
        return {
          stop: true,
          result: {
            type: 'stopped',
            data: customData,
            totalSteps: 0,
            tokens: { input: 0, output: 0 },
          },
        };
      },
    };

    const runner = new AgentRunner({
      model: 'gpt-4',
      llm: {
        provider: 'openai',
        apiKey: 'test-key',
      },
      middleware: [middleware],
    });

    const initialState = createAgentState({
      config: { model: 'gpt-4', instructions: 'Test agent' },
      context: { messages: [] },
    });

    const { result } = await runner.run(initialState);

    // Verify the result is stopped with the custom data
    expect(result.type).toBe('stopped');
    expect(result.data).toBe(customData);
  });

  it('should fallback to error when middleware stops without result', async () => {
    const middleware: AgentMiddleware = {
      name: 'test-middleware',
      beforeStep: async () => {
        return { stop: true };
      },
    };

    const runner = new AgentRunner({
      model: 'gpt-4',
      llm: {
        provider: 'openai',
        apiKey: 'test-key',
      },
      middleware: [middleware],
    });

    const initialState = createAgentState({
      config: { model: 'gpt-4', instructions: 'Test agent' },
      context: { messages: [] },
    });

    const { result } = await runner.run(initialState);

    // Verify the result is error (backward compatible)
    expect(result.type).toBe('error');
    expect(result.error.message).toBe('Stopped by middleware');
  });

  it('should handle stopped result in step() directly', async () => {
    const customData = 'Custom stopped result from step';

    const middleware: AgentMiddleware = {
      name: 'test-middleware',
      beforeStep: async () => {
        return {
          stop: true,
          result: {
            type: 'stopped',
            data: customData,
            tokens: { input: 5, output: 3 },
          },
        };
      },
    };

    const runner = new AgentRunner({
      model: 'gpt-4',
      llm: {
        provider: 'openai',
        apiKey: 'test-key',
      },
      middleware: [middleware],
    });

    const initialState = createAgentState({
      config: { model: 'gpt-4', instructions: 'Test agent' },
      context: { messages: [] },
    });

    const { result } = await runner.step(initialState);

    // Verify the result is stopped with the custom data
    expect(result.type).toBe('stopped');
    expect(result.data).toBe(customData);
  });

  it('should handle stopped result in run() with step containing stopped type', async () => {
    const customData = 'Custom stopped data';

    const middleware: AgentMiddleware = {
      name: 'test-middleware',
      beforeStep: async () => {
        return {
          stop: true,
          result: {
            type: 'stopped',
            data: customData,
            tokens: { input: 10, output: 5 },
          },
        };
      },
    };

    const runner = new AgentRunner({
      model: 'gpt-4',
      llm: {
        provider: 'openai',
        apiKey: 'test-key',
      },
      middleware: [middleware],
    });

    const initialState = createAgentState({
      config: { model: 'gpt-4', instructions: 'Test agent' },
      context: { messages: [] },
    });

    const { result } = await runner.run(initialState);

    // Verify the run result is stopped
    expect(result.type).toBe('stopped');
    expect(result.data).toBe(customData);
  });
});
