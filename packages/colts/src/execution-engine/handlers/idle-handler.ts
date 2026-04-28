/**
 * @fileoverview Idle Phase Handler
 *
 * First phase in every ReAct cycle. Assembles messages using
 * IMessageAssembler and stores them in execState. Transitions
 * to preparing phase.
 */

import type { IPhaseHandler, PhaseHandlerContext } from '../types.js';
import type { AgentState, Message as LocalMessage, MessageRole } from '../../types.js';
import type { ExecutionState, AdvanceResult } from '../../execution/index.js';
import { updateExecState } from '../../execution/index.js';

export class IdleHandler implements IPhaseHandler {
  canHandle(phaseType: string): boolean {
    return phaseType === 'idle';
  }

  execute(ctx: PhaseHandlerContext, state: AgentState, execState: ExecutionState): AdvanceResult {
    const messages = ctx.messageAssembler.build(state, {
      systemPrompt: ctx.options.systemPrompt,
      model: ctx.options.model,
      skillProvider: ctx.skillProvider,
      subAgentConfigs: ctx.subAgentConfigs,
    });
    const displayMessages: LocalMessage[] = messages.map((m) => ({
      role: m.role as MessageRole,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      timestamp: Date.now(),
    }));
    const nextExec = updateExecState(execState, (draft) => {
      draft.preparedMessages = messages;
      draft.phase = { type: 'preparing', messages: displayMessages };
    });
    return { state, execState: nextExec, phase: nextExec.phase, done: false };
  }
}
