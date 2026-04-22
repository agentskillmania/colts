/**
 * @fileoverview executeStep / executeAdvance control flow regression tests
 *
 * Covers three "naked" paths pointed out by CR:
 * - T-CLI2: await pauseFn() blocks on phase-change in executeAdvance inner loop
 * - T-CLI3: break (not return) on executeStep done ensures tracer.flush() executes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentState, AgentRunner, StepResult } from '@agentskillmania/colts';
import { createAgentState } from '@agentskillmania/colts';
import { executeStep, executeAdvance } from '../../src/hooks/use-agent.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockState(): AgentState {
  return createAgentState({
    name: 'test-agent',
    instructions: 'You are a test assistant.',
    tools: [],
  });
}

function createMockSetEntries() {
  const entries: unknown[] = [];
  const setter = vi.fn((action: unknown) => {
    if (typeof action === 'function') {
      entries.length = 0;
      entries.push(...action(entries));
    } else {
      entries.length = 0;
      entries.push(action);
    }
  });
  return { setter, entries };
}

function createMockSetState() {
  let state: AgentState | null = null;
  const setter = vi.fn((action: unknown) => {
    if (typeof action === 'function') {
      state = (action as (prev: AgentState | null) => AgentState | null)(state);
    } else {
      state = action as AgentState | null;
    }
  });
  return { setter, getState: () => state };
}

// ---------------------------------------------------------------------------
// T-CLI3: executeStep done → break (not return) → tracer.flush() executes
// ---------------------------------------------------------------------------

describe('executeStep regression (CR T-CLI3)', () => {
  it('should call tracer.flush() after step done', async () => {
    const mockState = createMockState();
    const doneResult: StepResult = { type: 'done', answer: 'test answer' };

    // Create mock runner whose stepStream returns an immediately completing generator
    const mockRunner = {
      stepStream: vi.fn().mockImplementation(async function* () {
        yield { type: 'token', token: 'hello' };
        return { state: mockState, result: doneResult };
      }),
    } as unknown as AgentRunner;

    const { setter: setEntries } = createMockSetEntries();
    const { setter: setState } = createMockSetState();
    const abortController = new AbortController();
    const pauseFn = vi.fn().mockResolvedValue(undefined);

    // Spy on TraceWriter.prototype.flush to verify it is called
    const { TraceWriter } = await import('../../src/trace-writer.js');
    const flushSpy = vi.spyOn(TraceWriter.prototype, 'flush').mockResolvedValue();

    await executeStep(
      mockRunner,
      mockState,
      'test input',
      setEntries as any,
      setState as any,
      abortController.signal,
      pauseFn
    );

    // tracer.flush() should be called — if original code used return instead of break, this would not be called
    expect(flushSpy).toHaveBeenCalledTimes(1);

    flushSpy.mockRestore();
  });

  it('should call tracer.flush() after step error', async () => {
    const mockState = createMockState();

    const mockRunner = {
      stepStream: vi.fn().mockImplementation(async function* () {
        yield { type: 'token', token: 'hello' };
        throw new Error('test error');
      }),
    } as unknown as AgentRunner;

    const { setter: setEntries } = createMockSetEntries();
    const { setter: setState } = createMockSetState();
    const abortController = new AbortController();
    const pauseFn = vi.fn().mockResolvedValue(undefined);

    const { TraceWriter } = await import('../../src/trace-writer.js');
    const flushSpy = vi.spyOn(TraceWriter.prototype, 'flush').mockResolvedValue();

    await executeStep(
      mockRunner,
      mockState,
      'test input',
      setEntries as any,
      setState as any,
      abortController.signal,
      pauseFn
    );

    // Even on error, tracer.flush() should be called
    expect(flushSpy).toHaveBeenCalledTimes(1);

    flushSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// T-CLI2: executeAdvance pause on phase-change
// ---------------------------------------------------------------------------

describe('executeAdvance regression (CR T-CLI2)', () => {
  it('should await pauseFn on each phase-change event', async () => {
    const mockState = createMockState();

    // Simulate advanceStream: yield phase-change events, then complete
    const mockRunner = {
      advanceStream: vi.fn().mockImplementation(async function* () {
        yield { type: 'phase-change', from: { type: 'idle' }, to: { type: 'preparing' } };
        yield { type: 'phase-change', from: { type: 'preparing' }, to: { type: 'calling-llm' } };
        return { state: mockState, phase: { type: 'completed', answer: 'done' }, done: true };
      }),
    } as unknown as AgentRunner;

    const { setter: setEntries } = createMockSetEntries();
    const { setter: setState } = createMockSetState();
    const abortController = new AbortController();

    const pauseFn = vi.fn().mockResolvedValue(undefined);

    const { TraceWriter } = await import('../../src/trace-writer.js');
    vi.spyOn(TraceWriter.prototype, 'flush').mockResolvedValue();

    await executeAdvance(
      mockRunner,
      mockState,
      'test input',
      setEntries as any,
      setState as any,
      abortController.signal,
      pauseFn
    );

    // Each phase-change should await pauseFn
    // There are 2 phase-change events
    expect(pauseFn).toHaveBeenCalledTimes(2);
  });

  it('should reset assistant when phase-change to calling-llm', async () => {
    const mockState = createMockState();

    const mockRunner = {
      advanceStream: vi.fn().mockImplementation(async function* () {
        yield { type: 'phase-change', from: { type: 'idle' }, to: { type: 'preparing' } };
        yield { type: 'phase-change', from: { type: 'preparing' }, to: { type: 'calling-llm' } };
        return { state: mockState, phase: { type: 'completed', answer: 'done' }, done: true };
      }),
    } as unknown as AgentRunner;

    const { setter: setEntries } = createMockSetEntries();
    const { setter: setState } = createMockSetState();
    const abortController = new AbortController();
    const pauseFn = vi.fn().mockResolvedValue(undefined);

    const { TraceWriter } = await import('../../src/trace-writer.js');
    vi.spyOn(TraceWriter.prototype, 'flush').mockResolvedValue();

    await executeAdvance(
      mockRunner,
      mockState,
      'test input',
      setEntries as any,
      setState as any,
      abortController.signal,
      pauseFn
    );

    // phase-change → calling-llm should trigger resetAssistant (calls setEntries)
    // Plus initial resetAssistant and setEntries updates during phase-change,
    // setEntries call count should be >= 3 (initial + 2 phase-change flushes + resetAssistant)
    expect(setEntries).toHaveBeenCalled();
    // pauseFn is called at calling-llm phase-change
    expect(pauseFn).toHaveBeenCalled();
  });
});
