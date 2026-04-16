/**
 * @fileoverview Completed Phase Handler
 *
 * Terminal phase. Returns done=true with current state unchanged.
 */

import type { IPhaseHandler, PhaseHandlerContext } from '../types.js';
import type { AgentState } from '../../types.js';
import type { ExecutionState, AdvanceResult } from '../../execution.js';

export class CompletedHandler implements IPhaseHandler {
  canHandle(phaseType: string): boolean {
    return phaseType === 'completed';
  }

  execute(_ctx: PhaseHandlerContext, state: AgentState, execState: ExecutionState): AdvanceResult {
    return { state, phase: execState.phase, done: true };
  }
}
