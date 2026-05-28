/**
 * @fileoverview Branch coverage tests for StepRunner.runStreaming error phase paths
 *
 * Covers:
 * - StepRunner.runStreaming: error phase handling
 * - StepRunner.runStreaming: defensive throw when loop exits unexpectedly
 */

import { describe, it, expect, vi } from 'vitest';
import { AgentRunner } from '../../../src/runner/index.js';
import { createAgentState } from '../../../src/state/index.js';
import type { AgentConfig } from '../../../src/types.js';
import type { AgentMiddleware } from '../../../src/middleware/types.js';
import { ToolRegistry } from '../../../src/tools/registry.js';
import type { RunnerContext } from '../../../src/runner/advance.js';
import { PhaseRouter } from '../../../src/execution-engine/router.js';
import type { IPhaseHandler } from '../../../src/execution-engine/types.js';
import { StepRunner } from '../../../src/runner/step-runner.js';
import type { MiddlewareExecutor } from '../../../src/middleware/executor.js';

const defaultConfig: AgentConfig = {
  name: 'test-agent',
  instructions: 'You are a helpful assistant.',
  tools: [],
};

describe('StepRunner.runStreaming error phase branch', () => {
  it('should yield phase-change and return error when handler returns error phase', async () => {
    // PhaseRouter catches handler.execute rejection and returns error phase.
    // StepRunner yields phase-change and returns error result (no extra error event,
    // consistent with blocking path behavior).
    const throwingHandler: IPhaseHandler = {
      canHandle: (type: string) => type === 'idle',
      execute: vi.fn().mockRejectedValue(new Error('Advance failed')),
    };

    const router = new PhaseRouter([throwingHandler]);
    const state = createAgentState(defaultConfig);

    const ctx = {
      llmProvider: { call: vi.fn(), stream: vi.fn() },
      toolRegistry: new ToolRegistry(),
      messageAssembler: { build: vi.fn().mockReturnValue([]) },
      phaseRouter: router,
      toolSchemaFormatter: { format: vi.fn() },
      executionPolicy: { shouldStop: vi.fn().mockReturnValue({ decision: 'continue' }) },
      options: { model: 'gpt-4' },
    } as unknown as RunnerContext;

    const events: { type: string }[] = [];
    let finalResult: { result: { type: string } } | undefined;

    const stepRunner = new StepRunner(ctx, undefined, undefined, { model: 'gpt-4' });
    const iterator = stepRunner.runStreaming(state, new ToolRegistry());
    while (true) {
      const { done, value } = await iterator.next();
      if (done) {
        finalResult = value as { result: { type: string } };
        break;
      }
      events.push(value as { type: string });
    }

    // StepRunner yields phase-change; error result is returned (not yielded),
    // consistent with blocking path.
    expect(events.map((e) => e.type)).toEqual(['phase-change']);
    expect(finalResult?.result.type).toBe('error');
  });

  it('should return stopped when middleware afterAdvance requests stop with completed phase', async () => {
    const middleware: AgentMiddleware = {
      name: 'test-stop-mw',
      afterAdvance: async () => {
        return {
          stop: true,
          result: {
            state: createAgentState(defaultConfig),
            execState: { phase: { type: 'completed', answer: 'stopped' } },
            phase: { type: 'completed', answer: 'stopped' },
            done: true,
          },
        };
      },
    };

    const mockLLM = {
      call: vi.fn().mockResolvedValue({
        content: 'Hello',
        stopReason: 'stop',
        tokens: { input: 10, output: 5 },
      }),
      stream: async function* () {
        yield { type: 'text', delta: 'Hello' };
        yield {
          type: 'done',
          accumulatedContent: 'Hello',
          roundTotalTokens: { input: 10, output: 5 },
        };
      },
    };

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: mockLLM as unknown as import('@agentskillmania/llm-client').LLMClient,
      middleware: [middleware],
    });

    const state = createAgentState(defaultConfig);
    const events: { type: string }[] = [];
    let finalResult: { result: { type: string } } | undefined;

    const iterator = runner.stepStream(state);
    while (true) {
      const { done, value } = await iterator.next();
      if (done) {
        finalResult = value as { result: { type: string } };
        break;
      }
      events.push(value as { type: string });
    }

    // After StepRunner unification, streaming path now correctly handles
    // completed phase from middleware stopResult (same as blocking path).
    expect(finalResult?.result.type).toBe('stopped');
  });

  it('should return error when middleware beforeAdvance requests stop', async () => {
    const mockExecutor = {
      runBeforeAdvance: vi.fn().mockResolvedValue({
        stopResult: true,
        state: null,
        execState: null,
      }),
      runAfterAdvance: vi.fn(),
      isEmpty: false,
    };

    const idleHandler: IPhaseHandler = {
      canHandle: (type: string) => type === 'idle',
      execute: vi.fn().mockResolvedValue({
        state: createAgentState(defaultConfig),
        execState: {
          phase: { type: 'completed', answer: 'done' },
          stepCount: 0,
          action: null,
          allActions: [],
          toolResult: null,
        },
        phase: { type: 'completed', answer: 'done' },
        done: true,
      }),
      streamExecute: async function* () {
        return {
          state: createAgentState(defaultConfig),
          execState: {
            phase: { type: 'completed', answer: 'done' },
            stepCount: 0,
            action: null,
            allActions: [],
            toolResult: null,
          },
          phase: { type: 'completed', answer: 'done' },
          done: true,
        } as AdvanceResult;
      },
    };

    const router = new PhaseRouter([idleHandler]);
    const state = createAgentState(defaultConfig);

    const ctx = {
      llmProvider: { call: vi.fn(), stream: vi.fn() },
      toolRegistry: new ToolRegistry(),
      messageAssembler: { build: vi.fn().mockReturnValue([]) },
      phaseRouter: router,
      toolSchemaFormatter: { format: vi.fn() },
      executionPolicy: { shouldStop: vi.fn().mockReturnValue({ decision: 'continue' }) },
      options: { model: 'gpt-4' },
    } as unknown as RunnerContext;

    const stepRunner = new StepRunner(
      ctx,
      undefined,
      mockExecutor as unknown as MiddlewareExecutor,
      { model: 'gpt-4' }
    );
    const iterator = stepRunner.runStreaming(state, new ToolRegistry());
    const { done, value } = await iterator.next();
    expect(done).toBe(true);
    expect((value as { result: { type: string } }).result.type).toBe('error');
  });

  it('should catch error thrown by phaseRouter.executeStream', async () => {
    const throwingStreamHandler: IPhaseHandler = {
      canHandle: (type: string) => type === 'idle',
      execute: vi.fn(),
      streamExecute: async function* () {
        throw new Error('Stream handler crashed');
      },
    };

    const router = new PhaseRouter([throwingStreamHandler]);
    const state = createAgentState(defaultConfig);

    const ctx = {
      llmProvider: { call: vi.fn(), stream: vi.fn() },
      toolRegistry: new ToolRegistry(),
      messageAssembler: { build: vi.fn().mockReturnValue([]) },
      phaseRouter: router,
      toolSchemaFormatter: { format: vi.fn() },
      executionPolicy: { shouldStop: vi.fn().mockReturnValue({ decision: 'continue' }) },
      options: { model: 'gpt-4' },
    } as unknown as RunnerContext;

    const events: { type: string }[] = [];
    let finalResult: { result: { type: string; error?: Error } } | undefined;

    const stepRunner = new StepRunner(ctx, undefined, undefined, { model: 'gpt-4' });
    const iterator = stepRunner.runStreaming(state, new ToolRegistry());
    while (true) {
      const { done, value } = await iterator.next();
      if (done) {
        finalResult = value as { result: { type: string; error?: Error } };
        break;
      }
      events.push(value as { type: string });
    }

    expect(events.map((e) => e.type)).toEqual(['error']);
    expect(finalResult?.result.type).toBe('error');
    expect(finalResult?.result.error?.message).toBe('Stream handler crashed');
  });

  it('should throw when advance returns terminal phase without done flag', async () => {
    // Defensive: if PhaseRouter returns completed/error but done=false,
    // the while loop exits (isTerminalPhase=true) but no return path matches.
    const fakeHandler: IPhaseHandler = {
      canHandle: (type: string) => type === 'idle',
      execute: vi.fn().mockResolvedValue({
        state: createAgentState(defaultConfig),
        execState: {
          phase: { type: 'completed', answer: 'done' },
          stepCount: 0,
          action: null,
          allActions: [],
          toolResult: null,
        },
        phase: { type: 'completed', answer: 'done' },
        done: false, // terminal phase but done=false → triggers defensive throw
      } as AdvanceResult),
      executeStream: async function* () {
        return {
          state: createAgentState(defaultConfig),
          execState: {
            phase: { type: 'completed', answer: 'done' },
            stepCount: 0,
            action: null,
            allActions: [],
            toolResult: null,
          },
          phase: { type: 'completed', answer: 'done' },
          done: false,
        } as AdvanceResult;
      },
    };

    const router = new PhaseRouter([fakeHandler]);
    const state = createAgentState(defaultConfig);

    const ctx = {
      llmProvider: { call: vi.fn(), stream: vi.fn() },
      toolRegistry: new ToolRegistry(),
      messageAssembler: { build: vi.fn().mockReturnValue([]) },
      phaseRouter: router,
      toolSchemaFormatter: { format: vi.fn() },
      executionPolicy: { shouldStop: vi.fn().mockReturnValue({ decision: 'continue' }) },
      options: { model: 'gpt-4' },
    } as unknown as RunnerContext;

    const stepRunner = new StepRunner(ctx, undefined, undefined, { model: 'gpt-4' });
    const iterator = stepRunner.runStreaming(state, new ToolRegistry());
    // First next() consumes the phase-change event yielded by StepRunner
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect((first.value as { type: string }).type).toBe('phase-change');
    // Second next() triggers the defensive throw after loop exit
    await expect(iterator.next()).rejects.toThrow(
      'Unexpected: stepStream loop exited without reaching terminal phase'
    );
  });
});
