/**
 * @fileoverview AgentRunner - Stateless executor for AgentState
 *
 * Supports both blocking/streaming chat and fine-grained step control.
 * Configurable with dependency inversion and quick initialization.
 */

import type { TokenStats } from '@agentskillmania/llm-client';
import { EventEmitter } from 'eventemitter3';

import type { RunnerContext } from './advance.js';
import type {
  StepResult,
  AdvanceResult,
  ExecutionState,
  RunResult,
  Phase,
  Action,
} from '../execution/index.js';
import type { AdvanceOptions } from '../execution/index.js';
import type { IMessageAssembler } from '../message-assembler/types.js';
import type { IExecutionPolicy } from '../policy/types.js';
import type { Tool as ColtsTool } from '../tools/registry.js';
import type {
  AgentState,
  ILLMProvider,
  IToolRegistry,
  IContextCompressor,
  CompressionConfig,
  TurnUsage,
} from '../types.js';
import { executeAdvance, createRouter } from './advance.js';
import { compressState, maybeCompress } from './compression.js';
import type { RunnerOptions, StepOptions, RunOptions } from './options.js';
import { StepRunner } from './step-runner.js';
import { DefaultContextCompressor } from '../compressor/index.js';
import type { HumanRequest } from '../hitl/types.js';
import { DefaultMessageAssembler } from '../message-assembler/index.js';
import { MiddlewareExecutor } from '../middleware/executor.js';
import type { AgentMiddleware } from '../middleware/types.js';
import { DefaultExecutionPolicy } from '../policy/default-policy.js';
import { FilesystemSkillProvider } from '../skills/filesystem-provider.js';
import { createLoadSkillTool } from '../skills/index.js';
import type { ISkillProvider } from '../skills/types.js';
import { updateState } from '../state/index.js';
import { ToolRegistry } from '../tools/registry.js';
import { DefaultToolSchemaFormatter } from '../tools/schema-formatter.js';
import type { IToolSchemaFormatter } from '../tools/schema-formatter.js';
import { ConfigurationError } from '../types.js';
import { addTokenStats } from '../utils/tokens.js';

export type { RunnerOptions } from './options.js';

/**
 * Runner event map — fully aligned with AsyncGenerator StreamEvent / RunStreamEvent.
 *
 * Yield events are the source of truth; EventEmitter acts as a bridge.
 * run:start / run:end are EventEmitter-only lifecycle events (no yield equivalents).
 */
export interface RunnerEventMap {
  // ── Lifecycle (run-level, EventEmitter-only) ──
  /** Run started */
  'run:start': { state: AgentState; timestamp: number };
  /** Run ended */
  'run:end': { state: AgentState; result: RunResult; timestamp: number };
  /**
   * Conversation was reset (`/clear`): messages went from non-empty to empty
   * during the run. Frontends should drop their local message view. Mirrors the
   * Rust port's `RunnerEvent::SessionCleared`. Emitted before the terminal
   * `complete` so the wire order is `session-cleared` → `done`.
   */
  'session-cleared': { timestamp: number };

  // ── Lifecycle (step-level, aligned with RunStreamEvent) ──
  /** Step started */
  'step:start': { step: number; state: AgentState; timestamp: number };
  /** Step ended */
  'step:end': { step: number; result: StepResult; timestamp: number };
  /** Run completed */
  complete: { result: RunResult; timestamp: number };

  // ── Execution process (aligned with StreamEvent) ──
  /** Phase transition */
  'phase-change': { from: Phase; to: Phase; timestamp: number };
  /** LLM token streaming output */
  token: { token: string; timestamp: number };
  /** Tool execution started */
  'tool:start': { action: Action; timestamp: number };
  /** Tool execution completed — callId pairs it with the tool:start that created the call */
  'tool:end': { result: unknown; callId: string; timestamp: number };
  /** Parallel tool execution started */
  'tools:start': { actions: Action[]; timestamp: number };
  /** Parallel tool execution completed */
  'tools:end': { results: Record<string, unknown>; timestamp: number };
  /** Execution error */
  error: { error: Error; context: { toolName?: string; step: number }; timestamp: number };
  /** Execution was aborted by caller */
  abort: { step?: number; totalSteps?: number; timestamp: number };

