/**
 * @fileoverview Parsed Phase Handler
 *
 * Transitions from parsed to either executing-tool (if action exists)
 * or completed (if no action). Writes explicit thinking as a separate
 * thought message when present, and the cleaned content as an action
 * or text message.
 */

import type { IPhaseHandler, PhaseHandlerContext } from '../types.js';
import type { AgentState } from '../../types.js';
import type { ExecutionState, AdvanceResult } from '../../execution/index.js';
import { updateExecState } from '../../execution/index.js';
import { addAssistantMessage, incrementStepCount } from '../../state/index.js';

export class ParsedHandler implements IPhaseHandler {
  canHandle(phaseType: string): boolean {
    return phaseType === 'parsed';
  }

  execute(_ctx: PhaseHandlerContext, state: AgentState, execState: ExecutionState): AdvanceResult {
    const thought = execState.thought ?? '';
    const cleanedContent = execState.cleanedContent ?? execState.llmResponse ?? '';

    if (execState.action) {
      // Has action: write explicit thinking message (if any), then action message
      let newState = state;

      if (thought) {
        newState = addAssistantMessage(newState, thought, { type: 'thought' });
      }

      const toolCalls = execState.allActions?.map((a) => ({
        id: a.id,
        name: a.tool,
        arguments: a.arguments,
      }));

      newState = addAssistantMessage(newState, cleanedContent, {
        type: 'action',
        toolCalls,
      });

      // Pass all actions to executing-tool phase for parallel execution
      const actions = execState.allActions ?? [execState.action];
      const nextExec = updateExecState(execState, (draft) => {
        draft.phase = { type: 'executing-tool', actions };
      });
      return { state: newState, execState: nextExec, phase: nextExec.phase, done: false };
    } else {
      // No action: write explicit thinking message (if any), then text message
      let newState = state;

      if (thought) {
        newState = addAssistantMessage(newState, thought, { type: 'thought' });
      }

      newState = addAssistantMessage(newState, cleanedContent, { type: 'text' });
      newState = incrementStepCount(newState);

      const nextExec = updateExecState(execState, (draft) => {
        draft.phase = { type: 'completed', answer: cleanedContent };
      });
      return { state: newState, execState: nextExec, phase: nextExec.phase, done: true };
    }
  }
}
