/**
 * @fileoverview Parsing Phase Handler
 *
 * Transitions from parsing to parsed. Extracts thought from execState.llmResponse.
 */

import type { IPhaseHandler, PhaseHandlerContext } from '../types.js';
import type { AgentState } from '../../types.js';
import type { ExecutionState, AdvanceResult } from '../../execution.js';

export class ParsingHandler implements IPhaseHandler {
  canHandle(phaseType: string): boolean {
    return phaseType === 'parsing';
  }

  execute(_ctx: PhaseHandlerContext, state: AgentState, execState: ExecutionState): AdvanceResult {
    execState.phase = { type: 'parsing' };
    return { state, phase: execState.phase, done: false };
  }
}