  // ── Context compression (aligned with StreamEvent) ──
  /** Compression started */
  compressing: { timestamp: number };
  /**
   * Compression completed. `coveredMessages` 是本轮新覆盖的消息条数
   * （anchor 增量，无歧义消息数）——`removedCount` 的单位随路径而变
   * （自动压缩=token 数、/compact=消息数，历史遗留），时间线标记以
   * coveredMessages 为准。（R2P-104，对齐 Rust 7d964e5）
   */
  compressed: {
    summary: string;
    removedCount: number;
    coveredMessages: number;
    timestamp: number;
  };

  // ── Skill (aligned with StreamEvent) ──
  /** Skill loading */
  'skill:loading': { name: string; timestamp: number };
  /** Skill loaded */
  'skill:loaded': { name: string; tokenCount: number; timestamp: number };
  /** Skill execution started */
  'skill:start': { name: string; task: string; state?: AgentState; timestamp: number };
  /** Skill execution completed */
  'skill:end': { name: string; result: string; state?: AgentState; timestamp: number };

  // ── LLM call (aligned with StreamEvent) ──
  /** Before LLM request is sent */
  'llm:request': {
    messages: Array<{ role: string; content: string }>;
    tools: string[];
    skill: { current: string | null } | null;
    /** The model actually used for this LLM call (may differ from session default if overridden per-request). */
    model: string;
    /** Context window size (tokens) of the model used for this call. */
    contextWindow: number;
    timestamp: number;
  };
  /** After LLM response is received */
  'llm:response': {
    text: string;
    toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> | null;
    /** Token usage for this LLM call (includes fallback estimates when provider omits usage) */
    tokens?: TokenStats;
    timestamp: number;
  };
  /** Thinking/reasoning content during streaming */
  thinking: { content: string; timestamp: number };

  // ── Todo list (middleware-provided, aligned with Rust RunnerEvent::TodoList) ──
  /**
   * Snapshot of the todo list carried on `state.context.todoList` (e.g. by
   * wrangler's todolist middleware). Emitted by the run loop after a step
   * whenever the list changed; the daemon maps it to the `todo-list` SSE
   * event so the UI can show live todo progress.
   */
  'todo:list': { items: unknown[]; timestamp: number };
}

/**
 * AgentRunner - Stateless executor for AgentState
 * (RunnerOptions is defined in ./options.ts and re-exported above)
 *
 * @remarks
 * AgentRunner is designed to be completely stateless. It receives an AgentState,
 * executes LLM operations, and returns a new AgentState. This enables:
 * - Running multiple AgentState instances concurrently
 * - Easy testing and debugging
 * - Time travel and replay capabilities
 *
 * Design decisions:
 * - systemPrompt is set on Runner as a default, merged with AgentConfig.instructions
 * - per-call options allow dynamic configuration of different requests
 *
 * @example
 * Basic usage:
 * ```typescript
 * const runner = new AgentRunner({
 *   model: 'gpt-4',
 *   llmClient: client,
 *   systemPrompt: 'You are a helpful assistant.'
 * });
 *
 * // Blocking chat
 * const result = await runner.chat(state, 'Hello!');
 * console.log(result.response);
 *
 * // Streaming chat
 * for await (const chunk of runner.chatStream(state, 'Hello!')) {
 *   if (chunk.type === 'text') {
 *     process.stdout.write(chunk.delta);
 *   }
 * }
 * ```
 */

/** Default max steps for run() / runStream() when not specified */
export const DEFAULT_RUNNER_MAX_STEPS = 500;

/** Hard ceiling safety net for run() / runStream() to prevent infinite loops */
export const RUN_HARD_LIMIT = 1000;

export class AgentRunner extends EventEmitter<RunnerEventMap> {
  private llmProvider: ILLMProvider;
  private toolRegistry: IToolRegistry;
  private compressor?: IContextCompressor;
  private _skillProvider?: ISkillProvider;
  private messageAssembler: IMessageAssembler;
  private phaseRouter: ReturnType<typeof createRouter>;
  private toolSchemaFormatter: IToolSchemaFormatter;
  private executionPolicy: IExecutionPolicy;
  private middlewareExecutor: MiddlewareExecutor;
  private hasMiddleware: boolean;
  private options: RunnerOptions;
  /** JSON of the last `todo:list` items emitted; only changes are emitted. */
  private lastTodoItemsJson: string | undefined;

