/**
 * @fileoverview Parsing Phase Handler
 *
 * Transitions from parsing to parsed. Extracts explicit thinking from
 * execState.llmThinking (native) or execState.llmResponse (thinking tags),
 * cleans the content, and sets both execState.thought and execState.cleanedContent.
 */

import type { IPhaseHandler, PhaseHandlerContext } from '../types.js';
import type { AgentState } from '../../types.js';
import type { ExecutionState, AdvanceResult } from '../../execution/index.js';
import { updateExecState } from '../../execution/index.js';
import { extractThinkingAndContent } from '../../parser/index.js';

export class ParsingHandler implements IPhaseHandler {
  canHandle(phaseType: string): boolean {
    return phaseType === 'parsing';
  }

  execute(_ctx: PhaseHandlerContext, state: AgentState, execState: ExecutionState): AdvanceResult {
    const rawContent = execState.llmResponse ?? '';
    const nativeThinking = execState.llmThinking ?? '';

    const { thought, cleanedContent } = extractThinkingAndContent(rawContent, nativeThinking);

    const action = execState.action;
    const nextExec = updateExecState(execState, (draft) => {
      draft.thought = thought;
      draft.cleanedContent = cleanedContent;
      if (action) {
        draft.phase = { type: 'parsed', thought, action };
      } else {
        draft.phase = { type: 'parsed', thought };
      }
    });

    return { state, execState: nextExec, phase: nextExec.phase, done: false };
  }
}
