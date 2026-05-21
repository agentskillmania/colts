/**
 * useAgent execution function tests — executeRun, executeStep, executeAdvance
 *
 * These functions are the core logic of useAgent hook. Previously untested.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentRunner, AgentState, RunStreamEvent } from '@agentskillmania/colts';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';
import { executeRun, executeStep, executeAdvance } from '../../src/hooks/use-agent.js';
import type { TimelineEntry } from '../../src/types/timeline.js';

// Mock TraceWriter to avoid filesystem I/O
vi.mock('../../src/trace-writer.js', () => ({
  TraceWriter: vi.fn().mockImplementation(() => ({
    consume: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  })),
  createTraceWriter: vi.fn().mockResolvedValue({
    consume: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  }),
}));

/** Create a minimal mock AgentRunner for run mode */
function createMockRunnerForRun(
  events: RunStreamEvent[],
  finalResult: {
    state: AgentState;
    result: {
      type: 'success';
      answer: string;
      totalSteps: number;
      tokens: { input: number; output: number };
    };
  }
): AgentRunner {
  return {
    runStream: vi.fn().mockImplementation(async function* () {
      for (const event of events) {
        yield event;
      }
      return finalResult;
    }),
  } as unknown as AgentRunner;
}

/** Create a minimal mock AgentRunner for step mode */
function createMockRunnerForStep(
  events: RunStreamEvent[],
  finalResult: {
    state: AgentState;
    result: { type: 'done'; answer: string; tokens: { input: number; output: number } };
  }
): AgentRunner {
  return {
    stepStream: vi.fn().mockImplementation(async function* () {
      for (const event of events) {
        yield event;
      }
      return finalResult;
    }),
  } as unknown as AgentRunner;
}

/** Create a minimal mock AgentRunner for advance mode */
function createMockRunnerForAdvance(
  phaseResults: Array<{
    events: RunStreamEvent[];
    result: {
      state: AgentState;
      execState: { phase: { type: string } };
      phase: { type: string };
      done: boolean;
    };
  }>
): AgentRunner {
  let callIndex = 0;
  return {
    advanceStream: vi.fn().mockImplementation(async function* () {
      if (callIndex >= phaseResults.length) {
        throw new Error('No more advance results');
      }
      const { events, result } = phaseResults[callIndex++];
      for (const event of events) {
        yield event;
      }
      return result;
    }),
  } as unknown as AgentRunner;
}

