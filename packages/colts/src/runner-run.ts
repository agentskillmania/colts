/**
 * @fileoverview Step/Run Execution Helpers
 *
 * Handles meso-step (step) and macro-step (run) orchestration.
 * Extracted from AgentRunner for maintainability.
 */

import type { AgentState, IToolRegistry, IContextCompressor } from './types.js';
import type { StepResult, RunResult, RunStreamEvent } from './execution.js';
import { createExecutionState, isTerminalPhase } from './execution.js';
import type { RunnerContext } from './runner-advance.js';
import { executeAdvance } from './runner-advance.js';
import { executeStepStream } from './runner-stream.js';
import { maybeCompress } from './runner-compression.js';

/**
 * Complete one ReAct cycle (meso-step)
 */
export async function executeStep(
  ctx: RunnerContext,
  compressor: IContextCompressor | undefined,
  state: AgentState,
  toolRegistry?: IToolRegistry,
  options?: { signal?: AbortSignal }
): Promise<{ state: AgentState; result: StepResult }> {
  const registry = toolRegistry ?? ctx.toolRegistry;
  const execState = createExecutionState();

  // Loop advance() until a natural stopping point
  let currentState = state;
  while (!isTerminalPhase(execState.phase)) {
    options?.signal?.throwIfAborted();
    const {
      state: newState,
      phase,
      done,
    } = await executeAdvance(ctx, currentState, execState, registry, options);
    currentState = await maybeCompress(compressor, newState);

    // Terminal: completed (direct answer, state already updated by advance)
    if (done && phase.type === 'completed') {
      return { state: currentState, result: { type: 'done', answer: phase.answer } };
    }

    // Terminal: error (LLM call failed, report to caller)
    if (done && phase.type === 'error') {
      return { state: currentState, result: { type: 'error', error: phase.error } };
    }

    // Non-terminal stopping point: tool-result (state already updated by advance)
    if (phase.type === 'tool-result') {
      return { state: currentState, result: { type: 'continue', toolResult: phase.result } };
    }
  }

  // Should not reach here: all terminal phases are handled inside the loop body
  throw new Error('Unexpected: executeStep loop exited without reaching terminal phase');
}

/**
 * Run until completion (macro-step)
 */
export async function executeRun(
  ctx: RunnerContext,
  compressor: IContextCompressor | undefined,
  state: AgentState,
  options?: { maxSteps?: number; signal?: AbortSignal },
  toolRegistry?: IToolRegistry
): Promise<{ state: AgentState; result: RunResult }> {
  const registry = toolRegistry ?? ctx.toolRegistry;
  // maxSteps hierarchy: run parameter > RunnerOptions > default 10
  const maxSteps = options?.maxSteps ?? ctx.options.maxSteps ?? 10;
  let currentState = state;
  let totalSteps = 0;

  while (totalSteps < maxSteps) {
    options?.signal?.throwIfAborted();
    const { state: newState, result } = await executeStep(
      ctx,
      compressor,
      currentState,
      registry,
      options
    );
    currentState = newState;
    totalSteps++;

    if (result.type === 'done') {
      return {
        state: currentState,
        result: { type: 'success', answer: result.answer, totalSteps },
      };
    }

    if (result.type === 'error') {
      return {
        state: currentState,
        result: { type: 'error', error: result.error, totalSteps },
      };
    }

    // result.type === 'continue' — loop again with updated state
  }

  return {
    state: currentState,
    result: { type: 'max_steps', totalSteps },
  };
}

/**
 * Stream run until completion (macro-step streaming)
 */
export async function* executeRunStream(
  ctx: RunnerContext,
  compressor: IContextCompressor | undefined,
  state: AgentState,
  options?: { maxSteps?: number; signal?: AbortSignal },
  toolRegistry?: IToolRegistry
): AsyncGenerator<RunStreamEvent, { state: AgentState; result: RunResult }> {
  const registry = toolRegistry ?? ctx.toolRegistry;
  // maxSteps hierarchy: run parameter > RunnerOptions > default 10
  const maxSteps = options?.maxSteps ?? ctx.options.maxSteps ?? 10;
  let currentState = state;
  let totalSteps = 0;

  while (totalSteps < maxSteps) {
    options?.signal?.throwIfAborted();
    yield { type: 'step:start', step: totalSteps, state: currentState };

    // Use stepStream to get real-time tokens and phase events
    const iterator = executeStepStream(ctx, compressor, currentState, registry, options);
    let stepResult: { state: AgentState; result: StepResult };

    while (true) {
      const { done, value } = await iterator.next();
      if (done) {
        stepResult = value;
        break;
      }
      // Forward all events from stepStream (token, phase-change, tool:start/end)
      yield value as RunStreamEvent;
    }

    currentState = stepResult.state;
    totalSteps++;

    yield { type: 'step:end', step: totalSteps - 1, result: stepResult.result };

    // Auto-compress between steps (yield events so UI can observe)
    if (compressor && compressor.shouldCompress(currentState)) {
      yield { type: 'compressing' };
      const compressedState = await maybeCompress(compressor, currentState);
      if (compressedState.context.compression) {
        const prevAnchor = stepResult.state.context.compression?.anchor ?? 0;
        const newAnchor = compressedState.context.compression.anchor;
        yield {
          type: 'compressed',
          summary: compressedState.context.compression.summary,
          removedCount: newAnchor - prevAnchor,
        };
        currentState = compressedState;
      }
    }

    if (stepResult.result.type === 'done') {
      const runResult: RunResult = {
        type: 'success',
        answer: stepResult.result.answer,
        totalSteps,
      };
      yield { type: 'complete', result: runResult };
      return { state: currentState, result: runResult };
    }

    if (stepResult.result.type === 'error') {
      const runResult: RunResult = {
        type: 'error',
        error: stepResult.result.error,
        totalSteps,
      };
      yield { type: 'complete', result: runResult };
      return { state: currentState, result: runResult };
    }
  }

  // maxSteps exhausted
  const runResult: RunResult = { type: 'max_steps', totalSteps };
  yield { type: 'complete', result: runResult };
  return { state: currentState, result: runResult };
}
