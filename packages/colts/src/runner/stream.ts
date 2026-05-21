/**
 * @fileoverview Streaming Execution Helpers
 *
 * Handles streaming advance and step execution by delegating to PhaseRouter.
 * Extracted from AgentRunner for maintainability.
 */

import type { AgentState, IToolRegistry } from '../types.js';
import type {
  AdvanceResult,
  ExecutionState,
  StepResult,
  StreamEvent,
  AdvanceOptions,
} from '../execution/index.js';
import { createExecutionState, isTerminalPhase, updateExecState } from '../execution/index.js';
import { addTokenStats } from '../utils/tokens.js';
import { updateTotalTokens, updateState } from '../state/index.js';
import type { RunnerContext } from './advance.js';
import { maybeCompress } from './compression.js';
import type { IContextCompressor } from '../types.js';
import type { MiddlewareExecutor } from '../middleware/executor.js';
import type { RunnerOptions } from './options.js';

/**
 * Stream phase advancement (micro-step streaming)
 *
 * Delegates to PhaseRouter.executeStream so that calling-llm phase
 * is handled by CallingLLMHandler.streamExecute alongside all other phases.
 *
 * @param ctx - Runner context
 * @param state - Current agent state
 * @param execState - Execution state (immutable)
 * @param toolRegistry - Optional tool registry
 * @param options - Optional advance options
 * @yields Stream events during phase advancement
 * @returns Final advance result
 */
export async function* executeAdvanceStream(
  ctx: RunnerContext,
  state: AgentState,
  execState: ExecutionState,
  toolRegistry?: IToolRegistry,
  options?: AdvanceOptions
): AsyncGenerator<StreamEvent, AdvanceResult> {
  const fromPhase = execState.phase;
  const registry = toolRegistry ?? ctx.toolRegistry;

  try {
    const result = yield* ctx.phaseRouter.executeStream(ctx, state, execState, registry, options);

    // Forward effects produced by handler (e.g., tool:end, skill:start)
    if (result.effects && result.effects.length > 0) {
      for (const effect of result.effects) {
        yield effect as StreamEvent;
      }
    }

    yield { type: 'phase-change', from: fromPhase, to: result.phase, timestamp: Date.now() };

    return result;
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    const nextExec = updateExecState(execState, (draft) => {
      draft.phase = { type: 'error', error: errorObj };
    });
    yield { type: 'error', error: errorObj, context: { step: 0 }, timestamp: Date.now() };
    return { state, execState: nextExec, phase: nextExec.phase, done: true };
  }
}

/**
 * Stream one ReAct cycle with observation (meso-step streaming)
 *
 * @param ctx - Runner context
 * @param compressor - Optional context compressor
 * @param state - Current agent state
 * @param toolRegistry - Optional tool registry
 * @param options - Optional execution options
 * @yields Stream events during the step
 * @returns Final state and step result
 */
