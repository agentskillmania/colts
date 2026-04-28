/**
 * @fileoverview Middleware integration with AgentRunner (unit level)
 *
 * Tests that middleware hooks are called correctly during advance/step/run
 * and that override/stop mechanisms work end-to-end.
 */

import { describe, it, expect, vi } from 'vitest';
import type { LLMResponse } from '@agentskillmania/llm-client';
import { AgentRunner } from '../../../src/runner/index.js';
import { createAgentState } from '../../../src/state/index.js';
import type { AgentConfig } from '../../../src/types.js';
import { ToolRegistry } from '../../../src/tools/registry.js';
import { createExecutionState, updateExecState } from '../../../src/execution/index.js';
import type { AgentMiddleware, AdvanceHookReturn } from '../../../src/middleware/types.js';
import { z } from 'zod';

const defaultConfig: AgentConfig = {
  name: 'test-agent',
  instructions: 'You are a helpful assistant.',
  tools: [],
};

const mockTokens = { input: 10, output: 5 };

function createMockClient(responses: LLMResponse[]) {
  let idx = 0;
  return {
    call: vi.fn().mockImplementation(() => {
      if (idx >= responses.length) throw new Error('No more responses');
      return Promise.resolve(responses[idx++]!);
    }),
    stream: vi.fn().mockImplementation(async function* () {
      if (idx >= responses.length) throw new Error('No more responses');
      const resp = responses[idx]!;
      idx++;
      yield { type: 'text' as const, delta: resp.content, accumulatedContent: resp.content };
      if (resp.toolCalls?.length) {
        for (const tc of resp.toolCalls) {
          yield { type: 'tool_call' as const, toolCall: tc };
        }
      }
      yield { type: 'done' as const, roundTotalTokens: resp.tokens };
    }),
  } as unknown as import('@agentskillmania/llm-client').LLMClient;
}

function singleResponse() {
  return createMockClient([
    {
      content: 'Hello!',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    },
  ]);
}

// ─── advance() with middleware ───────────────────────────────

describe('AgentRunner + Middleware: advance()', () => {
  it('should call beforeAdvance and afterAdvance', async () => {
    const client = singleResponse();
    const beforeFn = vi.fn().mockResolvedValue(undefined);
    const afterFn = vi.fn().mockResolvedValue(undefined);

    const mw: AgentMiddleware = { name: 'spy', beforeAdvance: beforeFn, afterAdvance: afterFn };
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, middleware: [mw] });

    const state = createAgentState(defaultConfig);
    const execState = createExecutionState();
    const result = await runner.advance(state, execState);

    expect(beforeFn).toHaveBeenCalledTimes(1);
    expect(beforeFn).toHaveBeenCalledWith(
      expect.objectContaining({
        fromPhase: { type: 'idle' },
        stepNumber: 0,
      })
    );
    expect(afterFn).toHaveBeenCalledTimes(1);
    expect(result.phase.type).toBe('preparing');
  });

  it('should pass stepNumber to advance middleware context', async () => {
    const client = singleResponse();
    const beforeFn = vi.fn().mockResolvedValue(undefined);

    const mw: AgentMiddleware = { name: 'spy', beforeAdvance: beforeFn };
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, middleware: [mw] });

    const state = createAgentState(defaultConfig);
    const execState = createExecutionState();
    await runner.advance(state, execState, undefined, undefined, 3);

    expect(beforeFn).toHaveBeenCalledWith(
      expect.objectContaining({
        stepNumber: 3,
      })
    );
  });

  it('should apply state override from beforeAdvance', async () => {
    const client = singleResponse();
    const overriddenState = createAgentState({ ...defaultConfig, name: 'overridden' });

    const mw: AgentMiddleware = {
      name: 'override',
      beforeAdvance: vi.fn().mockResolvedValue({ state: overriddenState }),
    };
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, middleware: [mw] });

    const state = createAgentState(defaultConfig);
    const execState = createExecutionState();
    const result = await runner.advance(state, execState);

    // The overridden state should have been used
    expect(result.state.id).toBe(overriddenState.id);
  });

  it('should short-circuit when beforeAdvance returns stop', async () => {
    const client = singleResponse();

    const mw: AgentMiddleware = {
      name: 'guard',
      beforeAdvance: vi.fn().mockResolvedValue({
        stop: true as const,
        result: {
          state: createAgentState(defaultConfig),
          execState: createExecutionState(),
          phase: { type: 'completed', answer: 'blocked' },
          done: true,
        },
      }),
    };
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, middleware: [mw] });

    const state = createAgentState(defaultConfig);
    const result = await runner.advance(state, createExecutionState());

    expect(result.phase.type).toBe('completed');
    expect(result.done).toBe(true);
    // LLM should NOT have been called
    expect(client.call).not.toHaveBeenCalled();
  });

  it('should apply state override from afterAdvance', async () => {
    const client = singleResponse();
    const modifiedState = createAgentState({ ...defaultConfig, name: 'modified' });

    const mw: AgentMiddleware = {
      name: 'post-mod',
      afterAdvance: vi.fn().mockResolvedValue({ state: modifiedState }),
    };
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, middleware: [mw] });

    const state = createAgentState(defaultConfig);
    const result = await runner.advance(state, createExecutionState());

    expect(result.state.id).toBe(modifiedState.id);
  });

  it('should not call middleware when none registered', async () => {
    const client = singleResponse();
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });

    const state = createAgentState(defaultConfig);
    const result = await runner.advance(state, createExecutionState());

    expect(result.phase.type).toBe('preparing');
  });
});

