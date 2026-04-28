/**
 * @fileoverview AgentRunner - Stateless executor for AgentState
 *
 * Supports both blocking/streaming chat and fine-grained step control.
 * Configurable with dependency inversion and quick initialization.
 */

import { LLMClient } from '@agentskillmania/llm-client';
import type { TokenStats } from '@agentskillmania/llm-client';
import type { Message, Tool } from '@mariozechner/pi-ai';
import type {
  AgentState,
  ILLMProvider,
  IToolRegistry,
  IContextCompressor,
  CompressionConfig,
  LLMQuickInit,
} from '../types.js';
import { ConfigurationError } from '../types.js';
import { DefaultContextCompressor } from '../compressor/index.js';
import {
  addUserMessage,
  addAssistantMessage,
  incrementStepCount,
  updateState,
  updateTotalTokens,
} from '../state/index.js';
import { addTokenStats, estimateTokens } from '../utils/tokens.js';
import { ToolRegistry } from '../tools/registry.js';
import type { Tool as ColtsTool } from '../tools/registry.js';
import type {
  StepResult,
  AdvanceResult,
  ExecutionState,
  StreamEvent,
  RunResult,
  RunStreamEvent,
  Phase,
  Action,
} from '../execution/index.js';
import type { AdvanceOptions } from '../execution/index.js';
import { createExecutionState, isTerminalPhase } from '../execution/index.js';
import { getToolsForLLM } from '../tools/llm-format.js';
import type { IToolSchemaFormatter } from '../tools/schema-formatter.js';
import { DefaultToolSchemaFormatter } from '../tools/schema-formatter.js';
export type { RunnerOptions } from './options.js';
import { DefaultMessageAssembler } from '../message-assembler/index.js';
import type { IMessageAssembler } from '../message-assembler/types.js';
import { compressState, maybeCompress } from './compression.js';
import { executeAdvance, createRouter } from './advance.js';
import type { RunnerContext } from './advance.js';
import { streamCallingLLM, executeAdvanceStream, executeStepStream } from './stream.js';
import type { ISkillProvider } from '../skills/types.js';
import { FilesystemSkillProvider } from '../skills/filesystem-provider.js';
import { createLoadSkillTool, createReturnSkillTool } from '../skills/index.js';
import type { SubAgentConfig, DelegateResult, ISubAgentFactory } from '../subagent/types.js';
import { DefaultSubAgentFactory } from '../subagent/types.js';
import { createDelegateTool } from '../subagent/delegate-tool.js';
import { EventEmitter } from 'eventemitter3';
import type { IExecutionPolicy } from '../policy/types.js';
import { DefaultExecutionPolicy } from '../policy/default-policy.js';
import type { AgentMiddleware } from '../middleware/types.js';
import type { RunnerOptions } from './options.js';
import { MiddlewareExecutor } from '../middleware/executor.js';

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
  /** Tool execution completed */
  'tool:end': { result: unknown; callId?: string; timestamp: number };
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
  /** Compression completed */
  compressed: { summary: string; removedCount: number; timestamp: number };

  // ── Skill (aligned with StreamEvent) ──
  /** Skill loading */
  'skill:loading': { name: string; timestamp: number };
  /** Skill loaded */
  'skill:loaded': { name: string; tokenCount: number; timestamp: number };
  /** Skill execution started */
  'skill:start': { name: string; task: string; state?: AgentState; timestamp: number };
  /** Skill execution completed */
  'skill:end': { name: string; result: string; state?: AgentState; timestamp: number };

  // ── SubAgent (aligned with StreamEvent) ──
  /** Sub-agent started */
  'subagent:start': { name: string; task: string; timestamp: number };
  /** Sub-agent completed */
  'subagent:end': { name: string; result: DelegateResult; timestamp: number };

  // ── LLM call (aligned with StreamEvent) ──
  /** Before LLM request is sent */
  'llm:request': {
    messages: Array<{ role: string; content: string }>;
    tools: string[];
    skill: { current: string | null; stack: string[] } | null;
    timestamp: number;
  };
  /** After LLM response is received */
  'llm:response': {
    text: string;
    toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> | null;
    timestamp: number;
  };
  /** Thinking/reasoning content during streaming */
  thinking: { content: string; timestamp: number };
}

/**
 * AgentRunner - Stateless executor for AgentState
 * (RunnerOptions is defined in ./options.ts and re-exported above)
 */

/**
 * Options for individual chat calls
 */
export interface ChatOptions {
  /** Request priority for LLM calls (default: 0) */
  priority?: number;
}

/**
 * Result of a chat() call
 */
export interface ChatResult {
  /** Updated state with new messages */
  state: AgentState;

  /** Assistant's response content */
  response: string;

  /** Token usage statistics */
  tokens: TokenStats;

  /** Stop reason from LLM */
  stopReason: string;
}

/**
 * Chunk emitted during chatStream()
 */
export interface ChatStreamChunk {
  /** Event type */
  type: 'text' | 'done' | 'error';

  /** Incremental content (for 'text' events) */
  delta?: string;

  /** Accumulated content so far */
  accumulatedContent?: string;