  /** Get the Skill provider (used by the CLI layer for the /skill command) */
  get skillProvider(): ISkillProvider | undefined {
    return this._skillProvider;
  }

  /**
   * Create an AgentRunner instance
   *
   * @param options - Runner configuration options
   * @throws ConfigurationError if LLM configuration is invalid
   */
  constructor(options: RunnerOptions) {
    super();
    // Validate LLM configuration（注入模式——引擎不内置 LLM 创建）
    if (!options.llmClient) {
      throw new ConfigurationError(
        'Must specify llmClient (injection). Use LLMClient.quickInit() for built-in init.'
      );
    }
    this.llmProvider = options.llmClient;

    // Initialize tool registry (merge injection and quick init)
    const registry = options.toolRegistry ?? new ToolRegistry();
    if (options.tools && options.tools.length > 0) {
      for (const tool of options.tools) {
        registry.register(tool);
      }
    }
    this.toolRegistry = registry;

    // Store options with defaults
    this.options = {
      ...options,
      maxSteps: options.maxSteps ?? DEFAULT_RUNNER_MAX_STEPS,
      requestTimeout: options.requestTimeout ?? 1800000,
      runHardLimit: options.runHardLimit ?? RUN_HARD_LIMIT,
    };

    // Initialize message assembler (injected or default)
    this.messageAssembler = options.messageAssembler ?? new DefaultMessageAssembler();

    // Initialize phase router (default handlers)
    this.phaseRouter = createRouter();

    // Initialize tool schema formatter
    this.toolSchemaFormatter = options.toolSchemaFormatter ?? new DefaultToolSchemaFormatter();

    // Initialize compressor
    if (options.compressor) {
      if (typeof options.compressor === 'object' && 'shouldCompress' in options.compressor) {
        this.compressor = options.compressor as IContextCompressor;
      } else {
        const compressionConfig = options.compressor as CompressionConfig;
        // Auto-fill contextWindowSize from model metadata if not explicitly set
        let contextWindowSize = compressionConfig.contextWindowSize;
        if (contextWindowSize === undefined) {
          const modelMeta = this.llmProvider.getModelMeta(this.options.model);
          contextWindowSize = modelMeta?.contextWindow;
        }
        this.compressor = new DefaultContextCompressor(
          { ...compressionConfig, contextWindowSize },
          this.llmProvider,
          this.options.model
        );
      }
    }

    // Initialize skill provider (injection > quick init)
    if (options.skillProvider) {
      this._skillProvider = options.skillProvider;
    } else if (options.skillDirs && options.skillDirs.length > 0) {
      this._skillProvider = new FilesystemSkillProvider(options.skillDirs);
    }

    // Auto-register skill tools
    if (this._skillProvider) {
      const loadSkillTool = createLoadSkillTool(this._skillProvider);
      this.toolRegistry.register(loadSkillTool);
    }

    // Initialize execution policy
    this.executionPolicy = options.executionPolicy ?? new DefaultExecutionPolicy();

    // Initialize middleware
    this.middlewareExecutor = new MiddlewareExecutor(options.middleware ?? []);
    this.hasMiddleware = !this.middlewareExecutor.isEmpty;
  }

  /**
   * Register a tool at runtime
   *
   * @param tool - Tool definition to register
   */
  registerTool(tool: ColtsTool): void {
    this.toolRegistry.register(tool);
  }

  /**
   * Unregister a tool at runtime
   *
   * @param name - Name of the tool to unregister
   * @returns true if the tool was removed
   */
  unregisterTool(name: string): boolean {
    return this.toolRegistry.unregister(name);
  }

  /**
   * Add a middleware at runtime
   *
   * Middleware added via use() is appended to the chain (runs after existing ones).
   *
   * @param middleware - Middleware to add
   */
  use(middleware: AgentMiddleware): void {
    // Rebuild executor with the new middleware appended
    const current = this.options.middleware ?? [];
    this.options = { ...this.options, middleware: [...current, middleware] };
    this.middlewareExecutor = new MiddlewareExecutor(this.options.middleware ?? []);
    this.hasMiddleware = true;
  }

