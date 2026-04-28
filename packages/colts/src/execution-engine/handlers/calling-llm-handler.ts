/**
 * @fileoverview Calling-LLM Phase Handler
 *
 * Calls the LLM provider with prepared messages and parses the response.
 * Extracts tool calls into actions. Transitions to llm-response phase.
 */

import type { IPhaseHandler, PhaseHandlerContext } from '../types.js';
import type { AgentState, IToolRegistry } from '../../types.js';
import type { ExecutionState, AdvanceResult, AdvanceOptions } from '../../execution/index.js';
import { updateExecState, toolCallToAction } from '../../execution/index.js';
import { getToolsForLLM } from '../../tools/llm-format.js';
import { estimateTokens } from '../../utils/tokens.js';

export class CallingLLMHandler implements IPhaseHandler {
  canHandle(phaseType: string): boolean {
    return phaseType === 'calling-llm';
  }

  async execute(
    ctx: PhaseHandlerContext,
    state: AgentState,
    execState: ExecutionState,
    toolRegistry?: IToolRegistry,
    options?: AdvanceOptions
  ): Promise<AdvanceResult> {
    const registry = toolRegistry ?? ctx.toolRegistry;
    const tools = getToolsForLLM(registry, ctx.toolSchemaFormatter);

    const response = await ctx.llmProvider.call({
      model: ctx.options.model,
      messages:
        execState.preparedMessages ??
        ctx.messageAssembler.build(state, {
          systemPrompt: ctx.options.systemPrompt,
          model: ctx.options.model,
          skillProvider: ctx.skillProvider,
          enablePromptThinking: ctx.options.enablePromptThinking,
        }),
      tools,
      priority: 0,
      requestTimeout: ctx.options.requestTimeout,
      thinkingEnabled: ctx.options.thinkingEnabled,
      signal: options?.signal,
    });

    const responseText = response.content ?? '';

    // Estimate context size from prepared messages
    const preparedMessages =
      execState.preparedMessages ??
      ctx.messageAssembler.build(state, {
        systemPrompt: ctx.options.systemPrompt,
        model: ctx.options.model,
        skillProvider: ctx.skillProvider,
        enablePromptThinking: ctx.options.enablePromptThinking,
      });
    const estimatedContextSize = preparedMessages.reduce(
      (sum, m) =>
        sum + estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)),
      0
    );

    // Parse tool calls, handling parse errors via execution policy
    let parsedAction: import('../../execution/index.js').Action | undefined;
    let parsedAllActions: import('../../execution/index.js').Action[] | undefined;
    let fallbackResponseText = responseText;

    if (response.toolCalls && response.toolCalls.length > 0) {
      try {
        parsedAction = toolCallToAction(response.toolCalls[0]);
        parsedAllActions = response.toolCalls.map(toolCallToAction);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const decision = await ctx.executionPolicy.onParseError(err, responseText, state, {
          retryCount: 0,
        });
        if (decision.decision === 'ignore') {
          fallbackResponseText = decision.fallbackText;
        } else {
          throw decision.error;
        }
      }
    }

    const nextExec = updateExecState(execState, (draft) => {
      draft.llmResponse = fallbackResponseText;
      draft.llmThinking = response.thinking ?? '';
      draft.action = parsedAction;
      draft.allActions = parsedAllActions;
      draft.phase = { type: 'llm-response', response: fallbackResponseText };
    });

    return {
      state,
      execState: nextExec,
      phase: nextExec.phase,
      done: false,
      tokens: response.tokens,
      estimatedContextSize,
    };
  }
}
