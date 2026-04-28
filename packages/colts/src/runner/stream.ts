/**
 * @fileoverview Streaming Execution Helpers
 *
 * Handles streaming LLM response, advance streaming, and step streaming.
 * Extracted from AgentRunner for maintainability.
 */

import type { AgentState, IToolRegistry } from '../types.js';
import type {
  AdvanceResult,
  ExecutionState,
  StepResult,
  StreamEvent,
  AdvanceOptions,
} from '../execution/index.js';
import { createExecutionState, isTerminalPhase, updateExecState } from '../execution/index.js';
import { addTokenStats, estimateTokens } from '../utils/tokens.js';
import type { RunnerContext } from './advance.js';
import { executeAdvance } from './advance.js';
import { buildMessagesFromCtx } from './advance.js';
import { getToolsForLLM } from '../tools/llm-format.js';
import { maybeCompress } from './compression.js';
import type { IContextCompressor } from '../types.js';
import type { MiddlewareExecutor } from '../middleware/executor.js';

/**
 * Stream LLM response during calling-llm phase.
 *
 * Shared between advanceStream() and stepStream() to avoid duplicate logic.
 * Yields token events in real-time and returns immutable ExecutionState
 * with the complete response.
 *
 * @param ctx - Runner context
 * @param state - Current agent state
 * @param execState - Execution state (immutable)
 * @param registry - Optional tool registry
 * @param signal - Optional abort signal
 * @yields StreamEvent token events
 * @returns New immutable ExecutionState with LLM response data
 */
export async function* streamCallingLLM(
  ctx: RunnerContext,
  state: AgentState,
  execState: ExecutionState,
  registry?: IToolRegistry,
  signal?: AbortSignal
): AsyncGenerator<StreamEvent, ExecutionState> {
  const tools = getToolsForLLM(registry, ctx.toolSchemaFormatter);
  const messages = execState.preparedMessages ?? buildMessagesFromCtx(ctx, state);

  // Yield llm:request event before LLM call, carrying the full input
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
  let responseContent = '';
  let responseToolCalls:
    | Array<{ id: string; name: string; arguments: Record<string, unknown> }>
    | undefined;
  let roundTokens: import('../types.js').TokenStats | undefined;

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
      responseContent = accumulatedContent;
      if (event.roundTotalTokens) {
        roundTokens = event.roundTotalTokens;
      }
    }
  }

  // Guard: if aborted, do not return mutated state
  if (signal?.aborted) {
    return execState;
  }

  // Estimate context size from prepared messages
  const estimatedContextSize = messages.reduce(
    (sum, m) =>
      sum + estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)),
    0
  );

  // Yield llm:response event after LLM response, carrying the full output
  yield {
    type: 'llm:response',
    text: responseContent,
    toolCalls: responseToolCalls ?? null,

    timestamp: Date.now(),
  };

  // Build immutable ExecutionState with accumulated data
  const finalResponse = responseContent || accumulatedContent;
  const nextExec = updateExecState(execState, (draft) => {
    draft.llmResponse = finalResponse;
    draft.llmThinking = accumulatedThinking;
    draft.estimatedContextSize = estimatedContextSize;
    if (roundTokens) {
      draft.tokens = roundTokens;
    }
    if (responseToolCalls && responseToolCalls.length > 0) {
      draft.action = {
        id: responseToolCalls[0].id,
        tool: responseToolCalls[0].name,
        arguments: responseToolCalls[0].arguments,
      };
      draft.allActions = responseToolCalls.map((tc) => ({
        id: tc.id,
        tool: tc.name,
        arguments: tc.arguments,
      }));
    } else {
      draft.action = undefined;
      draft.allActions = undefined;
    }
    draft.phase = { type: 'llm-response', response: finalResponse };
  });

  return nextExec;
}

/**
 * Stream phase advancement (micro-step streaming)
 *
 * @param ctx - Runner context
 * @param state - Current agent state
 * @param execState - Execution state (immutable)
 * @param toolRegistry - Optional tool registry
 * @param options - Optional advance options
 * @yields Stream events during phase advancement
 * @returns Final advance result
 */