  /**
   * Get the list of registered middlewares (read-only)
   */
  getMiddlewares(): readonly AgentMiddleware[] {
    return this.middlewareExecutor.list;
  }

  /**
   * Get the internal LLM provider (for advanced use)
   *
   * @returns The configured LLM provider instance
   */
  getLLMProvider(): ILLMProvider {
    return this.llmProvider;
  }

  /**
   * Get the internal tool registry (for advanced use)
   *
   * @returns The configured tool registry instance
   */
  getToolRegistry(): IToolRegistry {
    return this.toolRegistry;
  }

  /**
   * Build RunnerContext for extracted functions
   *
   * @returns Runner context with current configuration
   * @private
   */
  private get ctx(): RunnerContext {
    return {
      llmProvider: this.llmProvider,
      toolRegistry: this.toolRegistry,
      messageAssembler: this.messageAssembler,
      phaseRouter: this.phaseRouter,
      toolSchemaFormatter: this.toolSchemaFormatter,
      skillProvider: this._skillProvider,
      executionPolicy: this.executionPolicy,
      options: {
        model: this.options.model,
        systemPrompt: this.options.systemPrompt,
        requestTimeout: this.options.requestTimeout,
        maxSteps: this.options.maxSteps,
        thinkingEnabled: this.options.thinkingEnabled,
        enablePromptThinking: this.options.enablePromptThinking,
        temperature: this.options.temperature,
      },
      emit: (type: string, data: Record<string, unknown>) => {
        this.emit(type as keyof RunnerEventMap, data as never);
      },
    };
  }

  /**
   * Build messages array for LLM call from current state
   *
  /**
   * Ensure skill state is initialized in the given AgentState.
   *
   * Returns a new state (via Immer) when initialization was needed,
   * or the original state unchanged when skillState already exists or
   * no skill provider is configured.
   *
   * @param state - Agent state to initialize
   * @returns Agent state with skillState initialized (if applicable)
   * @private
   */
  private initializeSkillState(state: AgentState): AgentState {
    if (state.context.skillState || !this._skillProvider) {
      return state;
    }
    return updateState(state, (draft) => {
      draft.context.skillState = {
        current: null,
      };
    });
  }

  /**
   * 🔬 Micro-step: Advance one execution phase
   *
   * Each call progresses to the next natural breakpoint and returns an immutable
   * new AgentState. The original state is never modified.
   *
   * @param state - Current agent state (immutable)
   * @param execState - Execution state tracking current phase (caller managed)
   * @param toolRegistry - Optional tool registry
   * @returns Updated state, current phase, and completion status
   *
   * @example
   * ```typescript
   * let state = createAgentState({...});
   * let execState = createExecutionState();
   *
   * while (true) {
   *   const { state: newState, phase, done } = await runner.advance(state, execState);
   *   state = newState; // Always use the new state
   *
   *   console.log('Entered phase:', phase.type);
   *
   *   // Intervene at specific phases
   *   if (phase.type === 'parsed' && phase.action) {
   *     console.log('About to execute:', phase.action);
   *     // Can modify action in execState before continuing
   *   }
   *
   *   if (done) break;
   * }
   * ```
   */
  async advance(
    state: AgentState,
    execState: ExecutionState,
    toolRegistry?: IToolRegistry,
    options?: AdvanceOptions,
    stepNumber?: number
  ): Promise<AdvanceResult> {
    const from = execState.phase;
    const stepNum = stepNumber ?? 0;

    try {
      // ── beforeAdvance ──
      if (this.hasMiddleware) {
        const chain = await this.middlewareExecutor.runBeforeAdvance({
          state,
          execState,
          fromPhase: from,
          stepNumber: stepNum,
          runnerOptions: this.options,
        });
        if (chain.stopResult) return chain.stopResult;
        if (chain.state) state = chain.state;
        if (chain.execState) execState = chain.execState;
      }

      let result = await executeAdvance(this.ctx, state, execState, toolRegistry, options);

      // ── afterAdvance ──
      if (this.hasMiddleware) {
        const chain = await this.middlewareExecutor.runAfterAdvance({
          state: result.state,
          execState: result.execState,
          result,
          stepNumber: stepNum,
          runnerOptions: this.options,
        });
        if (chain.stopResult) return chain.stopResult;
        if (chain.state) result = { ...result, state: chain.state };
        if (chain.execState) result = { ...result, execState: chain.execState };
      }

      // Emit corresponding StreamEvent based on phase type
      if (result.phase.type === 'executing-tool') {
        if (result.phase.actions.length === 1) {
          this.emit('tool:start', { action: result.phase.actions[0], timestamp: Date.now() });
        } else {
          this.emit('tools:start', { actions: result.phase.actions, timestamp: Date.now() });
        }
      }
      // Forward effects produced by handler to EventEmitter
      if (result.effects && result.effects.length > 0) {
        for (const effect of result.effects) {
          this.emit(effect.type as keyof RunnerEventMap, effect as never);
        }
      }
      if (result.phase.type === 'error') {
        this.emit('error', {
          error: result.phase.error,
          context: { step: stepNum },
          timestamp: Date.now(),
        });
      }
      this.emit('phase-change', { from, to: result.phase, timestamp: Date.now() });
      return result;
      /* c8 ignore next 5 */
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', { error: err, context: { step: stepNum }, timestamp: Date.now() });
      throw error;
    }
  }

