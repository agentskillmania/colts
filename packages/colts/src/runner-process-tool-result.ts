/**
 * @fileoverview Shared Tool-Result Post-Processing
 *
 * Extracts the tool-result handling logic that was duplicated between
 * blocking (step) and streaming (executeStepStream) paths.
 *
 * Produces a pure-data effect list ({@link ToolPostEffect}[]) so that
 * both consumers can drive identical behaviour without duplicating
 * the skill-signal switch, delegate event wrapping, or phase resets.
 *
 * Called by:
 * - {@link step} (blocking path)
 * - {@link executeStepStream} (streaming path)
 *
 * NOT called by advance() (micro-step API) which retains the original
 * advanceToCompleted path because its "single phase push" model is
 * incompatible with the multi-effect, loop-continuation semantics here.
 */

import type { AgentState, IToolRegistry } from './types.js';
import type { ExecutionState } from './execution.js';
import { isSkillSignal, type SkillSignal } from './skills/types.js';
import {
  applySkillSignal,
  formatSkillToolResult,
  formatSkillAnswer,
} from './skills/signal-handler.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Describes a single side-effect that must be emitted or acted upon
 * after a tool result is processed.
 *
 * Consumers (step / executeStepStream) iterate the array and:
 * - yield / emit lifecycle events (skill:start, tool:end, subagent:end, ...)
 * - inspect the `step:*` control effects to decide whether to continue
 *   the inner loop or return a {@link StepResult}.
 */
export type ToolPostEffect =
  // Skill lifecycle
  | { type: 'skill:start'; name: string; task: string; state: AgentState }
  | { type: 'skill:end'; name: string; result: string; state: AgentState }
  // SubAgent lifecycle
  | { type: 'subagent:start'; name: string; task: string }
  | { type: 'subagent:end'; name: string; result: unknown }
  // Tool completion
  | { type: 'tool:end'; result: unknown }
  // Error
  | { type: 'error'; error: Error; context: { step: number } }
  // Step control
  | { type: 'step:continue' }
  | { type: 'step:done'; answer: string }
  | { type: 'step:continue-return'; toolResult: unknown }
  | { type: 'step:error'; error: Error };

/**
 * Return type of {@link processToolResult}.
 *
 * `state` is the (possibly updated) AgentState after skill-signal mutations.
 * `effects` is the ordered list of side-effects the caller must process.
 */
export interface ToolResultOutcome {
  /** Updated agent state (may differ from input when skill signals fire) */
  state: AgentState;
  /** Ordered side-effects the caller must emit / act on */
  effects: ToolPostEffect[];
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Process a tool-result phase, producing side-effects and state changes.
 *
 * Handles three categories:
 * 1. **Skill signals** - updates skillState via applySkillSignal, emits
 *    skill:start / skill:end, and decides step control flow.
 * 2. **Delegate tools** - wraps tool:end with subagent:start / subagent:end.
 * 3. **Plain tools** - emits tool:end and returns a continue step result.
 *
 * This function may **directly mutate** `execState.phase` (e.g. reset to
 * `idle`) to preserve behavioural equivalence with the original streaming
 * path.  This matches the convention of all `advanceToXxx` helpers in
 * `runner-advance.ts`.
 *
 * @param state - Current agent state
 * @param execState - Execution state (phase must be `tool-result`)
 * @param registry - Tool registry (unused currently, reserved for future use)
 * @returns Updated state and ordered effects
 */
export async function processToolResult(
  state: AgentState,
  execState: ExecutionState,
  _registry?: IToolRegistry
): Promise<ToolResultOutcome> {
  const effects: ToolPostEffect[] = [];
  const phase = execState.phase;

  if (phase.type !== 'tool-result') {
    throw new Error('processToolResult expects phase type "tool-result"');
  }

  const result = phase.result;
  const action = execState.action;
  let currentState = state;

  // 1. Detect delegate tool - always emit subagent:start regardless of
  //    whether the result is also a skill signal.
  const isDelegate = action?.tool === 'delegate';
  if (isDelegate) {
    const agentName = String(action!.arguments.agent ?? '');
    const taskDesc = String(action!.arguments.task ?? '');
    effects.push({ type: 'subagent:start', name: agentName, task: taskDesc });
  }

  // 2. Skill signal handling
  if (isSkillSignal(result)) {
    const [newState, sigResult] = applySkillSignal(currentState, result as SkillSignal);
    currentState = newState;

    switch (sigResult.action) {
      case 'loaded': {
        effects.push({
          type: 'skill:start',
          name: sigResult.skillName,
          task: (result as SkillSignal & { task?: string }).task ?? '',
          state: currentState,
        });
        effects.push({ type: 'tool:end', result: formatSkillToolResult(result) });
        effects.push({ type: 'step:continue' });
        // P0: Direct mutation to preserve equivalence with streaming path.
        // TODO(M1): Revisit when ExecutionState becomes fully immutable.
        execState.phase = { type: 'idle' };
        break;
      }

      case 'returned': {
        effects.push({
          type: 'skill:end',
          name: sigResult.completedSkill,
          result: (result as SkillSignal & { result: string }).result,
          state: currentState,
        });
        effects.push({ type: 'tool:end', result: formatSkillToolResult(result) });
        effects.push({ type: 'step:continue' });
        // P0: Direct mutation to preserve equivalence with streaming path.
        // TODO(M1): Revisit when ExecutionState becomes fully immutable.
        execState.phase = { type: 'idle' };
        break;
      }

      case 'top-level-return': {
        effects.push({
          type: 'skill:end',
          name: sigResult.skillName,
          result: (result as SkillSignal & { result: string }).result,
          state: currentState,
        });
        effects.push({ type: 'tool:end', result: formatSkillToolResult(result) });
        effects.push({ type: 'step:done', answer: formatSkillAnswer(result) });
        break;
      }

      case 'same-skill': {
        effects.push({
          type: 'tool:end',
          result: `Skill '${sigResult.currentSkill}' is already active`,
        });
        effects.push({ type: 'step:continue-return', toolResult: result });
        break;
      }

      case 'cyclic': {
        effects.push({
          type: 'tool:end',
          result: `Cannot load Skill '${sigResult.currentSkill}': already in the call stack`,
        });
        effects.push({ type: 'step:continue-return', toolResult: result });
        break;
      }

      case 'not-found': {
        effects.push({ type: 'error', error: sigResult.error, context: { step: 0 } });
        effects.push({ type: 'step:error', error: sigResult.error });
        break;
      }
    }

    // Emit subagent:end after skill-signal processing for delegate tools
    if (isDelegate) {
      const agentName = String(action!.arguments.agent ?? '');
      effects.push({ type: 'subagent:end', name: agentName, result });
    }

    return { state: currentState, effects };
  }

  // 3. Plain tool result (not a skill signal)
  effects.push({ type: 'tool:end', result });

  if (isDelegate) {
    const agentName = String(action!.arguments.agent ?? '');
    effects.push({ type: 'subagent:end', name: agentName, result });
  }

  effects.push({ type: 'step:continue-return', toolResult: result });
  return { state: currentState, effects };
}
