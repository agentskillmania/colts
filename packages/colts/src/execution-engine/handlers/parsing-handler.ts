/**
 * @fileoverview Parsing Phase Handler
 *
 * Transitions from parsing to parsed. Extracts thought from execState.llmResponse
 * and sets it in execState.thought (matches original advanceToParsed).
 */

import type { IPhaseHandler, PhaseHandlerContext } from '../types.js';
import type { AgentState } from '../../types.js';
import type { ExecutionState, AdvanceResult } from '../../execution.js';

export class ParsingHandler implements IPhaseHandler {
  canHandle(phaseType: string): boolean {
    return phaseType === 'parsing';
  }

  execute(_ctx: PhaseHandlerContext, state: AgentState, execState: ExecutionState): AdvanceResult {
    // Extract thought from LLM response (matches original advanceToParsed)
    const thought = execState.llmResponse ?? '';
    execState.thought = thought;

    if (execState.action) {
      execState.phase = { type: 'parsed', thought, action: execState.action };
    } else {
      execState.phase = { type: 'parsed', thought };
    }

    return { state, phase: execState.phase, done: false };
  }
}
