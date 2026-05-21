/**
 * @fileoverview Calling-LLM Phase Handler
 *
 * Calls the LLM provider with prepared messages and parses the response.
 * Supports both blocking (call) and streaming (stream) paths.
 * Extracts tool calls into actions. Transitions to llm-response phase.
 */

import type { IPhaseHandler, PhaseHandlerContext } from '../types.js';
import type { AgentState, IToolRegistry } from '../../types.js';
import type {
  ExecutionState,
  AdvanceResult,
  AdvanceOptions,
  StreamEvent,
  Action,
} from '../../execution/index.js';
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
    const { tools, messages, estimatedContextSize } = this.prepare(ctx, state, execState, registry);

    const response = await ctx.llmProvider.call({
      model: ctx.options.model,
      messages,
      tools,
      priority: 0,
      requestTimeout: ctx.options.requestTimeout,
      thinkingEnabled: ctx.options.thinkingEnabled,
      signal: options?.signal,
    });

    const responseText = response.content ?? '';

    const { parsedAction, parsedAllActions, fallbackText } = await this.parseToolCalls(
      ctx,
      responseText,
      response.toolCalls ?? undefined,
      state
    );

    const nextExec = this.buildNextExec(
      execState,
      fallbackText,
      response.thinking ?? '',
      parsedAction,
      parsedAllActions,
      estimatedContextSize,
      response.tokens
    );

    return {
      state,
      execState: nextExec,
      phase: nextExec.phase,
      done: false,
      tokens: response.tokens,
      estimatedContextSize,
    };
  }

  async *streamExecute(
    ctx: PhaseHandlerContext,
    state: AgentState,
    execState: ExecutionState,
    toolRegistry?: IToolRegistry,
    options?: AdvanceOptions
  ): AsyncGenerator<StreamEvent, AdvanceResult> {
    const registry = toolRegistry ?? ctx.toolRegistry;
    const { tools, messages, estimatedContextSize } = this.prepare(ctx, state, execState, registry);
    const signal = options?.signal;

    // Yield llm:request event before LLM call
    yield {
      type: 'llm:request',
      messages: messages.map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
      tools: tools?.map((t) => t.name) ?? [],
      skill: state.context.skillState
        ? {
            current: state.context.skillState.current,
            stack: state.context.skillState.stack.map((f) => f.skillName),
          }
        : null,
      timestamp: Date.now(),
    };

    let accumulatedContent = '';
    let accumulatedThinking = '';
    let responseToolCalls:
      | Array<{ id: string; name: string; arguments: Record<string, unknown> }>
      | undefined;
    let roundTokens: import('../../types.js').TokenStats | undefined;

    try {
      for await (const event of ctx.llmProvider.stream({
        model: ctx.options.model,
        messages,
        tools,
        priority: 0,
        requestTimeout: ctx.options.requestTimeout,
        thinkingEnabled: ctx.options.thinkingEnabled,
        signal,
      })) {
        if (signal?.aborted) break;

        if (event.type === 'text') {
          accumulatedContent = event.accumulatedContent ?? accumulatedContent + (event.delta ?? '');
          yield { type: 'token', token: event.delta ?? '', timestamp: Date.now() };
        } else if (event.type === 'thinking') {
          accumulatedThinking += event.delta ?? '';
          yield { type: 'thinking', content: event.delta ?? '', timestamp: Date.now() };
        } else if (event.type === 'tool_call' && event.toolCall) {
          responseToolCalls = responseToolCalls ?? [];
          responseToolCalls.push({
            id: event.toolCall.id,
            name: event.toolCall.name,
            arguments: event.toolCall.arguments,
          });
        } else if (event.type === 'done') {
          if (event.roundTotalTokens) {
            roundTokens = event.roundTotalTokens;
          }
        }
      }
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      yield { type: 'error', error: errorObj, context: { step: 0 }, timestamp: Date.now() };
      const nextExec = updateExecState(execState, (draft) => {
        draft.phase = { type: 'error', error: errorObj };
      });
      return { state, execState: nextExec, phase: nextExec.phase, done: true };
    }

    // Guard: if aborted, return current execState unchanged
    if (signal?.aborted) {
      return {
        state,
        execState,
        phase: execState.phase,
        done: false,
      };
    }

    const finalResponse = accumulatedContent;

    // Yield llm:response event after LLM response
    yield {
      type: 'llm:response',
      text: finalResponse,
      toolCalls: responseToolCalls ?? null,
      timestamp: Date.now(),
    };

    const { parsedAction, parsedAllActions, fallbackText } = await this.parseToolCalls(
      ctx,
      finalResponse,
      responseToolCalls,
      state
    );

    const nextExec = this.buildNextExec(
      execState,
      fallbackText,
      accumulatedThinking,
      parsedAction,
      parsedAllActions,
      estimatedContextSize,
      roundTokens
    );

    return {
      state,
      execState: nextExec,
      phase: nextExec.phase,
      done: false,
      tokens: roundTokens,
      estimatedContextSize,
    };
  }

  // ── Shared helpers ──

  private prepare(
    ctx: PhaseHandlerContext,
    state: AgentState,
    execState: ExecutionState,
    registry: IToolRegistry
  ): {
    tools: ReturnType<typeof getToolsForLLM>;
    messages: import('@mariozechner/pi-ai').Message[];
    estimatedContextSize: number;
  } {
    const tools = getToolsForLLM(registry, ctx.toolSchemaFormatter);
    const messages =
      execState.preparedMessages ??
      ctx.messageAssembler.build(state, {
        systemPrompt: ctx.options.systemPrompt,
        model: ctx.options.model,
        skillProvider: ctx.skillProvider,
        enablePromptThinking: ctx.options.enablePromptThinking,
      });

    const estimatedContextSize = messages.reduce(
      (sum, m) =>
        sum + estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)),
      0
    );

    return { tools, messages, estimatedContextSize };
  }

  private async parseToolCalls(
    ctx: PhaseHandlerContext,
    responseText: string,
    toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> | undefined,
    state: AgentState
  ): Promise<{
    parsedAction: Action | undefined;
    parsedAllActions: Action[] | undefined;
    fallbackText: string;
  }> {
    let parsedAction: Action | undefined;
    let parsedAllActions: Action[] | undefined;
    let fallbackText = responseText;

    if (toolCalls && toolCalls.length > 0) {
      try {
        parsedAction = toolCallToAction(toolCalls[0]);
        parsedAllActions = toolCalls.map(toolCallToAction);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const decision = await ctx.executionPolicy.onParseError(err, responseText, state, {
          retryCount: 0,
        });
        if (decision.decision === 'ignore') {
          fallbackText = decision.fallbackText;
        } else {
          throw decision.error;
        }
      }
    }

    return { parsedAction, parsedAllActions, fallbackText };
  }

  private buildNextExec(
    execState: ExecutionState,
    fallbackText: string,
    thinking: string,
    parsedAction: Action | undefined,
    parsedAllActions: Action[] | undefined,
    estimatedContextSize: number,
    tokens?: import('../../types.js').TokenStats
  ): ExecutionState {
    return updateExecState(execState, (draft) => {
      draft.llmResponse = fallbackText;
      draft.llmThinking = thinking;
      draft.estimatedContextSize = estimatedContextSize;
      if (tokens) {
        draft.tokens = tokens;
      }
      if (parsedAction) {
        draft.action = parsedAction;
        draft.allActions = parsedAllActions;
      } else {
        draft.action = undefined;
        draft.allActions = undefined;
      }
      draft.phase = { type: 'llm-response', response: fallbackText };
    });
  }
}
