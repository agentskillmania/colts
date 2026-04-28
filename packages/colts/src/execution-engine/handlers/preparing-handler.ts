/**
 * @fileoverview Preparing Phase Handler
 *
 * Transitions from preparing to calling-llm. Messages were already
 * assembled by IdleHandler.
 */

import type { IPhaseHandler, PhaseHandlerContext } from '../types.js';
import type { AgentState } from '../../types.js';
import type { ExecutionState, AdvanceResult } from '../../execution/index.js';
import { updateExecState } from '../../execution/index.js';

export class PreparingHandler implements IPhaseHandler {
  canHandle(phaseType: string): boolean {
    return phaseType === 'preparing';
  }

  execute(_ctx: PhaseHandlerContext, state: AgentState, execState: ExecutionState): AdvanceResult {
    const nextExec = updateExecState(execState, (draft) => {
      draft.phase = { type: 'calling-llm' };
    });
    return { state, execState: nextExec, phase: nextExec.phase, done: false };
  }
}
