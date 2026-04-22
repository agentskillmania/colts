/**
 * @fileoverview Calling-LLM Phase Handler
 *
 * Calls the LLM provider with prepared messages and parses the response.
 * Extracts tool calls into actions. Transitions to llm-response phase.
 */

import type { IPhaseHandler, PhaseHandlerContext } from '../types.js';
import type { AgentState, IToolRegistry } from '../../types.js';
import type { ExecutionState, AdvanceResult, AdvanceOptions } from '../../execution.js';
import { toolCallToAction } from '../../execution.js';
import { getToolsForLLM } from '../../tools/llm-format.js';

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
    execState.llmResponse = responseText;
    execState.llmThinking = response.thinking ?? ''; // Preserve native thinking from the LLM API

    if (response.toolCalls && response.toolCalls.length > 0) {
      try {
        const toolCall = response.toolCalls[0];
        execState.action = toolCallToAction(toolCall);
        execState.allActions = response.toolCalls.map(toolCallToAction);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const decision = await ctx.executionPolicy.onParseError(err, responseText, state, {
          retryCount: 0,
        });
        if (decision.decision === 'ignore') {
          // Replace original LLM response with fallbackText and continue as plain text
          execState.llmResponse = decision.fallbackText;
          execState.action = undefined;
          execState.allActions = undefined;
        } else {
          throw decision.error;
        }
      }
    } else {
      execState.action = undefined;
      execState.allActions = undefined;
    }

    execState.phase = { type: 'llm-response', response: responseText };
    return { state, phase: execState.phase, done: false };
  }
}