  /**
   * 🦶 Meso-step: Complete one ReAct cycle
   *
   * Internally composed of multiple advance() calls:
   * preparing → calling-llm → llm-response → parsing → parsed
   * → [executing-tool → tool-result if action] → completed
   *
   * @param state - Current agent state
   * @param toolRegistry - Optional tool registry
   * @returns Updated state and step result
   *
   * @example
   * ```typescript
   * // Step with no tools needed
   * const { state: newState, result } = await runner.step(state);
   * if (result.type === 'done') {
   *   console.log('Answer:', result.answer);
   * }
   *
   * // Step with tool execution
   * if (result.type === 'continue') {
   *   console.log('Tool result:', result.toolResult);
   *   // Call step again with new state
   *   const final = await runner.step(newState);
   * }
   * ```
   */
  async step(
    state: AgentState,
    toolRegistry?: IToolRegistry,
    options?: StepOptions,
    stepNumber?: number
  ): Promise<{ state: AgentState; result: StepResult }> {
    const registry = toolRegistry ?? this.toolRegistry;
    const stepIdx = stepNumber ?? 0;
    const stepStartTime = Date.now();

    // ── beforeStep ──
    if (this.hasMiddleware) {
      const chain = await this.middlewareExecutor.runBeforeStep({
        state,
        stepNumber: stepIdx,
        runnerOptions: this.options,
      });
      if (chain.stopped) {
        if (chain.result) {
          return { state, result: { ...chain.result, duration: Date.now() - stepStartTime } };
        }
        return {
          state,
          result: {
            type: 'error',
            error: new Error('Stopped by middleware'),
            tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            duration: Date.now() - stepStartTime,
          },
        };
      }
      if (chain.state) state = chain.state;
    }

    this.emit('step:start', { step: stepIdx, state, timestamp: Date.now() });

    // Helper to apply afterStep middleware before returning
    const finalizeStep = async (
      stepState: AgentState,
      stepResult: StepResult
    ): Promise<{ state: AgentState; result: StepResult }> => {
      this.emit('step:end', { step: stepIdx, result: stepResult, timestamp: Date.now() });
      if (this.hasMiddleware) {
        const chain = await this.middlewareExecutor.runAfterStep({
          state: stepState,
          result: stepResult,
          stepNumber: stepIdx,
          runnerOptions: this.options,
        });
        if (chain.state) stepState = chain.state;
        if (chain.stopped) {
          if (chain.result) {
            return {
              state: stepState,
              result: { ...chain.result, duration: Date.now() - stepStartTime },
            };
          }
          return {
            state: stepState,
            result: {
              type: 'error',
              error: new Error('Stopped by middleware'),
              tokens: stepResult.tokens,
              duration: Date.now() - stepStartTime,
            },
          };
        }
      }
      return { state: stepState, result: stepResult };
    };

    const stepRunner = new StepRunner(
      this.ctx,
      this.compressor,
      this.hasMiddleware ? this.middlewareExecutor : undefined,
      this.options
    );

    try {
      const { state: nextState, result } = await stepRunner.runBlocking(
        state,
        registry,
        (type, data) => this.emit(type as keyof RunnerEventMap, data as never),
        options,
        stepIdx
      );
      return await finalizeStep(nextState, result);
      /* c8 ignore next 5 */
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', { error: err, context: { step: stepIdx }, timestamp: Date.now() });
      // Return error result (consistent with stepStream)
      return {
        state,
        result: {
          type: 'error',
          error: err,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          duration: Date.now() - stepStartTime,
        },
      };
    }
  }

