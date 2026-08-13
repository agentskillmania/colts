/**
 * @fileoverview Calling-LLM Phase Handler
 *
 * Calls the LLM provider with prepared messages and parses the response.
 * Supports both blocking (call) and streaming (stream) paths.
 * Extracts tool calls into actions. Transitions to llm-response phase.
 */

import type { Message } from '@agentskillmania/llm-client';

import type {
  ExecutionState,
  AdvanceResult,
  AdvanceOptions,
  Action,
} from '../../execution/index.js';
import { updateExecState, toolCallToAction } from '../../execution/index.js';
import { getToolsForLLM } from '../../tools/llm-format.js';
import type { AgentState, IToolRegistry, TokenStats } from '../../types.js';
import { estimateTokens } from '../../utils/tokens.js';
import type { IPhaseHandler, PhaseHandlerContext } from '../types.js';

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
    const { tools, messages, estimatedContextSize } = await this.prepare(
      ctx,
      state,
      execState,
      registry
    );

    const resolvedModel = options?.model ?? ctx.options.model;
    const signal = options?.signal;

    // Resolve model metadata (contextWindow) for the llm:request event so
    // downstream consumers (dashboards) know the real denominator without
    // re-reading config. getModelMeta is safe — always returns a ModelMeta.
    const modelMeta = ctx.llmProvider.getModelMeta(resolvedModel);

    // Emit llm:request event before LLM call
    ctx.emit('llm:request', {
      messages: messages.map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
      // Send name + description so dashboards can show tool tooltips.
      // (RunnerEventMap types `tools` as string[] for back-compat; consumers
      // that only read .name still work, and the description is opt-in.)
      tools: (tools?.map((t) => ({
        name: t.name,
        description: t.description,
      })) ?? []) as unknown as string[],
      skill: state.context.skillState ? { current: state.context.skillState.current } : null,
      model: resolvedModel,
      contextWindow: modelMeta.contextWindow,
      timestamp: Date.now(),
    });

    // Stream LLM response, accumulating content + emitting token events
    let accumulatedContent = '';
    let accumulatedThinking = '';
    let responseToolCalls:
      | Array<{ id: string; name: string; arguments: Record<string, unknown> }>
      | undefined;
    let roundTokens: TokenStats | undefined;

    try {
      for await (const event of ctx.llmProvider.stream({
        model: resolvedModel,
        messages,
        tools,
        requestTimeout: ctx.options.requestTimeout,
        thinkingEnabled: options?.thinkingEnabled ?? ctx.options.thinkingEnabled,
        temperature: options?.temperature ?? ctx.options.temperature,
        signal,
      })) {
        if (signal?.aborted) break;

        if (event.type === 'text') {
          accumulatedContent = event.accumulatedContent ?? accumulatedContent + (event.delta ?? '');
          ctx.emit('token', { token: event.delta ?? '', timestamp: Date.now() });
        } else if (event.type === 'thinking') {
          accumulatedThinking += event.delta ?? '';
          ctx.emit('thinking', { content: event.delta ?? '', timestamp: Date.now() });
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
        } else if (event.type === 'error') {
          // LLM 流内部错误——显式抛出，让外层 catch 统一处理（emit error + error phase），
          // 而不是静默忽略导致"空气泡"
          const rawError = (event as { error?: unknown }).error;
          const errMsg =
            typeof rawError === 'object' && rawError !== null
              ? ((rawError as { errorMessage?: string }).errorMessage ?? JSON.stringify(rawError))
              : String(rawError ?? 'LLM stream error');
          throw new Error(errMsg);
        }
      }
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      ctx.emit('error', { error: errorObj, context: { step: 0 }, timestamp: Date.now() });
      const nextExec = updateExecState(execState, (draft) => {
        draft.phase = { type: 'error', error: errorObj };
      });
      return { state, execState: nextExec, phase: nextExec.phase, done: true };
    }

    // Guard: if aborted, return current execState unchanged
    if (signal?.aborted) {
      return { state, execState, phase: execState.phase, done: false };
    }

    // Fallback estimation: when the provider did not return usage data
    // (input/output are 0), estimate locally via tiktoken so the token
    // accounting pipeline never produces silent zeros.
    if (roundTokens) {
      if (roundTokens.input === 0 && estimatedContextSize > 0) {
        roundTokens = { ...roundTokens, input: estimatedContextSize };
      }
      if (roundTokens.output === 0 && accumulatedContent) {
        roundTokens = { ...roundTokens, output: estimateTokens(accumulatedContent) };
      }
    } else {
      // No done event at all — full estimation fallback
      roundTokens = {
        input: estimatedContextSize,
        output: accumulatedContent ? estimateTokens(accumulatedContent) : 0,
        cacheRead: 0,
        cacheWrite: 0,
      };
    }

    // Emit llm:response event after accumulation
    ctx.emit('llm:response', {
      text: accumulatedContent,
      toolCalls: responseToolCalls ?? null,
      tokens: roundTokens,
      timestamp: Date.now(),
    });

    const { parsedAction, parsedAllActions, fallbackText } = await this.parseToolCalls(
      ctx,
      accumulatedContent,
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

  private async prepare(
    ctx: PhaseHandlerContext,
    state: AgentState,
    execState: ExecutionState,
    registry: IToolRegistry
  ): Promise<{
    tools: ReturnType<typeof getToolsForLLM>;
    messages: Message[];
    estimatedContextSize: number;
  }> {
    const tools = getToolsForLLM(registry, ctx.toolSchemaFormatter);
    const messages =
      execState.preparedMessages ??
      (await ctx.messageAssembler.build(state, {
        systemPrompt: ctx.options.systemPrompt,
        model: ctx.options.model,
        skillProvider: ctx.skillProvider,
        enablePromptThinking: ctx.options.enablePromptThinking,
      }));

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
    tokens?: TokenStats
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
