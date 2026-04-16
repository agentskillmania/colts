/**
 * @fileoverview LLM-Response Phase Handler
 *
 * Transitions from llm-response to parsing. A simple passthrough phase.
 */

import type { IPhaseHandler, PhaseHandlerContext } from '../types.js';
import type { AgentState } from '../../types.js';
import type { ExecutionState, AdvanceResult } from '../../execution.js';

export class LLMResponseHandler implements IPhaseHandler {
  canHandle(phaseType: string): boolean {
    return phaseType === 'llm-response';
  }

  execute(_ctx: PhaseHandlerContext, state: AgentState, execState: ExecutionState): AdvanceResult {
    execState.phase = { type: 'parsing' };
    return { state, phase: execState.phase, done: false };
  }
}