describe('executeRun', () => {
  const baseState = createAgentState({
    name: 'test-agent',
    instructions: 'You are a test agent.',
    tools: [],
  });

  it('should process a successful run and update entries + state', async () => {
    const assistantState = addUserMessage(baseState, 'Hello');
    const successResult = {
      type: 'success' as const,
      answer: 'Hello back!',
      totalSteps: 1,
      tokens: { input: 5, output: 3 },
    };
    const finalState = { ...assistantState, context: { ...assistantState.context, stepCount: 1 } };

    const events: RunStreamEvent[] = [
      { type: 'step:start', step: 0, state: assistantState, timestamp: Date.now() },
      { type: 'token', token: 'Hello', timestamp: Date.now() },
      { type: 'token', token: ' back!', timestamp: Date.now() },
      { type: 'step:end', step: 0, result: successResult, timestamp: Date.now() },
    ];

    const runner = createMockRunnerForRun(events, { state: finalState, result: successResult });
    const entries: TimelineEntry[] = [];
    const setEntries = vi.fn((updater) => {
      const next = typeof updater === 'function' ? updater(entries) : updater;
      entries.length = 0;
      entries.push(...next);
    });
    let currentState: AgentState | null = assistantState;
    const setState = vi.fn((s: AgentState) => {
      currentState = s;
    });

    await executeRun(
      runner,
      assistantState,
      'Hello',
      setEntries,
      setState,
      new AbortController().signal
    );

    // Verify runner was called
    expect(runner.runStream).toHaveBeenCalledTimes(1);

    // Verify final state
    expect(setState).toHaveBeenCalledWith(finalState);
    expect(currentState).toEqual(finalState);

    // Verify entries contain assistant response
    const assistantEntries = entries.filter((e) => e.type === 'assistant');
    expect(assistantEntries.length).toBeGreaterThanOrEqual(1);
    expect(assistantEntries[0]).toMatchObject({
      type: 'assistant',
      content: 'Hello back!',
    });
  });

  it('should handle abort gracefully', async () => {
    const assistantState = addUserMessage(baseState, 'Hello');
    const abortResult = {
      type: 'abort' as const,
      totalSteps: 1,
      tokens: { input: 0, output: 0 },
    };
    const finalState = assistantState;

    const events: RunStreamEvent[] = [
      { type: 'step:start', step: 0, state: assistantState, timestamp: Date.now() },
    ];

    const runner = createMockRunnerForRun(events, { state: finalState, result: abortResult });
    const entries: TimelineEntry[] = [];
    const setEntries = vi.fn((updater) => {
      const next = typeof updater === 'function' ? updater(entries) : updater;
      entries.length = 0;
      entries.push(...next);
    });
    let currentState: AgentState | null = assistantState;
    const setState = vi.fn((s: AgentState) => {
      currentState = s;
    });

    await executeRun(
      runner,
      assistantState,
      'Hello',
      setEntries,
      setState,
      new AbortController().signal
    );

    // No error entry should be added on abort
    const errorEntries = entries.filter((e) => e.type === 'error');
    expect(errorEntries.length).toBe(0);
  });

  it('should handle runner errors', async () => {
    const assistantState = addUserMessage(baseState, 'Hello');

    const runner = {
      runStream: vi.fn().mockImplementation(async function* () {
        // Yield token first so consumer creates assistant entry
        yield { type: 'token', token: 'Start', timestamp: Date.now() };
        throw new Error('LLM failed');
      }),
    } as unknown as AgentRunner;

    const entries: TimelineEntry[] = [];
    const setEntries = vi.fn((updater) => {
      const next = typeof updater === 'function' ? updater(entries) : updater;
      entries.length = 0;
      entries.push(...next);
    });
    let currentState: AgentState | null = assistantState;
    const setState = vi.fn((s: AgentState) => {
      currentState = s;
    });

    await executeRun(
      runner,
      assistantState,
      'Hello',
      setEntries,
      setState,
      new AbortController().signal
    );

    // Error should be reflected in assistant entry
    const assistantEntries = entries.filter((e) => e.type === 'assistant');
    expect(assistantEntries.length).toBeGreaterThanOrEqual(1);
    expect(assistantEntries[0].content).toContain('Error: LLM failed');
  });
});

