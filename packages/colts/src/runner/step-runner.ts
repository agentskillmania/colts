/**
 * @fileoverview StepRunner - Shared step-level orchestration for blocking and streaming
 *
 * Extracted from AgentRunner to unify the duplicated while-loop logic
 * that previously existed in `AgentRunner.step()` and `executeStepStream()`.
 */

import type { AgentState, IToolRegistry, IContextCompressor } from '../types.js';
import type { TokenStats } from '@agentskillmania/llm-client';
import type {
  StepResult,
  AdvanceResult,
  ExecutionState,
  StreamEvent,
  Phase,
  Action,
} from '../execution/index.js';
import { createExecutionState, isTerminalPhase, updateExecState } from '../execution/index.js';
import { addTokenStats } from '../utils/tokens.js';
import { updateTotalTokens, updateState } from '../state/index.js';
import type { RunnerContext } from './advance.js';
import { executeAdvance } from './advance.js';
import { maybeCompress } from './compression.js';
import type { MiddlewareExecutor } from '../middleware/executor.js';
import type { RunnerOptions } from './options.js';

/**
 * Unified step-level event produced by StepRunner.
 *
 * These are the events that both blocking and streaming paths
 * need to emit/yield during a step execution.
 */
export type StepRunnerEvent =
  | { type: 'phase-change'; from: Phase; to: Phase; timestamp: number }
  | { type: 'tool:start'; action: Action; timestamp: number }
  | { type: 'tools:start'; actions: Action[]; timestamp: number }
  | StreamEvent;

/**
 * Callback for emitting events in blocking mode.
 */
export type StepEventEmitter = (type: string, data: Record<string, unknown>) => void;

/**
 * Shared step orchestration for blocking and streaming execution.
 *
 * StepRunner encapsulates the `while (!isTerminalPhase)` loop that was
 * duplicated between `AgentRunner.step()` and `executeStepStream()`.
 *
 * Lifecycle events (`step:start`, `step:end`) and step-level middleware
 * (`beforeStep`, `afterStep`) are handled by the caller (AgentRunner).
 */
export class StepRunner {
  constructor(
    private ctx: RunnerContext,
    private compressor: IContextCompressor | undefined,
    private middlewareExecutor: MiddlewareExecutor | undefined,
    private runnerOptions: RunnerOptions
  ) {}

  /**
   * Execute a step in blocking mode.
   *
   * Events are delivered via the provided `emit` callback.
   *
   * @returns Final state and step result
   */
  async runBlocking(
    state: AgentState,
    registry: IToolRegistry,
    emit: StepEventEmitter,
    options?: { signal?: AbortSignal },
    stepNumber?: number
  ): Promise<{ state: AgentState; result: StepResult }> {
    let currentExecState = createExecutionState();
    let currentState = state;
    let stepTokens: TokenStats = { input: 0, output: 0 };
    const stepIdx = stepNumber ?? 0;

    try {
      while (!isTerminalPhase(currentExecState.phase)) {
        if (options?.signal?.aborted) {
          emit('abort', { step: stepIdx, timestamp: Date.now() });
          return { state: currentState, result: { type: 'abort', tokens: stepTokens } };
        }

        const from = currentExecState.phase;

        // ── beforeAdvance ──
        const beforeResult = await this.runBeforeAdvance(
          currentState,
          currentExecState,
          from,
          stepIdx,
          stepTokens
        );
        if (beforeResult.shortCircuit) {
          return beforeResult.value;
        }
        currentState = beforeResult.state;
        currentExecState = beforeResult.execState;

        const result = await executeAdvance(
          this.ctx,
          currentState,
          currentExecState,
          registry,
          options
        );

        // ── afterAdvance ──
        const afterResult = await this.runAfterAdvance(result, stepIdx, stepTokens);
        if (afterResult.shortCircuit) {
          return afterResult.value;
        }
        const effectiveResult = afterResult.result;

        currentExecState = effectiveResult.execState;
        let nextState = effectiveResult.state;

        if (effectiveResult.tokens) {
          stepTokens = addTokenStats(stepTokens, effectiveResult.tokens);
          nextState = updateTotalTokens(nextState, effectiveResult.tokens);
        }

        if (effectiveResult.estimatedContextSize !== undefined) {
          nextState = updateState(nextState, (draft) => {
            draft.context.estimatedContextSize = effectiveResult.estimatedContextSize;
          });
        }

        if (options?.signal?.aborted) {
          emit('abort', { step: stepIdx, timestamp: Date.now() });
          return { state: nextState, result: { type: 'abort', tokens: stepTokens } };
        }

        currentState = await maybeCompress(this.compressor, nextState);

        // Emit tool events based on phase transitions
        this.emitToolEvents(effectiveResult.phase, emit);

        // Forward effects produced by handler
        this.forwardEffects(effectiveResult.effects, emit);

        emit('phase-change', { from, to: effectiveResult.phase, timestamp: Date.now() });

        // Control flow
        const control = this.checkControlFlow(
          effectiveResult,
          currentExecState,
          currentState,
          stepTokens
        );
        if (control) {
          return control;
        }
      }

      // Should not reach here
      throw new Error('Unexpected: step loop exited without reaching terminal phase');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      emit('error', { error: err, context: { step: stepIdx }, timestamp: Date.now() });
      throw error;
    }
  }