// ─── step() with middleware ──────────────────────────────────

describe('AgentRunner + Middleware: step()', () => {
  it('should call beforeStep and afterStep', async () => {
    const client = singleResponse();
    const beforeFn = vi.fn().mockResolvedValue(undefined);
    const afterFn = vi.fn().mockResolvedValue(undefined);

    const mw: AgentMiddleware = { name: 'step-spy', beforeStep: beforeFn, afterStep: afterFn };
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, middleware: [mw] });

    const state = createAgentState(defaultConfig);
    const { result } = await runner.step(state);

    expect(beforeFn).toHaveBeenCalledWith(expect.objectContaining({ stepNumber: 0 }));
    expect(afterFn).toHaveBeenCalledWith(
      expect.objectContaining({
        stepNumber: 0,
        result: expect.objectContaining({ type: 'done' }),
      })
    );
  });

  it('should stop step when beforeStep returns stop', async () => {
    const client = singleResponse();

    const mw: AgentMiddleware = {
      name: 'step-guard',
      beforeStep: vi.fn().mockResolvedValue({ stop: true as const }),
    };
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, middleware: [mw] });

    const state = createAgentState(defaultConfig);
    const { result } = await runner.step(state);

    expect(result.type).toBe('error');
    // LLM should NOT have been called
    expect(client.call).not.toHaveBeenCalled();
  });

  it('should apply state override from afterStep', async () => {
    const client = singleResponse();
    const modifiedState = createAgentState({ ...defaultConfig, name: 'after-step' });

    const mw: AgentMiddleware = {
      name: 'step-mod',
      afterStep: vi.fn().mockResolvedValue({ state: modifiedState }),
    };
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, middleware: [mw] });

    const state = createAgentState(defaultConfig);
    const { state: finalState } = await runner.step(state);

    expect(finalState.id).toBe(modifiedState.id);
  });
});

// ─── run() with middleware ───────────────────────────────────

describe('AgentRunner + Middleware: run()', () => {
  it('should call beforeRun and afterRun', async () => {
    const client = singleResponse();
    const beforeFn = vi.fn().mockResolvedValue(undefined);
    const afterFn = vi.fn().mockResolvedValue(undefined);

    const mw: AgentMiddleware = { name: 'run-spy', beforeRun: beforeFn, afterRun: afterFn };
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, middleware: [mw] });

    const state = createAgentState(defaultConfig);
    const { result } = await runner.run(state);

    expect(beforeFn).toHaveBeenCalledWith(
      expect.objectContaining({
        state: expect.any(Object),
      })
    );
    expect(afterFn).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ type: 'success' }),
      })
    );
  });

  it('should stop run when beforeRun returns stop', async () => {
    const client = singleResponse();

    const mw: AgentMiddleware = {
      name: 'run-guard',
      beforeRun: vi.fn().mockResolvedValue({ stop: true as const }),
    };
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, middleware: [mw] });

    const state = createAgentState(defaultConfig);
    const { result } = await runner.run(state);

    expect(result.type).toBe('error');
    expect(client.call).not.toHaveBeenCalled();
  });

  it('should apply state override from beforeRun', async () => {
    const client = singleResponse();
    const overriddenState = createAgentState({ ...defaultConfig, name: 'pre-run' });

    const mw: AgentMiddleware = {
      name: 'run-override',
      beforeRun: vi.fn().mockResolvedValue({ state: overriddenState }),
    };
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, middleware: [mw] });

    const state = createAgentState(defaultConfig);
    const { state: finalState } = await runner.run(state);

    expect(finalState.id).toBe(overriddenState.id);
  });
});