  /**
   * 🏃 Macro-step: Run until completion
   *
   * Automatically loops step() until a final answer is reached or maxSteps exhausted.
   *
   * @param state - Current agent state
   * @param options - Optional run configuration (maxSteps)
   * @param toolRegistry - Optional tool registry override
   * @returns Final state and run result
   *
   * @example
   * ```typescript
   * const { state: finalState, result } = await runner.run(initialState);
   * if (result.type === 'success') {
   *   console.log('Answer:', result.answer);
   * }
   * ```
   */
  async run(
    state: AgentState,
    options?: RunOptions,
    toolRegistry?: IToolRegistry
  ): Promise<{ state: AgentState; result: RunResult }> {
    // Initialize skill state if needed
    let currentState = this.initializeSkillState(state);
    const runStartTime = Date.now();
    // Capture the pre-run message count so finalizeRun can detect a `/clear`
    // reset (messages → empty) and emit `session-cleared`.
    const initialMessageCount = currentState.context.messages.length;

    // ── beforeRun ──
    if (this.hasMiddleware) {
      const chain = await this.middlewareExecutor.runBeforeRun({
        state: currentState,
        runnerOptions: this.options,
      });
      if (chain.stopped) {
        // If middleware provided a custom result, use it directly
        if (chain.result) {
          return {
            state: currentState,
            result: { ...chain.result, duration: Date.now() - runStartTime },
          };
        }
        // Otherwise fall back to error (backward compatible)
        const runResult: RunResult = {
          type: 'error',
          error: new Error('Stopped by middleware'),
          totalSteps: 0,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          duration: Date.now() - runStartTime,
        };
        return { state: currentState, result: runResult };
      }
      if (chain.state) currentState = chain.state;
    }

    this.emit('run:start', { state: currentState, timestamp: Date.now() });
    // Fresh run — drop the previous run's todo snapshot baseline.
    this.lastTodoItemsJson = undefined;
    const registry = toolRegistry ?? this.toolRegistry;
    const maxSteps = options?.maxSteps ?? this.options.maxSteps ?? DEFAULT_RUNNER_MAX_STEPS;
    let totalSteps = 0;
    let runTokens: TokenStats = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const runHardLimit = this.options.runHardLimit ?? RUN_HARD_LIMIT;

    // Helper to emit run:end and run afterRun middleware
    const finalizeRun = async (
      runState: AgentState,
      runResult: RunResult
    ): Promise<{ state: AgentState; result: RunResult }> => {
      const resultWithDuration = { ...runResult, duration: Date.now() - runStartTime };
      // Stamp this turn's usage onto its last assistant message BEFORE
      // run:end / afterRun — persistence happens in afterRun middleware, so
      // the stamped state is what gets saved. All terminal paths (policy
      // stops, abort signal, step abort, hard limit, thrown errors) funnel
      // through here: the single common exit, the counterpart of Rust
      // finish_run's stamp_turn_usage (Rust's abort/hard-limit exits bypass
      // finish_run and call it directly; here they pass through finalizeRun).
      // (R2P-106, aligned with Rust c904595)
      const stampedState = stampTurnUsage(runState, resultWithDuration);
      this.emit('run:end', {
        state: stampedState,
        result: resultWithDuration,
        timestamp: Date.now(),
      });
      // `/clear` reset the conversation: messages went from non-empty to empty.
      // Notify clients to drop their local view BEFORE the terminal `complete`
      // so the wire order is `session-cleared` → `done` (mirrors Rust
      // `RunnerEvent::SessionCleared`). `/compact` keeps messages non-empty
      // (it compresses), so it does not trigger this.
      if (stampedState.context.messages.length === 0 && initialMessageCount > 0) {
        this.emit('session-cleared', { timestamp: Date.now() });
      }
      this.emit('complete', { result: resultWithDuration, timestamp: Date.now() });
      if (this.hasMiddleware) {
        await this.middlewareExecutor.runAfterRun({
          state: stampedState,
          result: resultWithDuration,
          runnerOptions: this.options,
        });
      }
      return { state: stampedState, result: resultWithDuration };
    };

    try {
      while (totalSteps < runHardLimit) {
        if (options?.signal?.aborted) {
          const runResult: RunResult = {
            type: 'abort',
            totalSteps,
            tokens: runTokens,
            duration: 0,
          };
          this.emit('abort', { totalSteps, timestamp: Date.now() });
          return finalizeRun(currentState, runResult);
        }

        // Call step() to get full event propagation (advance → step → run)
        const stepOpts: StepOptions | undefined = options
          ? {
              thinkingEnabled: options.thinkingEnabled,
              model: options.model,
              temperature: options.temperature,
              signal: options.signal,
            }
          : undefined;
        const { state: newState, result } = await this.step(
          currentState,
          registry,
          stepOpts,
          totalSteps
        );

        if (result.tokens) {
          runTokens = addTokenStats(runTokens, result.tokens);
        }

        if (result.type === 'abort') {
          const runResult: RunResult = {
            type: 'abort',
            totalSteps: totalSteps + 1,
            tokens: runTokens,
            duration: 0,
          };
          return finalizeRun(newState, runResult);
        }

        currentState = newState;
        totalSteps++;

        // Emit a todo-list snapshot whenever the list changed during this
        // step (the todolist middleware applies its updates in afterStep).
        // Only changes are emitted, so consumers get a clean stream of
        // updates instead of a per-step heartbeat — same contract as the
        // Rust daemon's RunnerEvent::TodoList.
        const todoList = (currentState.context as { todoList?: { items?: unknown[] } }).todoList;
        if (todoList) {
          const itemsJson = JSON.stringify(todoList.items ?? []);
          if (itemsJson !== this.lastTodoItemsJson) {
            this.lastTodoItemsJson = itemsJson;
            this.emit('todo:list', {
              items: (todoList.items ?? []).slice(),
              timestamp: Date.now(),
            });
          }
        }

        const decision = this.executionPolicy.shouldStop(currentState, result, {
          stepCount: totalSteps,
          maxSteps,
        });

        if (decision.decision === 'stop') {
          let runResult: RunResult;

          if (decision.runResultType === 'success') {
            // Defensive cleanup: clear the active-skill marker when a skill replies directly
            currentState = this.cleanupStaleSkillState(currentState);
            runResult = {
              type: 'success',
              answer: (result as { type: 'done'; answer: string }).answer,
              totalSteps,
              tokens: runTokens,
              duration: 0,
            };
          } else if (decision.runResultType === 'error') {
            runResult = {
              type: 'error',
              error: (result as { type: 'error'; error: Error }).error,
              totalSteps,
              tokens: runTokens,
              duration: 0,
            };
            this.emit('error', {
              error: runResult.error,
              context: { step: totalSteps - 1 },
              timestamp: Date.now(),
            });
          } else if (decision.runResultType === 'abort') {
            runResult = { type: 'abort', totalSteps, tokens: runTokens, duration: 0 };
            this.emit('abort', { totalSteps, timestamp: Date.now() });
          } else if (decision.runResultType === 'stopped') {
            runResult = {
              type: 'stopped',
              data: (result as { type: 'stopped'; data?: string }).data,
              totalSteps,
              tokens: runTokens,
              duration: 0,
            };
          } else if (decision.runResultType === 'waiting-human') {
            runResult = {
              type: 'waiting-human',
              request: (
                result as {
                  type: 'waiting-human';
                  request: HumanRequest;
                }
              ).request,
              totalSteps,
              tokens: runTokens,
              duration: 0,
            };
          } else {
            runResult = { type: 'max_steps', totalSteps, tokens: runTokens, duration: 0 };
          }

          return finalizeRun(currentState, runResult);
        }

        // Auto-compress between steps — 发射在 maybeCompress 内与步内路径
        // 共用同一 helper（对齐 Rust runner.rs:459 经 maybe_compress），
        // compressed 载荷（含 coveredMessages）两路同构。R2P-104 返修。
        currentState = await maybeCompress(this.compressor, currentState, (type, data) =>
          this.emit(type as keyof RunnerEventMap, data as never)
        );
      }

      // Hard limit reached (safety net for policy bugs)
      const runResult: RunResult = {
        type: 'max_steps',
        totalSteps,
        tokens: runTokens,
        duration: 0,
      };
      return finalizeRun(currentState, runResult);
      /* c8 ignore next 5 */
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', { error: err, context: { step: totalSteps }, timestamp: Date.now() });
      // Return error result (consistent with runStream)
      return finalizeRun(currentState, {
        type: 'error',
        error: err,
        totalSteps,
        tokens: runTokens,
        duration: 0,
      });
    }
  }