  /** State at this point in the stream */
  state: AgentState;

  /** Token usage (for 'done' events) */
  tokens?: TokenStats;

  /** Error message (for 'error' events) */
  error?: string;
}

/**
 * AgentRunner - Stateless executor for AgentState
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
 * - priority is per-call, allowing dynamic prioritization of different requests
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
 * // Blocking chat with default priority
 * const result = await runner.chat(state, 'Hello!');
 * console.log(result.response);
 *
 * // High priority chat
 * const urgent = await runner.chat(state, 'Urgent!', { priority: 10 });
 *
 * // Streaming chat
 * for await (const chunk of runner.chatStream(state, 'Hello!')) {
 *   if (chunk.type === 'text') {
 *     process.stdout.write(chunk.delta);
 *   }
 * }
 * ```
 */

/** Hard ceiling safety net for run() / runStream() to prevent infinite loops */
const RUN_HARD_LIMIT = 1000;

export class AgentRunner extends EventEmitter<RunnerEventMap> {
  private llmProvider: ILLMProvider;
  private toolRegistry: IToolRegistry;
  private compressor?: IContextCompressor;
  private _skillProvider?: ISkillProvider;
  private subAgentConfigs?: Map<string, SubAgentConfig>;
  private messageAssembler: IMessageAssembler;
  private phaseRouter: ReturnType<typeof createRouter>;
  private toolSchemaFormatter: IToolSchemaFormatter;
  private subAgentFactory: ISubAgentFactory;
  private executionPolicy: IExecutionPolicy;
  private middlewareExecutor: MiddlewareExecutor;
  private hasMiddleware: boolean;
  private options: RunnerOptions;

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
    // Validate LLM configuration (mutually exclusive)
    if (options.llmClient && options.llm) {
      throw new ConfigurationError(
        'Cannot specify both llmClient and llm. Choose one: injection or quick initialization.'
      );
    }
    if (!options.llmClient && !options.llm) {
      throw new ConfigurationError('Must specify either llmClient or llm.');
    }