export async function* executeStepStream(
  ctx: RunnerContext,
  compressor: IContextCompressor | undefined,
  state: AgentState,
  toolRegistry?: IToolRegistry,
  options?: { signal?: AbortSignal },
  middlewareExecutor?: MiddlewareExecutor,
  stepNumber?: number,
  runnerOptions?: Readonly<RunnerOptions>
): AsyncGenerator<StreamEvent, { state: AgentState; result: StepResult }> {
  const registry = toolRegistry ?? ctx.toolRegistry;
  let currentExecState = createExecutionState();
  const stepIdx = stepNumber ?? 0;

  let currentState = state;
  let stepTokens = { input: 0, output: 0 };
  while (!isTerminalPhase(currentExecState.phase)) {
    if (options?.signal?.aborted) {
      return { state: currentState, result: { type: 'abort', tokens: stepTokens } };
    }
    const fromPhase = currentExecState.phase;

    // ── beforeAdvance ──
    if (middlewareExecutor) {
      const chain = await middlewareExecutor.runBeforeAdvance({
        state: currentState,
        execState: currentExecState,
        fromPhase,
        stepNumber: stepIdx,
        runnerOptions: runnerOptions!,
      });
      if (chain.stopResult) {
        return {
          state: currentState,
          result: { type: 'error', error: new Error('Stopped by middleware'), tokens: stepTokens },
        };
      }
      if (chain.state) currentState = chain.state;
      if (chain.execState) currentExecState = chain.execState;
    }

    let result: AdvanceResult;
    try {
      result = yield* ctx.phaseRouter.executeStream(
        ctx,
        currentState,
        currentExecState,
        registry,
        options
      );
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      const nextExec = updateExecState(currentExecState, (draft) => {
        draft.phase = { type: 'error', error: errorObj };
      });
      currentExecState = nextExec;
      yield { type: 'error', error: errorObj, context: { step: 0 }, timestamp: Date.now() };
      return {
        state: currentState,
        result: { type: 'error', error: errorObj, tokens: stepTokens },
      };
    }

    currentExecState = result.execState;

    if (result.tokens) {
      stepTokens = addTokenStats(stepTokens, result.tokens);
      result = { ...result, state: updateTotalTokens(result.state, result.tokens) };
    }

    if (result.estimatedContextSize !== undefined) {
      result = {
        ...result,
        state: updateState(result.state, (draft) => {
          draft.context.estimatedContextSize = result.estimatedContextSize;
        }),
      };
    }

    if (options?.signal?.aborted) {
      return { state: result.state, result: { type: 'abort', tokens: stepTokens } };
    }

    // ── afterAdvance ──
    if (middlewareExecutor) {
      const chain = await middlewareExecutor.runAfterAdvance({
        state: result.state,
        execState: result.execState,
        result,
        stepNumber: stepIdx,
        runnerOptions: runnerOptions!,
      });
      if (chain.stopResult) {
        return {
          state: result.state,
          result: { type: 'error', error: new Error('Stopped by middleware'), tokens: stepTokens },
        };
      }
      if (chain.state) result = { ...result, state: chain.state };
      if (chain.execState) result = { ...result, execState: chain.execState };
      currentExecState = result.execState;
    }

    currentState = await maybeCompress(compressor, result.state);

    // Emit tool events based on phase transitions
    if (result.phase.type === 'executing-tool') {
      if (result.phase.actions.length === 1) {
        yield { type: 'tool:start', action: result.phase.actions[0], timestamp: Date.now() };
      } else {
        yield { type: 'tools:start', actions: result.phase.actions, timestamp: Date.now() };
      }
    }

    // Forward effects produced by handler
    if (result.effects && result.effects.length > 0) {
      for (const effect of result.effects) {
        yield effect as StreamEvent;
      }
    }

    yield { type: 'phase-change', from: fromPhase, to: result.phase, timestamp: Date.now() };

    // Control flow is determined by phase + done
    if (result.done && result.phase.type === 'completed') {
      return {
        state: currentState,
        result: { type: 'done', answer: result.phase.answer, tokens: stepTokens },
      };
    }

    if (result.done && result.phase.type === 'error') {
      yield {
        type: 'error',
        error: result.phase.error,
        context: { step: 0 },
        timestamp: Date.now(),
      };
      return {
        state: currentState,
        result: { type: 'error', error: result.phase.error, tokens: stepTokens },
      };
    }

    // ToolResultHandler has processed tool-result phase (effects indicate processed)
    if (result.phase.type === 'tool-result' && result.effects && result.effects.length > 0) {
      // same-skill/cyclic/plain tool → return continue
      const actions =
        currentExecState.allActions ?? (currentExecState.action ? [currentExecState.action] : []);
      return {
        state: currentState,
        result: {
          type: 'continue',
          toolResult: currentExecState.toolResult,
          actions,
          tokens: stepTokens,
        },
      };
    }

    // ExecutingToolHandler returned tool-result (no effects) → continue loop for ToolResultHandler
    if (result.phase.type === 'tool-result' && (!result.effects || result.effects.length === 0)) {
      continue;
    }

    // Skill loaded/returned → phase reset to idle, continue loop
    if (result.phase.type === 'idle') {
      continue;
    }
  }

  // Should not reach here: all terminal phases are handled inside the loop body
  throw new Error('Unexpected: stepStream loop exited without reaching terminal phase');
}