  /**
   * Manually trigger context compression
   *
   * @param state - Current agent state
   * @returns New state with compression metadata plus one appended system
   * marker row (the timeline trace of this compression; immutable)
   * @throws Error if no compressor is configured
   *
   * @example
   * ```typescript
   * const compressedState = await runner.compress(state);
   * // compressedState.context.compression is set
   * // compressedState.context.messages gains exactly one role:'system' marker
   * // row ({"kind":"compact",...}) at the end — messages are never deleted
   * ```
   */
  async compress(state: AgentState): Promise<AgentState> {
    if (!this.compressor) {
      throw new Error('No compressor configured. Pass compressor in RunnerOptions.');
    }
    return compressState(this.compressor, state);
  }

  /**
   * Defensive cleanup: when a run ends successfully, if a skill is still marked
   * active (the LLM replied directly without an explicit return path), clear the
   * current-skill marker so stale breadcrumbs do not leak into the next run.
   *
   * Note: the skill stack was removed, so only `current` needs clearing.
   *
   * @param state - Current AgentState
   * @returns Cleaned AgentState (if cleanup was needed)
   */
  private cleanupStaleSkillState(state: AgentState): AgentState {
    const ss = state.context.skillState;
    if (!ss || !ss.current) return state;
    return updateState(state, (draft) => {
      draft.context.skillState!.current = null;
    });
  }
}