    // Initialize LLM provider
    if (options.llmClient) {
      this.llmProvider = options.llmClient;
    } else if (options.llm) {
      this.llmProvider = this.createLLMFromQuickInit(options.llm, options.model);
    } else {
      throw new ConfigurationError('No LLM provider configured.');
    }

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
      maxSteps: options.maxSteps ?? 10,
    };

    // Initialize message assembler (default implementation)
    this.messageAssembler = new DefaultMessageAssembler();

    // Initialize phase router (default handlers)
    this.phaseRouter = createRouter();

    // Initialize tool schema formatter
    this.toolSchemaFormatter = options.toolSchemaFormatter ?? new DefaultToolSchemaFormatter();

    // Initialize sub-agent factory
    this.subAgentFactory = options.subAgentFactory ?? new DefaultSubAgentFactory();

    // Initialize compressor
    if (options.compressor) {
      if (typeof options.compressor === 'object' && 'shouldCompress' in options.compressor) {
        this.compressor = options.compressor as IContextCompressor;
      } else {
        this.compressor = new DefaultContextCompressor(
          options.compressor as CompressionConfig,
          this.llmProvider,
          this.options.model
        );
      }
    }

    // Initialize skill provider (injection > quick init)
    if (options.skillProvider) {
      this._skillProvider = options.skillProvider;
    } else if (options.skillDirectories && options.skillDirectories.length > 0) {
      this._skillProvider = new FilesystemSkillProvider(options.skillDirectories);
    }

    // Auto-register skill tools
    if (this._skillProvider) {
      const loadSkillTool = createLoadSkillTool(this._skillProvider);
      this.toolRegistry.register(loadSkillTool);
      // Register return_skill for nested skill calling
      this.toolRegistry.register(createReturnSkillTool());
    }

    // Initialize sub-agent configs and register delegate tool
    if (options.subAgents && options.subAgents.length > 0) {
      this.subAgentConfigs = new Map(options.subAgents.map((sa) => [sa.name, sa]));
      const delegateTool = createDelegateTool({
        subAgentConfigs: this.subAgentConfigs,
        llmProvider: this.llmProvider,
        model: this.options.model,
        parentToolRegistry: this.toolRegistry,
        subAgentFactory: this.subAgentFactory,
      });
      this.toolRegistry.register(delegateTool);
    }

    // Initialize execution policy
    this.executionPolicy = options.executionPolicy ?? new DefaultExecutionPolicy();

    // Initialize middleware
    this.middlewareExecutor = new MiddlewareExecutor(options.middleware ?? []);
    this.hasMiddleware = !this.middlewareExecutor.isEmpty;
  }

  /**
   * Create LLMClient from quick initialization config
   */
  private createLLMFromQuickInit(llm: LLMQuickInit, model: string): LLMClient {
    const concurrency = llm.maxConcurrency ?? 5;
    const provider = llm.provider ?? 'openai';

    const client = new LLMClient({ baseUrl: llm.baseUrl });
    client.registerProvider({ name: provider, maxConcurrency: concurrency });
    client.registerApiKey({
      key: llm.apiKey,
      provider,
      maxConcurrency: concurrency,
      models: [{ modelId: model, maxConcurrency: concurrency }],
    });

    return client;
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
      subAgentConfigs: this.subAgentConfigs,
      executionPolicy: this.executionPolicy,
      options: {
        model: this.options.model,
        systemPrompt: this.options.systemPrompt,
        requestTimeout: this.options.requestTimeout,
        maxSteps: this.options.maxSteps,
      },
    };
  }

  /**
   * Execute a single turn of conversation (blocking)
   *
   * @param state - Current agent state
   * @param userInput - User's message content
   * @param chatOptions - Optional chat configuration (priority, etc.)
   * @returns ChatResult with updated state and response
   *
   * @example
   * ```typescript
   * // Default priority
   * const result = await runner.chat(state, 'What is 2+2?');
   *
   * // High priority
   * const result = await runner.chat(state, 'Urgent!', { priority: 10 });
   *
   * console.log(result.response); // "4"
   * console.log(result.tokens); // { input: 15, output: 2 }
   * ```
   */
  async chat(state: AgentState, userInput: string, chatOptions?: ChatOptions): Promise<ChatResult> {
    // Initialize skill state if needed
    const initializedState = this.initializeSkillState(state);

    // 1. Add user message to state
    let newState = addUserMessage(initializedState, userInput);

    // 2. Prepare messages for LLM
    const messages = this.buildMessages(newState);

    // 3. Estimate context size
    const estimatedContextSize = messages.reduce(
      (sum, m) =>
        sum + estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)),
      0
    );
    newState = updateState(newState, (draft) => {
      draft.context.estimatedContextSize = estimatedContextSize;
    });

    // 4. Call LLM
    const response = await this.llmProvider.call({
      model: this.options.model,
      messages,
      priority: chatOptions?.priority ?? 0,
      requestTimeout: this.options.requestTimeout,
    });

    // 4. Add assistant message to state
    newState = addAssistantMessage(newState, response.content, {
      type: 'text',
    });

    // 6. Increment step count
    newState = incrementStepCount(newState);

    // 7. Track token usage
    if (response.tokens) {
      newState = updateTotalTokens(newState, response.tokens);
    }

    // 8. Clean up stale skill state on completion
    newState = this.cleanupStaleSkillState(newState);

    return {
      state: newState,
      response: response.content,
      tokens: response.tokens,
      stopReason: response.stopReason,
    };
  }

  /**
   * Execute a single turn of conversation (streaming)
   *
   * @param state - Current agent state
   * @param userInput - User's message content
   * @param chatOptions - Optional chat configuration (priority, etc.)
   * @returns Async iterable of ChatStreamChunk
   *
   * @remarks
   * The stream yields intermediate states that include the accumulated
   * content up to that point. The final state is only included in the
   * 'done' event.
   *
   * @example
   * ```typescript
   * // Default priority
   * for await (const chunk of runner.chatStream(state, 'Write a poem')) {
   *   switch (chunk.type) {
   *     case 'text':
   *       process.stdout.write(chunk.delta);
   *       break;
   *     case 'done':
   *       console.log('\nTotal tokens:', chunk.tokens);
   *       break;
   *     case 'error':
   *       console.error('Error:', chunk.error);
   *       break;
   *   }
   * }
   *
   * // Low priority (background processing)
   * for await (const chunk of runner.chatStream(state, 'Background task', { priority: -5 })) {
   *   // ...
   * }
   * ```
   */
  async *chatStream(
    state: AgentState,
    userInput: string,
    chatOptions?: ChatOptions
  ): AsyncIterable<ChatStreamChunk> {
    // Initialize skill state if needed
    const initializedState = this.initializeSkillState(state);

    // 1. Add user message to state (initial state for streaming)
    const currentState = addUserMessage(initializedState, userInput);

    // 2. Prepare messages for LLM
    const messages = this.buildMessages(currentState);

    // 3. Estimate context size
    const estimatedContextSize = messages.reduce(
      (sum, m) =>
        sum + estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)),
      0
    );
    const currentStateWithSize = updateState(currentState, (draft) => {
      draft.context.estimatedContextSize = estimatedContextSize;
    });

    // 4. Start streaming
    let accumulatedContent = '';

    try {
      for await (const event of this.llmProvider.stream({
        model: this.options.model,
        messages,
        priority: chatOptions?.priority ?? 0,
        requestTimeout: this.options.requestTimeout,
      })) {
        switch (event.type) {
          case 'text': {
            accumulatedContent =
              event.accumulatedContent ?? accumulatedContent + (event.delta ?? '');

            // Yield intermediate state with accumulated content
            yield {
              type: 'text',
              delta: event.delta,
              accumulatedContent,
              state: currentStateWithSize,
            };
            break;
          }

          case 'done': {
            // Finalize state with complete response
            let finalState = incrementStepCount(
              addAssistantMessage(currentStateWithSize, accumulatedContent, {
                type: 'text',
              })
            );
            // Track token usage
            if (event.roundTotalTokens) {
              finalState = updateTotalTokens(finalState, event.roundTotalTokens);
            }
            // Clean up stale skill state on completion
            finalState = this.cleanupStaleSkillState(finalState);

            yield {
              type: 'done',
              accumulatedContent,
              state: finalState,
              tokens: event.roundTotalTokens,
            };
            break;
          }

          case 'error': {
            yield {
              type: 'error',
              error: event.error,
              state: currentStateWithSize,
            };
            break;
          }

          // Ignore other event types for basic chat
          default:
            break;
        }
      }
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
        state: currentStateWithSize,
      };
    }
  }

  /**
   * Build messages array for LLM call from current state
   *
   * @param state - Current agent state
   * @returns Array of messages in LLM format
   *
   * @private
   */
  private buildMessages(state: AgentState): Message[] {
    return this.messageAssembler.build(state, {
      systemPrompt: this.options.systemPrompt,
      model: this.options.model,
      skillProvider: this._skillProvider,
      subAgentConfigs: this.subAgentConfigs,
    });
  }

  /**
   * Get tools formatted for LLM calls
   *
   * @param registry - Optional tool registry
   * @returns Array of tools in pi-ai format
   * @private
   */
  private getToolsForLLM(registry?: IToolRegistry): Tool[] | undefined {
    return getToolsForLLM(registry, this.toolSchemaFormatter);
  }

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
        stack: [],
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
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', { error: err, context: { step: stepNum }, timestamp: Date.now() });
      throw error;
    }
  }

  /**
   * Stream LLM response during calling-llm phase.
   *
   * Shared between advanceStream() and stepStream() to avoid duplicate logic.
   * Yields token events in real-time and stores the complete response in execState.
   *
   * @param state - Current agent state
   * @param execState - Execution state
   * @param registry - Tool registry
   * @yields StreamEvent token events
   *
   * @private
   */
  private async *streamCallingLLM(
    state: AgentState,
    execState: ExecutionState,
    registry?: IToolRegistry,
    signal?: AbortSignal
  ): AsyncGenerator<StreamEvent> {
    yield* streamCallingLLM(this.ctx, state, execState, registry, signal);
  }

  /**
   * 🔬 Micro-step: Stream phase advancement
   *
   * @param state - Current agent state
   * @param execState - Execution state
   * @param toolRegistry - Optional tool registry
   * @returns Async generator of stream events
   */
  async *advanceStream(
    state: AgentState,
    execState: ExecutionState,
    toolRegistry?: IToolRegistry,
    options?: AdvanceOptions,
    stepNumber?: number
  ): AsyncGenerator<StreamEvent, AdvanceResult> {
    const stepNum = stepNumber ?? 0;
    try {
      // ── beforeAdvance ──
      if (this.hasMiddleware) {
        const chain = await this.middlewareExecutor.runBeforeAdvance({
          state,
          execState,
          fromPhase: execState.phase,
          stepNumber: stepNum,
          runnerOptions: this.options,
        });
        if (chain.stopResult) return chain.stopResult;
        if (chain.state) state = chain.state;
        if (chain.execState) execState = chain.execState;
      }

      const generator = executeAdvanceStream(this.ctx, state, execState, toolRegistry, options);

      while (true) {
        const { done, value } = await generator.next();
        if (done) {
          let result = value as AdvanceResult;

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

          return result;
        }
        // Uniform forwarding: emit using the yield event's type and payload
        this.emit(value.type as keyof RunnerEventMap, value as never);
        yield value;
      }
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
    options?: { signal?: AbortSignal },
    stepNumber?: number
  ): Promise<{ state: AgentState; result: StepResult }> {
    const registry = toolRegistry ?? this.toolRegistry;
    let currentExecState = createExecutionState();
    const stepIdx = stepNumber ?? 0;

    // ── beforeStep ──
    if (this.hasMiddleware) {
      const chain = await this.middlewareExecutor.runBeforeStep({
        state,
        stepNumber: stepIdx,
        runnerOptions: this.options,
      });
      if (chain.stopped) {
        return {
          state,
          result: {
            type: 'error',
            error: new Error(`Stopped by middleware`),
            tokens: { input: 0, output: 0 },
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
          return {
            state: stepState,
            result: {
              type: 'error',
              error: new Error('Stopped by middleware'),
              tokens: stepResult.tokens,
            },
          };
        }
      }
      return { state: stepState, result: stepResult };
    };

    // Loop advance() until a natural stopping point
    let currentState = state;
    let stepTokens: TokenStats = { input: 0, output: 0 };

    try {
      while (!isTerminalPhase(currentExecState.phase)) {
        if (options?.signal?.aborted) {
          this.emit('abort', { step: stepIdx, timestamp: Date.now() });
          return { state: currentState, result: { type: 'abort', tokens: stepTokens } };
        }

        const from = currentExecState.phase;

        // ── beforeAdvance ──
        if (this.hasMiddleware) {
          const chain = await this.middlewareExecutor.runBeforeAdvance({
            state: currentState,
            execState: currentExecState,
            fromPhase: from,
            stepNumber: stepIdx,
            runnerOptions: this.options,
          });
          if (chain.stopResult)
            return {
              state: currentState,
              result: {
                type: 'error',
                error: new Error('Stopped by middleware'),
                tokens: stepTokens,
              },
            };
          if (chain.state) currentState = chain.state;
          if (chain.execState) currentExecState = chain.execState;
        }

        const result = await executeAdvance(
          this.ctx,
          currentState,
          currentExecState,
          registry,
          options
        );

        // ── afterAdvance ──
        let effectiveResult = result;
        if (this.hasMiddleware) {
          const chain = await this.middlewareExecutor.runAfterAdvance({
            state: result.state,
            execState: result.execState,
            result,
            stepNumber: stepIdx,
            runnerOptions: this.options,
          });
          if (chain.stopResult)
            return {
              state: currentState,
              result: {
                type: 'error',
                error: new Error('Stopped by middleware'),
                tokens: stepTokens,
              },
            };
          if (chain.state) effectiveResult = { ...result, state: chain.state };
          if (chain.execState) effectiveResult = { ...effectiveResult, execState: chain.execState };
        }

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
          this.emit('abort', { step: stepIdx, timestamp: Date.now() });
          return { state: nextState, result: { type: 'abort', tokens: stepTokens } };
        }

        currentState = await maybeCompress(this.compressor, nextState);

        // Emit executing-tool event
        if (effectiveResult.phase.type === 'executing-tool') {
          if (effectiveResult.phase.actions.length === 1) {
            this.emit('tool:start', {
              action: effectiveResult.phase.actions[0],
              timestamp: Date.now(),
            });
          } else {
            this.emit('tools:start', {
              actions: effectiveResult.phase.actions,
              timestamp: Date.now(),
            });
          }
        }

        // Forward effects produced by handler
        if (effectiveResult.effects && effectiveResult.effects.length > 0) {
          for (const effect of effectiveResult.effects) {
            this.emit(effect.type as keyof RunnerEventMap, effect as never);
          }
        }

        this.emit('phase-change', { from, to: effectiveResult.phase, timestamp: Date.now() });

        // Control flow is determined by phase + done
        if (effectiveResult.done && effectiveResult.phase.type === 'completed') {
          const stepResult: StepResult = {
            type: 'done',
            answer: effectiveResult.phase.answer,
            tokens: stepTokens,
          };
          return finalizeStep(currentState, stepResult);
        }

        if (effectiveResult.done && effectiveResult.phase.type === 'error') {
          const stepResult: StepResult = {
            type: 'error',
            error: effectiveResult.phase.error,
            tokens: stepTokens,
          };
          return finalizeStep(currentState, stepResult);
        }

        // ToolResultHandler has processed tool-result phase (effects indicate processed)
        // Next step depends on handler output
        if (
          effectiveResult.phase.type === 'tool-result' &&
          effectiveResult.effects &&
          effectiveResult.effects.length > 0
        ) {
          // same-skill/cyclic/plain tool → return continue
          const toolResult = currentExecState.toolResult;
          const actions =
            currentExecState.allActions ??
            (currentExecState.action ? [currentExecState.action] : []);
          const stepResult: StepResult = {
            type: 'continue',
            toolResult,
            actions,
            tokens: stepTokens,
          };
          return finalizeStep(currentState, stepResult);
        }

        // ExecutingToolHandler returned tool-result (no effects) → continue loop for ToolResultHandler
        if (
          effectiveResult.phase.type === 'tool-result' &&
          (!effectiveResult.effects || effectiveResult.effects.length === 0)
        ) {
          continue;
        }

        // Skill loaded/returned → phase reset to idle, continue loop
        if (result.phase.type === 'idle') {
          continue;
        }
      }

      // Should not reach here
      throw new Error('Unexpected: step loop exited without reaching terminal phase');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', { error: err, context: { step: stepIdx }, timestamp: Date.now() });
      throw error;
    }
  }

  /**
   * 🦶 Meso-step: Stream one ReAct cycle with observation
   *
   * @param state - Current agent state
   * @param toolRegistry - Optional tool registry
   * @returns Async generator of stream events
   */
  async *stepStream(
    state: AgentState,
    toolRegistry?: IToolRegistry,
    options?: { signal?: AbortSignal },
    stepNumber?: number
  ): AsyncGenerator<StreamEvent, { state: AgentState; result: StepResult }> {
    const stepIdx = stepNumber ?? 0;

    // ── beforeStep ──
    if (this.hasMiddleware) {
      const chain = await this.middlewareExecutor.runBeforeStep({
        state,
        stepNumber: stepIdx,
        runnerOptions: this.options,
      });
      if (chain.stopped) {
        return {
          state,
          result: {
            type: 'error',
            error: new Error('Stopped by middleware'),
            tokens: { input: 0, output: 0 },
          },
        };
      }
      if (chain.state) state = chain.state;
    }

    this.emit('step:start', { step: stepIdx, state, timestamp: Date.now() });
    try {
      const mw = this.hasMiddleware ? this.middlewareExecutor : undefined;
      const generator = executeStepStream(
        this.ctx,
        this.compressor,
        state,
        toolRegistry,
        options,
        mw,
        stepIdx,
        this.options
      );

      while (true) {
        const { done, value } = await generator.next();
        if (done) {
          const result = value as { state: AgentState; result: StepResult };
          this.emit('step:end', { step: stepIdx, result: result.result, timestamp: Date.now() });

          // ── afterStep ──
          if (this.hasMiddleware) {
            const chain = await this.middlewareExecutor.runAfterStep({
              state: result.state,
              result: result.result,
              stepNumber: stepIdx,
              runnerOptions: this.options,
            });
            if (chain.state) result.state = chain.state;
            if (chain.stopped) {
              return {
                state: result.state,
                result: {
                  type: 'error',
                  error: new Error('Stopped by middleware'),
                  tokens: result.result.tokens,
                },
              };
            }
          }

          return result;
        }
        // Uniform forwarding: emit using the yield event's type and payload
        this.emit(value.type as keyof RunnerEventMap, value as never);
        yield value;
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', { error: err, context: { step: stepIdx }, timestamp: Date.now() });
      throw error;
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
    options?: { maxSteps?: number; signal?: AbortSignal },
    toolRegistry?: IToolRegistry
  ): Promise<{ state: AgentState; result: RunResult }> {
    // Initialize skill state if needed
    let currentState = this.initializeSkillState(state);

    // ── beforeRun ──
    if (this.hasMiddleware) {
      const chain = await this.middlewareExecutor.runBeforeRun({
        state: currentState,
        runnerOptions: this.options,
      });
      if (chain.stopped) {
        const runResult: RunResult = {
          type: 'error',
          error: new Error('Stopped by middleware'),
          totalSteps: 0,
          tokens: { input: 0, output: 0 },
        };
        return { state: currentState, result: runResult };
      }
      if (chain.state) currentState = chain.state;
    }

    this.emit('run:start', { state: currentState, timestamp: Date.now() });
    const registry = toolRegistry ?? this.toolRegistry;
    const maxSteps = options?.maxSteps ?? this.options.maxSteps ?? 10;
    let totalSteps = 0;
    let runTokens: TokenStats = { input: 0, output: 0 };

    // Helper to emit run:end and run afterRun middleware
    const finalizeRun = async (
      runState: AgentState,
      runResult: RunResult
    ): Promise<{ state: AgentState; result: RunResult }> => {
      this.emit('run:end', { state: runState, result: runResult, timestamp: Date.now() });
      if (this.hasMiddleware) {
        await this.middlewareExecutor.runAfterRun({
          state: runState,
          result: runResult,
          runnerOptions: this.options,
        });
      }
      return { state: runState, result: runResult };
    };

    try {
      while (totalSteps < RUN_HARD_LIMIT) {
        if (options?.signal?.aborted) {
          const runResult: RunResult = { type: 'abort', totalSteps, tokens: runTokens };
          this.emit('abort', { totalSteps, timestamp: Date.now() });
          return finalizeRun(currentState, runResult);
        }

        // Call step() to get full event propagation (advance → step → run)
        const { state: newState, result } = await this.step(
          currentState,
          registry,
          options,
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
          };
          return finalizeRun(newState, runResult);
        }

        currentState = newState;
        totalSteps++;

        const decision = this.executionPolicy.shouldStop(currentState, result, {
          stepCount: totalSteps,
          maxSteps,
        });

        if (decision.decision === 'stop') {
          let runResult: RunResult;

          if (decision.runResultType === 'success') {
            // Defensive cleanup: clear skillState when top-level skill replies directly (without return_skill)
            currentState = this.cleanupStaleSkillState(currentState);
            runResult = {
              type: 'success',
              answer: (result as { type: 'done'; answer: string }).answer,
              totalSteps,
              tokens: runTokens,
            };
          } else if (decision.runResultType === 'error') {
            runResult = {
              type: 'error',
              error: (result as { type: 'error'; error: Error }).error,
              totalSteps,
              tokens: runTokens,
            };
            this.emit('error', {
              error: runResult.error,
              context: { step: totalSteps - 1 },
              timestamp: Date.now(),
            });
          } else if (decision.runResultType === 'abort') {
            runResult = { type: 'abort', totalSteps, tokens: runTokens };
            this.emit('abort', { totalSteps, timestamp: Date.now() });
          } else {
            runResult = { type: 'max_steps', totalSteps, tokens: runTokens };
          }

          return finalizeRun(currentState, runResult);
        }

        // Auto-compress between steps
        if (this.compressor && this.compressor.shouldCompress(currentState)) {
          this.emit('compressing', { timestamp: Date.now() });
          const prevAnchor = currentState.context.compression?.anchor ?? 0;
          currentState = await maybeCompress(this.compressor, currentState);
          const newAnchor = currentState.context.compression?.anchor ?? 0;
          if (currentState.context.compression) {
            this.emit('compressed', {
              summary: currentState.context.compression.summary,
              removedCount: newAnchor - prevAnchor,
              timestamp: Date.now(),
            });
          }
        }
      }

      // Hard limit reached (safety net for policy bugs)
      const runResult: RunResult = { type: 'max_steps', totalSteps, tokens: runTokens };
      return finalizeRun(currentState, runResult);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', { error: err, context: { step: totalSteps }, timestamp: Date.now() });
      throw error;
    }
  }

  /**
   * 🏃 Macro-step: Stream run until completion
   *
   * Loops stepStream() and yields cross-step events including real-time tokens.
   * Caller can break out at any time to interrupt.
   *
   * @param state - Current agent state
   * @param options - Optional run configuration (maxSteps)
   * @param toolRegistry - Optional tool registry override
   * @returns Async generator yielding RunStreamEvent, final return is { state, result }
   *
   * @example
   * ```typescript
   * for await (const event of runner.runStream(state)) {
   *   if (event.type === 'token') process.stdout.write(event.token);
   *   if (event.type === 'complete') console.log('\nDone:', event.result);
   * }
   * ```
   */
  async *runStream(
    state: AgentState,
    options?: { maxSteps?: number; signal?: AbortSignal },
    toolRegistry?: IToolRegistry
  ): AsyncGenerator<RunStreamEvent, { state: AgentState; result: RunResult }> {
    // Initialize skill state if needed
    let currentState = this.initializeSkillState(state);

    // ── beforeRun ──
    if (this.hasMiddleware) {
      const chain = await this.middlewareExecutor.runBeforeRun({
        state: currentState,
        runnerOptions: this.options,
      });
      if (chain.stopped) {
        const runResult: RunResult = {
          type: 'error',
          error: new Error('Stopped by middleware'),
          totalSteps: 0,
          tokens: { input: 0, output: 0 },
        };
        return { state: currentState, result: runResult };
      }
      if (chain.state) currentState = chain.state;
    }

    this.emit('run:start', { state: currentState, timestamp: Date.now() });
    const registry = toolRegistry ?? this.toolRegistry;
    const maxSteps = options?.maxSteps ?? this.options.maxSteps ?? 10;
    let totalSteps = 0;
    let runTokens: TokenStats = { input: 0, output: 0 };

    // Helper for run:end + afterRun middleware (yields complete event before return)
    const finalizeRunStream = async function* (
      this: AgentRunner,
      runState: AgentState,
      runResult: RunResult
    ): AsyncGenerator<RunStreamEvent, { state: AgentState; result: RunResult }> {
      this.emit('run:end', { state: runState, result: runResult, timestamp: Date.now() });
      if (this.hasMiddleware) {
        await this.middlewareExecutor.runAfterRun({
          state: runState,
          result: runResult,
          runnerOptions: this.options,
        });
      }
      yield { type: 'complete', result: runResult, timestamp: Date.now() };
      return { state: runState, result: runResult };
    }.bind(this);

    try {
      while (totalSteps < RUN_HARD_LIMIT) {
        if (options?.signal?.aborted) {
          const runResult: RunResult = { type: 'abort', totalSteps, tokens: runTokens };
          this.emit('abort', { totalSteps, timestamp: Date.now() });
          return yield* finalizeRunStream(currentState, runResult);
        }

        // Step start
        this.emit('step:start', { step: totalSteps, state: currentState, timestamp: Date.now() });
        yield { type: 'step:start', step: totalSteps, state: currentState, timestamp: Date.now() };

        // ── beforeStep ──
        if (this.hasMiddleware) {
          const chain = await this.middlewareExecutor.runBeforeStep({
            state: currentState,
            stepNumber: totalSteps,
            runnerOptions: this.options,
          });
          if (chain.stopped) {
            const stepResult = {
              type: 'error' as const,
              error: new Error('Stopped by middleware'),
              tokens: { input: 0, output: 0 } as TokenStats,
            };
            this.emit('step:end', { step: totalSteps, result: stepResult, timestamp: Date.now() });
            yield { type: 'step:end', step: totalSteps, result: stepResult, timestamp: Date.now() };
            totalSteps++;
            const runResult: RunResult = {
              type: 'error',
              error: stepResult.error,
              totalSteps,
              tokens: runTokens,
            };
            return yield* finalizeRunStream(currentState, runResult);
          }
          if (chain.state) currentState = chain.state;
        }

        // Use executeStepStream to get real-time tokens and phase events
        const mw = this.hasMiddleware ? this.middlewareExecutor : undefined;
        const iterator = executeStepStream(
          this.ctx,
          this.compressor,
          currentState,
          registry,
          options,
          mw,
          totalSteps
        );
        let stepResult: { state: AgentState; result: StepResult };

        while (true) {
          const { done, value } = await iterator.next();
          if (done) {
            stepResult = value;
            break;
          }
          // Uniform forwarding: emit using the yield event's type and payload
          this.emit(value.type as keyof RunnerEventMap, value as never);
          yield value as RunStreamEvent;
        }

        if (stepResult.result.tokens) {
          runTokens = addTokenStats(runTokens, stepResult.result.tokens);
        }

        if (stepResult.result.type === 'abort') {
          const runResult: RunResult = {
            type: 'abort',
            totalSteps: totalSteps + 1,
            tokens: runTokens,
          };
          return yield* finalizeRunStream(stepResult.state, runResult);
        }

        // ── afterStep ──
        if (this.hasMiddleware) {
          const chain = await this.middlewareExecutor.runAfterStep({
            state: stepResult.state,
            result: stepResult.result,
            stepNumber: totalSteps,
            runnerOptions: this.options,
          });
          if (chain.state) stepResult = { ...stepResult, state: chain.state };
          if (chain.stopped) {
            const stoppedResult = {
              type: 'error' as const,
              error: new Error('Stopped by middleware'),
              tokens: stepResult.result.tokens,
            };
            this.emit('step:end', {
              step: totalSteps,
              result: stoppedResult,
              timestamp: Date.now(),
            });
            yield {
              type: 'step:end',
              step: totalSteps,
              result: stoppedResult,
              timestamp: Date.now(),
            };
            totalSteps++;
            const runResult: RunResult = {
              type: 'error',
              error: stoppedResult.error,
              totalSteps,
              tokens: runTokens,
            };
            return yield* finalizeRunStream(stepResult.state, runResult);
          }
        }

        currentState = stepResult.state;
        this.emit('step:end', {
          step: totalSteps,
          result: stepResult.result,
          timestamp: Date.now(),
        });
        yield {
          type: 'step:end',
          step: totalSteps,
          result: stepResult.result,
          timestamp: Date.now(),
        };
        totalSteps++;

        // Auto-compress between steps
        if (this.compressor && this.compressor.shouldCompress(currentState)) {
          this.emit('compressing', { timestamp: Date.now() });
          yield { type: 'compressing', timestamp: Date.now() };
          const prevAnchor = stepResult.state.context.compression?.anchor ?? 0;
          currentState = await maybeCompress(this.compressor, currentState);
          const newAnchor = currentState.context.compression?.anchor ?? 0;
          if (currentState.context.compression) {
            this.emit('compressed', {
              summary: currentState.context.compression.summary,
              removedCount: newAnchor - prevAnchor,
              timestamp: Date.now(),
            });
            yield {
              type: 'compressed',
              summary: currentState.context.compression.summary,
              removedCount: newAnchor - prevAnchor,
              timestamp: Date.now(),
            };
          }
        }

        // Delegate stop decision to execution policy
        const decision = this.executionPolicy.shouldStop(currentState, stepResult.result, {
          stepCount: totalSteps,
          maxSteps,
        });

        if (decision.decision === 'stop') {
          let runResult: RunResult;

          if (decision.runResultType === 'success') {
            // Defensive cleanup: clear skillState when top-level skill replies directly (without return_skill)
            currentState = this.cleanupStaleSkillState(currentState);
            runResult = {
              type: 'success',
              answer: (stepResult.result as { type: 'done'; answer: string }).answer,
              totalSteps,
              tokens: runTokens,
            };
          } else if (decision.runResultType === 'error') {
            runResult = {
              type: 'error',
              error: (stepResult.result as { type: 'error'; error: Error }).error,
              totalSteps,
              tokens: runTokens,
            };
            this.emit('error', {
              error: runResult.error,
              context: { step: totalSteps - 1 },
              timestamp: Date.now(),
            });
          } else if (decision.runResultType === 'abort') {
            runResult = { type: 'abort', totalSteps, tokens: runTokens };
            this.emit('abort', { totalSteps, timestamp: Date.now() });
          } else {
            runResult = { type: 'max_steps', totalSteps, tokens: runTokens };
          }

          return yield* finalizeRunStream(currentState, runResult);
        }
      }

      // Hard limit reached (safety net for policy bugs)
      const runResult: RunResult = { type: 'max_steps', totalSteps, tokens: runTokens };
      return yield* finalizeRunStream(currentState, runResult);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', { error: err, context: { step: totalSteps }, timestamp: Date.now() });
      throw error;
    }
  }

  /**
   * Manually trigger context compression
   *
   * @param state - Current agent state
   * @returns New state with compression metadata (immutable)
   * @throws Error if no compressor is configured
   *
   * @example
   * ```typescript
   * const compressedState = await runner.compress(state);
   * // compressedState.context.compression is set
   * // compressedState.context.messages is unchanged
   * ```
   */
  async compress(state: AgentState): Promise<AgentState> {
    if (!this.compressor) {
      throw new Error('No compressor configured. Pass compressor in RunnerOptions.');
    }
    return compressState(this.compressor, state);
  }

  /**
   * Defensive cleanup: when a run ends successfully, if the top-level skill is still active
   * (return_skill was not called), automatically clear skillState to prevent stale breadcrumbs.
   *
   * @param state - Current AgentState
   * @returns Cleaned AgentState (if cleanup was needed)
   */
  private cleanupStaleSkillState(state: AgentState): AgentState {
    const ss = state.context.skillState;
    if (!ss || !ss.current) return state;
    // Only clean up top-level skill (empty stack); nested skill cleanup is handled by return_skill
    if (ss.stack.length > 0) return state;
    return updateState(state, (draft) => {
      draft.context.skillState!.current = null;
      draft.context.skillState!.loadedInstructions = undefined;
    });
  }
}