export async function* executeAdvanceStream(
  ctx: RunnerContext,
  state: AgentState,
  execState: ExecutionState,
  toolRegistry?: IToolRegistry,
  options?: AdvanceOptions
): AsyncGenerator<StreamEvent, AdvanceResult> {
  const registry = toolRegistry ?? ctx.toolRegistry;
  const fromPhase = execState.phase;

  // Handle streaming LLM response
  // TODO(M3): calling-llm phase bypasses PhaseRouter and uses streamCallingLLM() directly.
  //   This duplicates logic from CallingLLMHandler (which uses llmProvider.call()).
  //   Plan: add optional streamExecute() to IPhaseHandler so CallingLLMHandler owns both
  //   blocking and streaming paths. Then remove streamCallingLLM() and this bypass block.
  if (fromPhase.type === 'calling-llm') {
    yield {
      type: 'phase-change',
      from: fromPhase,
      to: { type: 'streaming' },
      timestamp: Date.now(),
    };

    try {
      const nextExec = yield* streamCallingLLM(ctx, state, execState, registry, options?.signal);
      yield {
        type: 'phase-change',
        from: { type: 'streaming' },
        to: nextExec.phase,
        timestamp: Date.now(),
      };
      return { state, execState: nextExec, phase: nextExec.phase, done: false };
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      const nextExec = updateExecState(execState, (draft) => {
        draft.phase = { type: 'error', error: errorObj };
      });
      yield { type: 'error', error: errorObj, context: { step: 0 }, timestamp: Date.now() };
      return { state, execState: nextExec, phase: nextExec.phase, done: true };
    }
  }

  // For other phases, delegate to executeAdvance()
  const result = await executeAdvance(ctx, state, execState, registry, options);

  // Yield effects produced by handler (e.g., tool:end, skill:start)
  if (result.effects && result.effects.length > 0) {
    for (const effect of result.effects) {
      yield effect as StreamEvent;
    }
  }

  yield { type: 'phase-change', from: fromPhase, to: result.phase, timestamp: Date.now() };

  return result;
}

/**
 * Stream one ReAct cycle with observation (meso-step streaming)
 *
 * @param ctx - Runner context
 * @param compressor - Optional context compressor
 * @param state - Current agent state
 * @param toolRegistry - Optional tool registry
 * @param options - Optional execution options
 * @yields Stream events during the step
 * @returns Final state and step result
 */
