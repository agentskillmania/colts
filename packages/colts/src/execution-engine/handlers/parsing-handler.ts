/**
 * @fileoverview Parsing Phase Handler
 *
 * Transitions from parsing to parsed. Extracts explicit thinking from
 * execState.llmThinking (native) or execState.llmResponse (<think> tags),
 * cleans the content, and sets both execState.thought and execState.cleanedContent.
 */

import type { IPhaseHandler, PhaseHandlerContext } from '../types.js';
import type { AgentState } from '../../types.js';
import type { ExecutionState, AdvanceResult } from '../../execution.js';
import { extractThinkingAndContent } from '../../parser.js';

export class ParsingHandler implements IPhaseHandler {
  canHandle(phaseType: string): boolean {
    return phaseType === 'parsing';
  }

  execute(_ctx: PhaseHandlerContext, state: AgentState, execState: ExecutionState): AdvanceResult {
    const rawContent = execState.llmResponse ?? '';
    const nativeThinking = execState.llmThinking ?? '';

    const { thought, cleanedContent } = extractThinkingAndContent(rawContent, nativeThinking);

    execState.thought = thought;
    execState.cleanedContent = cleanedContent;

    if (execState.action) {
      execState.phase = { type: 'parsed', thought, action: execState.action };
    } else {
      execState.phase = { type: 'parsed', thought };
    }

    return { state, phase: execState.phase, done: false };
  }
}
