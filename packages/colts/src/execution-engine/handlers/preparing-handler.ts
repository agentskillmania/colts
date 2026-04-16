/**
 * @fileoverview Preparing Phase Handler
 *
 * Transitions from preparing to calling-llm. Messages were already
 * assembled by IdleHandler.
 *
 * Migrated from advanceToCallingLLM() in runner-advance.ts.
 */

import type { IPhaseHandler, PhaseHandlerContext } from '../types.js';
import type { AgentState } from '../../types.js';
import type { ExecutionState, AdvanceResult } from '../../execution.js';

export class PreparingHandler implements IPhaseHandler {
  canHandle(phaseType: string): boolean {
    return phaseType === 'preparing';
  }

  execute(_ctx: PhaseHandlerContext, state: AgentState, execState: ExecutionState): AdvanceResult {
    execState.phase = { type: 'calling-llm' };
    return { state, phase: execState.phase, done: false };
  }
}