describe('executeStep', () => {
  const baseState = createAgentState({
    name: 'test-agent',
    instructions: 'You are a test agent.',
    tools: [],
  });

  it('should execute one step and finalize assistant', async () => {
    const assistantState = addUserMessage(baseState, 'Hello');
    const stepResult = {
      type: 'done' as const,
      answer: 'Step answer',
      tokens: { input: 5, output: 3 },
    };
    const finalState = { ...assistantState, context: { ...assistantState.context, stepCount: 1 } };

    const events: RunStreamEvent[] = [
      { type: 'token', token: 'Step', timestamp: Date.now() },
      { type: 'token', token: ' answer', timestamp: Date.now() },
    ];

    const runner = createMockRunnerForStep(events, { state: finalState, result: stepResult });
    const entries: TimelineEntry[] = [];
    const setEntries = vi.fn((updater) => {
      const next = typeof updater === 'function' ? updater(entries) : updater;
      entries.length = 0;
      entries.push(...next);
    });
    let currentState: AgentState | null = assistantState;
    const setState = vi.fn((s: AgentState) => {
      currentState = s;
    });

    let pauseCalled = false;
    const pauseFn = () => {
      pauseCalled = true;
      return Promise.resolve();
    };

    await executeStep(
      runner,
      assistantState,
      'Hello',
      setEntries,
      setState,
      new AbortController().signal,
      pauseFn
    );

    // When step completes with 'done', it should NOT pause
    expect(pauseCalled).toBe(false);
    expect(currentState).toEqual(finalState);

    const assistantEntries = entries.filter((e) => e.type === 'assistant');
    expect(assistantEntries.length).toBeGreaterThanOrEqual(1);
    expect(assistantEntries[0]).toMatchObject({
      type: 'assistant',
      content: 'Step answer',
    });
  });

  it('should pause when step needs to continue', async () => {
    const assistantState = addUserMessage(baseState, 'Hello');
    const continueResult = {
      type: 'continue' as const,
      toolResult: {},
      actions: [],
      tokens: { input: 5, output: 3 },
    };
    const doneResult = {
      type: 'done' as const,
      answer: 'Final answer',
      tokens: { input: 5, output: 3 },
    };
    const finalState = { ...assistantState, context: { ...assistantState.context, stepCount: 1 } };

    let callIndex = 0;
    const runner = {
      stepStream: vi.fn().mockImplementation(async function* () {
        callIndex++;
        if (callIndex === 1) {
          yield { type: 'token', token: 'Continue', timestamp: Date.now() };
          return { state: assistantState, result: continueResult };
        }
        yield { type: 'token', token: 'Final', timestamp: Date.now() };
        return { state: finalState, result: doneResult };
      }),
    } as unknown as AgentRunner;

    const entries: TimelineEntry[] = [];
    const setEntries = vi.fn((updater) => {
      const next = typeof updater === 'function' ? updater(entries) : updater;
      entries.length = 0;
      entries.push(...next);
    });
    let currentState: AgentState | null = assistantState;
    const setState = vi.fn((s: AgentState) => {
      currentState = s;
    });

    let pauseCount = 0;
    const pauseFn = () => {
      pauseCount++;
      return Promise.resolve();
    };

    await executeStep(
      runner,
      assistantState,
      'Hello',
      setEntries,
      setState,
      new AbortController().signal,
      pauseFn
    );

    // Should have paused once for continue, then completed
    expect(pauseCount).toBe(1);
    expect(currentState).toEqual(finalState);

    // Should have a system entry prompting to continue
    const systemEntries = entries.filter((e) => e.type === 'system');
    expect(systemEntries.length).toBeGreaterThanOrEqual(1);
    expect(systemEntries[0].content).toContain('Press Enter to continue');
  });

  it('should abort during pause in step mode', async () => {
    const assistantState = addUserMessage(baseState, 'Hello');
    const continueResult = {
      type: 'continue' as const,
      toolResult: {},
      actions: [],
      tokens: { input: 5, output: 3 },
    };
    const runner = {
      stepStream: vi.fn().mockImplementation(async function* () {
        yield { type: 'token', token: 'Continue', timestamp: Date.now() };
        return { state: assistantState, result: continueResult };
      }),
    } as unknown as AgentRunner;

    const entries: TimelineEntry[] = [];
    const setEntries = vi.fn((updater) => {
      const next = typeof updater === 'function' ? updater(entries) : updater;
      entries.length = 0;
      entries.push(...next);
    });
    const setState = vi.fn();

    const abortController = new AbortController();

    // Pause that aborts signal then hangs forever
    const pauseFn = () => {
      abortController.abort();
      return new Promise<void>(() => {});
    };

    const promise = executeStep(
      runner,
      assistantState,
      'Hello',
      setEntries,
      setState,
      abortController.signal,
      pauseFn
    );

    // Before fix: pauseFn hangs forever → timeout
    // After fix: Promise.race with signal aborts pauseFn → completes quickly
    const result = await Promise.race([
      promise.then(() => 'completed'),
      new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 500)),
    ]);

    expect(result).toBe('completed');

    // Abort should not create an error entry
    const errorEntries = entries.filter((e) => e.type === 'error');
    expect(errorEntries.length).toBe(0);
  });
});