/**
 * Stamp this run's usage onto the turn's LAST assistant message (the
 * frontend fromHistory read-side convention: the turn-final row carries it).
 *
 * Semantics (R2P-106, aligned with Rust c904595 `stamp_turn_usage`):
 * - waiting-human: not stamped — the turn is unfinished; the final run after
 *   resume writes it once (its done frame likewise only carries the resume
 *   segment, so both ends agree);
 * - all-zero usage: not stamped — command-interception runs that never hit
 *   the LLM; absent means "no usage";
 * - no assistant row this run (run ended before first completion): nowhere
 *   to attach, skipped.
 *
 * Returns the original state unchanged when skipping; otherwise a new state
 * with the stamped message (immutable update).
 */
export function stampTurnUsage(state: AgentState, result: RunResult): AgentState {
  if (result.type === 'waiting-human') {
    return state;
  }
  const usage: TurnUsage = {
    inputTokens: result.tokens.input,
    outputTokens: result.tokens.output,
    cacheRead: result.tokens.cacheRead,
    cacheWrite: result.tokens.cacheWrite,
    durationMs: result.duration,
  };
  if (isZeroTurnUsage(usage)) {
    return state;
  }
  const messages = state.context.messages;
  let lastAssistantIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      lastAssistantIndex = i;
      break;
    }
  }
  if (lastAssistantIndex === -1) {
    return state;
  }
  return updateState(state, (draft) => {
    draft.context.messages[lastAssistantIndex].usage = usage;
  });
}

/** All-zero check: runs that never hit the LLM leave no account (absent = none). */
function isZeroTurnUsage(usage: TurnUsage): boolean {
  return (
    usage.inputTokens === 0 &&
    usage.outputTokens === 0 &&
    usage.cacheRead === 0 &&
    usage.cacheWrite === 0 &&
    usage.durationMs === 0
  );
}