// ─── stepStream() with middleware ────────────────────────────

describe('AgentRunner + Middleware: stepStream()', () => {
  it('should call beforeStep and afterStep', async () => {
    const client = singleResponse();
    const beforeFn = vi.fn().mockResolvedValue(undefined);
    const afterFn = vi.fn().mockResolvedValue(undefined);

    const mw: AgentMiddleware = {
      name: 'stream-step-spy',
      beforeStep: beforeFn,
      afterStep: afterFn,
    };
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, middleware: [mw] });

    const state = createAgentState(defaultConfig);
    const iterator = runner.stepStream(state);
    // Drain the generator
    while (true) {
      const { done } = await iterator.next();
      if (done) break;
    }

    expect(beforeFn).toHaveBeenCalledWith(expect.objectContaining({ stepNumber: 0 }));
    expect(afterFn).toHaveBeenCalledWith(
      expect.objectContaining({
        stepNumber: 0,
        result: expect.objectContaining({ type: 'done' }),
      })
    );
  });

  it('should call beforeAdvance and afterAdvance for each advance inside stepStream', async () => {
    const client = singleResponse();
    const beforeAdvFn = vi.fn().mockResolvedValue(undefined);
    const afterAdvFn = vi.fn().mockResolvedValue(undefined);

    const mw: AgentMiddleware = {
      name: 'stream-adv-spy',
      beforeAdvance: beforeAdvFn,
      afterAdvance: afterAdvFn,
    };
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, middleware: [mw] });

    const state = createAgentState(defaultConfig);
    const iterator = runner.stepStream(state);
    while (true) {
      const { done } = await iterator.next();
      if (done) break;
    }

    // stepStream() loops through multiple advances until terminal phase
    expect(beforeAdvFn.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(afterAdvFn.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('should stop stepStream when beforeStep returns stop', async () => {
    const client = singleResponse();

    const mw: AgentMiddleware = {
      name: 'stream-step-guard',
      beforeStep: vi.fn().mockResolvedValue({ stop: true as const }),
    };
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, middleware: [mw] });

    const state = createAgentState(defaultConfig);
    const iterator = runner.stepStream(state);
    const { value } = await iterator.next();

    // Should return immediately with error result
    expect(value.result.type).toBe('error');
    // LLM stream should NOT have been called
    expect(client.stream).not.toHaveBeenCalled();
  });

  it('should stop stepStream when afterStep returns stop', async () => {
    const client = singleResponse();

    const mw: AgentMiddleware = {
      name: 'stream-after-step-guard',
      afterStep: vi.fn().mockResolvedValue({ stop: true as const }),
    };
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, middleware: [mw] });

    const state = createAgentState(defaultConfig);
    const iterator = runner.stepStream(state);
    // Drain to get the final return value
    let finalValue:
      | {
          state: import('../../../src/types.js').AgentState;
          result: import('../../../src/execution/index.js').StepResult;
        }
      | undefined;
    while (true) {
      const { done, value } = await iterator.next();
      if (done) {
        finalValue = value;
        break;
      }
    }

    expect(finalValue!.result.type).toBe('error');
  });
});

// ─── runStream() with middleware ─────────────────────────────

