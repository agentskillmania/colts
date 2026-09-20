/**
 * @fileoverview Idle Phase Handler
 *
 * First phase in every ReAct cycle. Assembles messages using
 * IMessageAssembler and stores them in execState. Transitions
 * to preparing phase.
 */

import { contentToPlainText } from '@agentskillmania/llm-client';

import type { ExecutionState, AdvanceResult } from '../../execution/index.js';
import { updateExecState } from '../../execution/index.js';
import type { AgentState, Message as LocalMessage, MessageRole } from '../../types.js';
import type { IPhaseHandler, PhaseHandlerContext } from '../types.js';

export class IdleHandler implements IPhaseHandler {
  canHandle(phaseType: string): boolean {
    return phaseType === 'idle';
  }

  async execute(
    ctx: PhaseHandlerContext,
    state: AgentState,
    execState: ExecutionState
  ): Promise<AdvanceResult> {
    const messages = await ctx.messageAssembler.build(state, {
      systemPrompt: ctx.options.systemPrompt,
      model: ctx.options.model,
      skillProvider: ctx.skillProvider,
    });
    const displayMessages: LocalMessage[] = messages.map((m) => ({
      id: globalThis.crypto.randomUUID(),
      role: m.role as MessageRole,
      // Multimodal parts degrade to plain text (image → "[image]") — the
      // display payload must never carry base64. (R2P-107.)
      content: contentToPlainText(m.content),
      timestamp: Date.now(),
    }));
    const nextExec = updateExecState(execState, (draft) => {
      draft.preparedMessages = messages;
      draft.phase = { type: 'preparing', messages: displayMessages };
    });
    return { state, execState: nextExec, phase: nextExec.phase, done: false };
  }
}