describe('executeAdvance', () => {
  const baseState = createAgentState({
    name: 'test-agent',
    instructions: 'You are a test agent.',
    tools: [],
  });

  it('should advance through phases and pause on phase-change', async () => {
    const assistantState = addUserMessage(baseState, 'Hello');
    const finalState = { ...assistantState, context: { ...assistantState.context, stepCount: 1 } };

    const phaseResults = [
      {
        events: [
          {
            type: 'phase-change',
            from: { type: 'idle' },
            to: { type: 'preparing' },
            timestamp: Date.now(),
          },
        ] as RunStreamEvent[],
        result: {
          state: assistantState,
          execState: { phase: { type: 'preparing' } },
          phase: { type: 'preparing' },
          done: false,
        },
      },
      {
        events: [
          {
            type: 'phase-change',
            from: { type: 'preparing' },
            to: { type: 'calling-llm' },
            timestamp: Date.now(),
          },
        ] as RunStreamEvent[],
        result: {
          state: assistantState,
          execState: { phase: { type: 'calling-llm' } },
          phase: { type: 'calling-llm' },
          done: false,
        },
      },
      {
        events: [
          { type: 'token', token: 'Done', timestamp: Date.now() },
          {
            type: 'phase-change',
            from: { type: 'calling-llm' },
            to: { type: 'completed' },
            timestamp: Date.now(),
          },
        ] as RunStreamEvent[],
        result: {
          state: finalState,
          execState: { phase: { type: 'completed' } },
          phase: { type: 'completed' },
          done: true,
        },
      },
    ];

    const runner = createMockRunnerForAdvance(phaseResults);
    const entries: TimelineEntry[] = [];
    const setEntries = vi.fn((updater) => {
      const next = typeof updater === 'function' ? updater(entries) : updater;
      entries.length = 0;
      entries.push(...next);
    });
    let currentState: AgentState | null = assistantState;
    const setState = vi.fn((s: AgentState) => {
      currentState = s;
    });

    let pauseCount = 0;
    const pauseFn = () => {
      pauseCount++;
      return Promise.resolve();
    };

    await executeAdvance(
      runner,
      assistantState,
      'Hello',
      setEntries,
      setState,
      new AbortController().signal,
      pauseFn
    );

    // Should have paused on each phase-change (3 phases = 3 pauses)
    expect(pauseCount).toBe(3);
    expect(currentState).toEqual(finalState);
  });

  it('should handle advance errors', async () => {
    const assistantState = addUserMessage(baseState, 'Hello');

    const runner = {
      advanceStream: vi.fn().mockImplementation(async function* () {
        // Yield token first so consumer creates assistant entry
        yield { type: 'token', token: 'Start', timestamp: Date.now() };
        throw new Error('Advance failed');
      }),
    } as unknown as AgentRunner;

    const entries: TimelineEntry[] = [];
    const setEntries = vi.fn((updater) => {
      const next = typeof updater === 'function' ? updater(entries) : updater;
      entries.length = 0;
      entries.push(...next);
    });
    let currentState: AgentState | null = assistantState;
    const setState = vi.fn((s: AgentState) => {
      currentState = s;
    });

    const pauseFn = () => Promise.resolve();

    await executeAdvance(
      runner,
      assistantState,
      'Hello',
      setEntries,
      setState,
      new AbortController().signal,
      pauseFn
    );

    const assistantEntries = entries.filter((e) => e.type === 'assistant');
    expect(assistantEntries.length).toBeGreaterThanOrEqual(1);
    expect(assistantEntries[0].content).toContain('Error: Advance failed');
  });

  it('should abort during pause in advance mode', async () => {
    const assistantState = addUserMessage(baseState, 'Hello');

    const runner = {
      advanceStream: vi.fn().mockImplementation(async function* () {
        yield {
          type: 'phase-change',
          from: { type: 'idle' },
          to: { type: 'preparing' },
          timestamp: Date.now(),
        } as RunStreamEvent;
        return {
          state: assistantState,
          execState: { phase: { type: 'preparing' } },
          phase: { type: 'preparing' },
          done: false,
        };
      }),
    } as unknown as AgentRunner;

    const entries: TimelineEntry[] = [];
    const setEntries = vi.fn((updater) => {
      const next = typeof updater === 'function' ? updater(entries) : updater;
      entries.length = 0;
      entries.push(...next);
    });
    const setState = vi.fn();

    const abortController = new AbortController();

    // Pause that aborts signal then hangs forever
    const pauseFn = () => {
      abortController.abort();
      return new Promise<void>(() => {});
    };

    const promise = executeAdvance(
      runner,
      assistantState,
      'Hello',
      setEntries,
      setState,
      abortController.signal,
      pauseFn
    );

    // Before fix: pauseFn hangs forever → timeout
    // After fix: Promise.race with signal aborts pauseFn → completes quickly
    const result = await Promise.race([
      promise.then(() => 'completed'),
      new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 500)),
    ]);

    expect(result).toBe('completed');

    // Abort should not create an error entry
    const errorEntries = entries.filter((e) => e.type === 'error');
    expect(errorEntries.length).toBe(0);
  });
});
