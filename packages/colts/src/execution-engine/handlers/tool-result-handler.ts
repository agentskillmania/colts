/**
 * @fileoverview Tool-Result Phase Handler
 *
 * Transitions from tool-result to completed. If this is a direct
 * transition (no prior tool result), writes final answer to state.
 */

import type { IPhaseHandler, PhaseHandlerContext } from '../types.js';
import type { AgentState } from '../../types.js';
import type { ExecutionState, AdvanceResult } from '../../execution.js';

export class ToolResultHandler implements IPhaseHandler {
  canHandle(phaseType: string): boolean {
    return phaseType === 'tool-result';
  }

  execute(_ctx: PhaseHandlerContext, state: AgentState, execState: ExecutionState): AdvanceResult {
    // Fallback chain: thought (set by ParsingHandler) → llmResponse (set by CallingLLMHandler) → empty
    const answer = execState.thought ?? execState.llmResponse ?? '';
    execState.phase = { type: 'completed', answer };
    // tool-result → completed: messages already written (thought + tool message), don't duplicate
    return { state, phase: execState.phase, done: true };
  }
}