describe('AgentRunner + Middleware: runStream()', () => {
  it('should call beforeRun and afterRun', async () => {
    const client = singleResponse();
    const beforeFn = vi.fn().mockResolvedValue(undefined);
    const afterFn = vi.fn().mockResolvedValue(undefined);

    const mw: AgentMiddleware = { name: 'stream-run-spy', beforeRun: beforeFn, afterRun: afterFn };
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, middleware: [mw] });

    const state = createAgentState(defaultConfig);
    const iterator = runner.runStream(state);
    // Drain the generator
    while (true) {
      const { done } = await iterator.next();
      if (done) break;
    }

    expect(beforeFn).toHaveBeenCalledWith(
      expect.objectContaining({
        state: expect.any(Object),
      })
    );
    expect(afterFn).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ type: 'success' }),
      })
    );
  });

  it('should call beforeStep and afterStep for each step in runStream', async () => {
    const client = singleResponse();
    const beforeFn = vi.fn().mockResolvedValue(undefined);
    const afterFn = vi.fn().mockResolvedValue(undefined);

    const mw: AgentMiddleware = {
      name: 'stream-run-step-spy',
      beforeStep: beforeFn,
      afterStep: afterFn,
    };
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, middleware: [mw] });

    const state = createAgentState(defaultConfig);
    const iterator = runner.runStream(state);
    while (true) {
      const { done } = await iterator.next();
      if (done) break;
    }

    // At least one step in the run
    expect(beforeFn.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(afterFn.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('should call beforeAdvance and afterAdvance for each advance in runStream', async () => {
    const client = singleResponse();
    const beforeFn = vi.fn().mockResolvedValue(undefined);
    const afterFn = vi.fn().mockResolvedValue(undefined);

    const mw: AgentMiddleware = {
      name: 'stream-run-adv-spy',
      beforeAdvance: beforeFn,
      afterAdvance: afterFn,
    };
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, middleware: [mw] });

    const state = createAgentState(defaultConfig);
    const iterator = runner.runStream(state);
    while (true) {
      const { done } = await iterator.next();
      if (done) break;
    }

    // stepStream loops multiple advances
    expect(beforeFn.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(afterFn.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('should stop runStream when beforeRun returns stop', async () => {
    const client = singleResponse();

    const mw: AgentMiddleware = {
      name: 'stream-run-guard',
      beforeRun: vi.fn().mockResolvedValue({ stop: true as const }),
    };
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, middleware: [mw] });

    const state = createAgentState(defaultConfig);
    const iterator = runner.runStream(state);
    const { value } = await iterator.next();

    expect(value.result.type).toBe('error');
    expect(client.stream).not.toHaveBeenCalled();
  });

  it('should stop runStream when beforeStep returns stop', async () => {
    const client = singleResponse();

    const mw: AgentMiddleware = {
      name: 'stream-run-step-guard',
      beforeStep: vi.fn().mockResolvedValue({ stop: true as const }),
    };
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, middleware: [mw] });

    const state = createAgentState(defaultConfig);
    const iterator = runner.runStream(state);
    // Drain
    while (true) {
      const { done, value } = await iterator.next();
      if (done) {
        expect(value.result.type).toBe('error');
        break;
      }
    }
  });

  it('should stop runStream when afterStep returns stop', async () => {
    const client = singleResponse();

    const mw: AgentMiddleware = {
      name: 'stream-run-after-step-guard',
      afterStep: vi.fn().mockResolvedValue({ stop: true as const }),
    };
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, middleware: [mw] });

    const state = createAgentState(defaultConfig);
    const iterator = runner.runStream(state);
    while (true) {
      const { done, value } = await iterator.next();
      if (done) {
        expect(value.result.type).toBe('error');
        break;
      }
    }
  });
});

// ─── use() / getMiddlewares() ───────────────────────────────

describe('AgentRunner + Middleware: use()', () => {
  it('should add middleware at runtime via use()', async () => {
    const client = singleResponse();
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });

    expect(runner.getMiddlewares()).toHaveLength(0);

    const mw: AgentMiddleware = {
      name: 'dynamic',
      beforeRun: vi.fn().mockResolvedValue(undefined),
    };
    runner.use(mw);

    expect(runner.getMiddlewares()).toHaveLength(1);
    expect(runner.getMiddlewares()[0]!.name).toBe('dynamic');
  });

  it('should invoke runtime-added middleware during execution', async () => {
    const client = singleResponse();
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });

    const beforeFn = vi.fn().mockResolvedValue(undefined);
    const mw: AgentMiddleware = { name: 'dynamic', beforeRun: beforeFn };
    runner.use(mw);

    await runner.run(createAgentState(defaultConfig));
    expect(beforeFn).toHaveBeenCalledTimes(1);
  });
});