  /**
   * Execute a step in streaming mode.
   *
   * Events are yielded via AsyncGenerator.
   *
   * @yields Step-level stream events
   * @returns Final state and step result
   */
  async *runStreaming(
    state: AgentState,
    registry: IToolRegistry,
    options?: { signal?: AbortSignal },
    stepNumber?: number
  ): AsyncGenerator<StreamEvent, { state: AgentState; result: StepResult }> {
    let currentExecState = createExecutionState();
    let currentState = state;
    let stepTokens: TokenStats = { input: 0, output: 0 };
    const stepIdx = stepNumber ?? 0;

    while (!isTerminalPhase(currentExecState.phase)) {
      if (options?.signal?.aborted) {
        return { state: currentState, result: { type: 'abort', tokens: stepTokens } };
      }

      const fromPhase = currentExecState.phase;

      // ── beforeAdvance ──
      const beforeResult = await this.runBeforeAdvance(
        currentState,
        currentExecState,
        fromPhase,
        stepIdx,
        stepTokens
      );
      if (beforeResult.shortCircuit) {
        return beforeResult.value;
      }
      currentState = beforeResult.state;
      currentExecState = beforeResult.execState;

      let result: AdvanceResult;
      try {
        const advanceGen = this.ctx.phaseRouter.executeStream(
          this.ctx,
          currentState,
          currentExecState,
          registry,
          options
        );
        while (true) {
          const { done, value } = await advanceGen.next();
          if (done) {
            result = value;
            break;
          }
          yield value;
        }
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

      currentExecState = result.execState;

      if (result.tokens) {
        stepTokens = addTokenStats(stepTokens, result.tokens);
        result = { ...result, state: updateTotalTokens(result.state, result.tokens) };
      }

      if (result.estimatedContextSize !== undefined) {
        result = {
          ...result,
          state: updateState(result.state, (draft) => {
            draft.context.estimatedContextSize = result.estimatedContextSize;
          }),
        };
      }

      if (options?.signal?.aborted) {
        return { state: result.state, result: { type: 'abort', tokens: stepTokens } };
      }

      // ── afterAdvance ──
      const afterResult = await this.runAfterAdvance(result, stepIdx, stepTokens);
      if (afterResult.shortCircuit) {
        return afterResult.value;
      }
      result = afterResult.result;
      currentExecState = result.execState;

      currentState = await maybeCompress(this.compressor, result.state);

      // Yield tool events based on phase transitions
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

      // Control flow
      const control = this.checkControlFlow(result, currentExecState, currentState, stepTokens);
      if (control) {
        return control;
      }
    }

    // Should not reach here
    throw new Error('Unexpected: stepStream loop exited without reaching terminal phase');
  }

  // ── Shared helpers ──

  private async runBeforeAdvance(
    state: AgentState,
    execState: ExecutionState,
    fromPhase: Phase,
    stepIdx: number,
    stepTokens: TokenStats
  ): Promise<
    | { shortCircuit: true; value: { state: AgentState; result: StepResult } }
    | { shortCircuit: false; state: AgentState; execState: ExecutionState }
  > {
    if (!this.middlewareExecutor) {
      return { shortCircuit: false, state, execState };
    }

    const chain = await this.middlewareExecutor.runBeforeAdvance({
      state,
      execState,
      fromPhase,
      stepNumber: stepIdx,
      runnerOptions: this.runnerOptions,
    });

    if (chain.stopResult) {
      // completed phase
      if (chain.stopResult.done && chain.stopResult.phase.type === 'completed') {
        return {
          shortCircuit: true,
          value: {
            state: chain.state ?? chain.stopResult.state ?? state,
            result: {
              type: 'stopped',
              data: chain.stopResult.phase.answer,
              tokens: stepTokens,
            },
          },
        };
      }
      // waiting-human phase
      if (chain.stopResult.done && chain.stopResult.phase.type === 'waiting-human') {
        return {
          shortCircuit: true,
          value: {
            state: chain.state ?? chain.stopResult.state ?? state,
            result: {
              type: 'waiting-human',
              request: chain.stopResult.phase.request,
              tokens: stepTokens,
            },
          },
        };
      }
      // Otherwise error
      return {
        shortCircuit: true,
        value: {
          state: chain.state ?? state,
          result: {
            type: 'error',
            error: new Error('Stopped by middleware'),
            tokens: stepTokens,
          },
        },
      };
    }

    return {
      shortCircuit: false,
      state: chain.state ?? state,
      execState: chain.execState ?? execState,
    };
  }

  private async runAfterAdvance(
    result: AdvanceResult,
    stepIdx: number,
    stepTokens: TokenStats
  ): Promise<
    | { shortCircuit: true; value: { state: AgentState; result: StepResult } }
    | { shortCircuit: false; result: AdvanceResult }
  > {
    if (!this.middlewareExecutor) {
      return { shortCircuit: false, result };
    }

    const chain = await this.middlewareExecutor.runAfterAdvance({
      state: result.state,
      execState: result.execState,
      result,
      stepNumber: stepIdx,
      runnerOptions: this.runnerOptions,
    });

    if (chain.stopResult) {
      // completed phase
      if (chain.stopResult.done && chain.stopResult.phase.type === 'completed') {
        return {
          shortCircuit: true,
          value: {
            state: chain.state ?? chain.stopResult.state ?? result.state,
            result: {
              type: 'stopped',
              data: chain.stopResult.phase.answer,
              tokens: stepTokens,
            },
          },
        };
      }
      // waiting-human phase
      if (chain.stopResult.done && chain.stopResult.phase.type === 'waiting-human') {
        return {
          shortCircuit: true,
          value: {
            state: chain.state ?? chain.stopResult.state ?? result.state,
            result: {
              type: 'waiting-human',
              request: chain.stopResult.phase.request,
              tokens: stepTokens,
            },
          },
        };
      }
      // Otherwise error
      return {
        shortCircuit: true,
        value: {
          state: chain.state ?? result.state,
          result: {
            type: 'error',
            error: new Error('Stopped by middleware'),
            tokens: stepTokens,
          },
        },
      };
    }

    let effectiveResult = result;
    if (chain.state) effectiveResult = { ...result, state: chain.state };
    if (chain.execState) effectiveResult = { ...effectiveResult, execState: chain.execState };

    return { shortCircuit: false, result: effectiveResult };
  }

  private emitToolEvents(phase: Phase, emit: StepEventEmitter): void {
    if (phase.type === 'executing-tool') {
      if (phase.actions.length === 1) {
        emit('tool:start', { action: phase.actions[0], timestamp: Date.now() });
      } else {
        emit('tools:start', { actions: phase.actions, timestamp: Date.now() });
      }
    }
  }

  private forwardEffects(
    effects: Array<Record<string, unknown>> | undefined,
    emit: StepEventEmitter
  ): void {
    if (effects && effects.length > 0) {
      for (const effect of effects) {
        emit(effect.type as string, effect);
      }
    }
  }

  private checkControlFlow(
    effectiveResult: AdvanceResult,
    currentExecState: ExecutionState,
    currentState: AgentState,
    stepTokens: TokenStats
  ): { state: AgentState; result: StepResult } | null {
    if (effectiveResult.done && effectiveResult.phase.type === 'completed') {
      return {
        state: currentState,
        result: { type: 'done', answer: effectiveResult.phase.answer, tokens: stepTokens },
      };
    }

    if (effectiveResult.done && effectiveResult.phase.type === 'error') {
      return {
        state: currentState,
        result: { type: 'error', error: effectiveResult.phase.error, tokens: stepTokens },
      };
    }

    if (
      effectiveResult.phase.type === 'tool-result' &&
      effectiveResult.effects &&
      effectiveResult.effects.length > 0
    ) {
      const toolResult = currentExecState.toolResult;
      const actions =
        currentExecState.allActions ?? (currentExecState.action ? [currentExecState.action] : []);
      return {
        state: currentState,
        result: { type: 'continue', toolResult, actions, tokens: stepTokens },
      };
    }

    if (
      effectiveResult.phase.type === 'tool-result' &&
      (!effectiveResult.effects || effectiveResult.effects.length === 0)
    ) {
      return null; // continue loop
    }

    if (effectiveResult.phase.type === 'idle') {
      return null; // continue loop
    }

    return null;
  }
}
