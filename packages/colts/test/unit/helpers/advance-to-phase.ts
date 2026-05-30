/**
 * @fileoverview Test helper: advance runner to a target phase
 *
 * Replaces the repeated `result = await runner.advance(result.state, result.execState)`
 * boilerplate found in 8+ test locations. Advances one step at a time until
 * the target phase is reached or execution completes.
 */

import type { AgentRunner } from '../../../src/runner/index.js';
import type { AgentState } from '../../../src/types.js';
import type { ExecutionState, AdvanceResult } from '../../../src/execution/index.js';
import type { IToolRegistry } from '../../../src/tools/registry.js';

/**
 * Advance the runner until the execution phase matches the target.
 *
 * @param runner - AgentRunner instance
 * @param state - Current agent state
 * @param execState - Current execution state
 * @param targetPhaseType - Phase type string to advance to (e.g. 'executing-tool')
 * @param registry - Optional tool registry for phases that need it
 * @param maxSteps - Safety limit (default 20)
 * @returns The AdvanceResult when target phase is reached
 * @throws Error if a terminal phase is reached before the target, or maxSteps exceeded
 */
export async function advanceToPhase(
  runner: AgentRunner,
  state: AgentState,
  execState: ExecutionState,
  targetPhaseType: string,
  registry?: IToolRegistry,
  maxSteps: number = 20
): Promise<AdvanceResult> {
  let result: AdvanceResult = { state, execState, phase: execState.phase, done: false };
  let steps = 0;

  while (result.execState.phase.type !== targetPhaseType) {
    if (result.done) {
      throw new Error(
        `advanceToPhase('${targetPhaseType}'): execution completed at phase '${result.execState.phase.type}' before reaching target`
      );
    }
    if (steps >= maxSteps) {
      throw new Error(
        `advanceToPhase('${targetPhaseType}'): exceeded ${maxSteps} steps, current phase '${result.execState.phase.type}'`
      );
    }
    result = await runner.advance(result.state, result.execState, registry);
    steps++;
  }

  return result;
}