export async function* executeStepStream(
  ctx: RunnerContext,
  compressor: IContextCompressor | undefined,
  state: AgentState,
  toolRegistry?: IToolRegistry,
  options?: { signal?: AbortSignal },
  middlewareExecutor?: MiddlewareExecutor,
  stepNumber?: number
): AsyncGenerator<StreamEvent, { state: AgentState; result: StepResult }> {
  const registry = toolRegistry ?? ctx.toolRegistry;
  let currentExecState = createExecutionState();
  const stepIdx = stepNumber ?? 0;

  let currentState = state;
  let stepTokens = { input: 0, output: 0 };
  let advanceCount = 0;
  while (!isTerminalPhase(currentExecState.phase)) {
    if (options?.signal?.aborted) {
      return { state: currentState, result: { type: 'abort', tokens: stepTokens } };
    }
    const fromPhase = currentExecState.phase;

    // ── beforeAdvance ──
    if (middlewareExecutor) {
      const chain = await middlewareExecutor.runBeforeAdvance({
        state: currentState,
        execState: currentExecState,
        fromPhase,
        stepNumber: stepIdx,
        runStepCount: advanceCount,
      });
      if (chain.stopResult) {
        return {
          state: currentState,
          result: { type: 'error', error: new Error('Stopped by middleware'), tokens: stepTokens },
        };
      }
      if (chain.state) currentState = chain.state;
      if (chain.execState) currentExecState = chain.execState;
    }

    // TODO(M3): same calling-llm bypass as executeAdvanceStream above, see plan there
    if (fromPhase.type === 'calling-llm') {
      yield {
        type: 'phase-change',
        from: fromPhase,
        to: { type: 'streaming' },
        timestamp: Date.now(),
      };

      try {
        currentExecState = yield* streamCallingLLM(
          ctx,
          currentState,
          currentExecState,
          registry,
          options?.signal
        );
      } catch (error) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        const nextExec = updateExecState(currentExecState, (draft) => {
          draft.phase = { type: 'error', error: errorObj };
        });
        currentExecState = nextExec;
        yield { type: 'error', error: errorObj, context: { step: 0 }, timestamp: Date.now() };
        return {
          state: currentState,
          result: { type: 'error', error: errorObj, tokens: stepTokens },
        };
      }

      yield {
        type: 'phase-change',
        from: { type: 'streaming' },
        to: currentExecState.phase,
        timestamp: Date.now(),
      };

      if (currentExecState.tokens) {
        stepTokens = addTokenStats(stepTokens, currentExecState.tokens);
        currentState = {
          ...currentState,
          context: {
            ...currentState.context,
            totalTokens: addTokenStats(
              currentState.context.totalTokens ?? { input: 0, output: 0 },
              currentExecState.tokens
            ),
          },
        };
      }

      if (currentExecState.estimatedContextSize !== undefined) {
        currentState = {
          ...currentState,
          context: {
            ...currentState.context,
            estimatedContextSize: currentExecState.estimatedContextSize,
          },
        };
      }

      // ── afterAdvance (calling-llm path) ──
      if (middlewareExecutor) {
        const advanceResult: AdvanceResult = {
          state: currentState,
          execState: currentExecState,
          phase: currentExecState.phase,
          done: false,
        };
        const chain = await middlewareExecutor.runAfterAdvance({
          state: currentState,
          execState: currentExecState,
          result: advanceResult,
          stepNumber: stepIdx,
          runStepCount: advanceCount,
        });
        if (chain.stopResult) {
          return {
            state: currentState,
            result: {
              type: 'error',
              error: new Error('Stopped by middleware'),
              tokens: stepTokens,
            },
          };
        }
        if (chain.state) currentState = chain.state;
        if (chain.execState) currentExecState = chain.execState;
      }

      advanceCount++;
      continue;
    }

    // All other phases: delegate to executeAdvance()
    let result = await executeAdvance(ctx, currentState, currentExecState, registry, options);

    currentExecState = result.execState;

    if (result.tokens) {
      stepTokens = addTokenStats(stepTokens, result.tokens);
    }

    if (options?.signal?.aborted) {
      return { state: currentState, result: { type: 'abort', tokens: stepTokens } };
    }

    // ── afterAdvance (executeAdvance path) ──
    if (middlewareExecutor) {
      const chain = await middlewareExecutor.runAfterAdvance({
        state: result.state,
        execState: result.execState,
        result,
        stepNumber: stepIdx,
        runStepCount: advanceCount,
      });
      if (chain.stopResult) {
        return {
          state: currentState,
          result: { type: 'error', error: new Error('Stopped by middleware'), tokens: stepTokens },
        };
      }
      if (chain.state) result = { ...result, state: chain.state };
      if (chain.execState) result = { ...result, execState: chain.execState };
    }

    advanceCount++;

    currentState = await maybeCompress(compressor, result.state);

    // Emit tool events based on phase transitions
    if (result.phase.type === 'executing-tool') {
      if (result.phase.actions.length === 1) {
        yield { type: 'tool:start', action: result.phase.actions[0], timestamp: Date.now() };
      } else {
        yield { type: 'tools:start', actions: result.phase.actions, timestamp: Date.now() };
      }
    }

    // Forward effects produced by handler
    if (result.effects && result.effects.length > 0) {
      for (const effect of result.effects) {
        yield effect as StreamEvent;
      }
    }

    yield { type: 'phase-change', from: fromPhase, to: result.phase, timestamp: Date.now() };

    // Control flow is determined by phase + done
    if (result.done && result.phase.type === 'completed') {
      return {
        state: currentState,
        result: { type: 'done', answer: result.phase.answer, tokens: stepTokens },
      };
    }

    if (result.done && result.phase.type === 'error') {
      yield {
        type: 'error',
        error: result.phase.error,
        context: { step: 0 },
        timestamp: Date.now(),
      };
      return {
        state: currentState,
        result: { type: 'error', error: result.phase.error, tokens: stepTokens },
      };
    }

    // ToolResultHandler has processed tool-result phase (effects indicate processed)
    if (result.phase.type === 'tool-result' && result.effects && result.effects.length > 0) {
      // same-skill/cyclic/plain tool → return continue
      const actions =
        currentExecState.allActions ?? (currentExecState.action ? [currentExecState.action] : []);
      return {
        state: currentState,
        result: {
          type: 'continue',
          toolResult: currentExecState.toolResult,
          actions,
          tokens: stepTokens,
        },
      };
    }

    // ExecutingToolHandler returned tool-result (no effects) → continue loop for ToolResultHandler
    if (result.phase.type === 'tool-result' && (!result.effects || result.effects.length === 0)) {
      continue;
    }

    // Skill loaded/returned → phase reset to idle, continue loop
    if (result.phase.type === 'idle') {
      continue;
    }
  }

  // Should not reach here: all terminal phases are handled inside the loop body
  throw new Error('Unexpected: stepStream loop exited without reaching terminal phase');
}
