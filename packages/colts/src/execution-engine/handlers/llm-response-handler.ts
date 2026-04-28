/**
 * @fileoverview LLM-Response Phase Handler
 *
 * Transitions from llm-response to parsing. A simple passthrough phase.
 */

import type { IPhaseHandler, PhaseHandlerContext } from '../types.js';
import type { AgentState } from '../../types.js';
import type { ExecutionState, AdvanceResult } from '../../execution/index.js';
import { updateExecState } from '../../execution/index.js';

export class LLMResponseHandler implements IPhaseHandler {
  canHandle(phaseType: string): boolean {
    return phaseType === 'llm-response';
  }

  execute(_ctx: PhaseHandlerContext, state: AgentState, execState: ExecutionState): AdvanceResult {
    const nextExec = updateExecState(execState, (draft) => {
      draft.phase = { type: 'parsing' };
    });
    return { state, execState: nextExec, phase: nextExec.phase, done: false };
  }
}
