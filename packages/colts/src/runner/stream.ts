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
  StreamEvent,
  AdvanceOptions,
} from '../execution/index.js';
import { updateExecState } from '../execution/index.js';
import type { RunnerContext } from './advance.js';

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
