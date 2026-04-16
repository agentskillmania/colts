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
} from './types.js';
import { ConfigurationError } from './types.js';
import { DefaultContextCompressor } from './compressor.js';
import { addUserMessage, addAssistantMessage, incrementStepCount, updateState } from './state.js';
import { ToolRegistry } from './tools/registry.js';
import type { Tool as ColtsTool } from './tools/registry.js';
import type {
  StepResult,
  AdvanceResult,
  ExecutionState,
  StreamEvent,
  RunResult,
  RunStreamEvent,
  Phase,
  Action,
} from './execution.js';
import type { AdvanceOptions } from './execution.js';
import { createExecutionState, isTerminalPhase } from './execution.js';
import { getToolsForLLM } from './tools/llm-format.js';
import type { IToolSchemaFormatter } from './tools/schema-formatter.js';
import { DefaultToolSchemaFormatter } from './tools/schema-formatter.js';
import { DefaultMessageAssembler } from './message-assembler/index.js';
import type { IMessageAssembler } from './message-assembler/types.js';
import { compressState, maybeCompress } from './runner-compression.js';
import { executeAdvance, createRouter } from './runner-advance.js';
import type { RunnerContext } from './runner-advance.js';
import { streamCallingLLM, executeAdvanceStream, executeStepStream } from './runner-stream.js';
import type { ISkillProvider } from './skills/types.js';
import { FilesystemSkillProvider } from './skills/filesystem-provider.js';
import { createLoadSkillTool, createReturnSkillTool } from './skills/index.js';
import type { SubAgentConfig, DelegateResult, ISubAgentFactory } from './subagent/types.js';
import { DefaultSubAgentFactory } from './subagent/types.js';
import { createDelegateTool } from './subagent/delegate-tool.js';
import { EventEmitter } from 'eventemitter3';
import { processToolResult } from './runner-process-tool-result.js';
import type { ToolPostEffect } from './runner-process-tool-result.js';

/**
 * Runner event map — fully aligned with AsyncGenerator StreamEvent / RunStreamEvent.
 *
 * Yield events are the source of truth; EventEmitter acts as a bridge.
 * run:start / run:end are EventEmitter-only lifecycle events (no yield equivalents).
 */
export interface RunnerEventMap {
  // ── Lifecycle (run-level, EventEmitter-only) ──
  /** Run started */
  'run:start': { state: AgentState };
  /** Run ended */
  'run:end': { state: AgentState; result: RunResult };

  // ── Lifecycle (step-level, aligned with RunStreamEvent) ──
  /** Step started */
  'step:start': { step: number; state: AgentState };
  /** Step ended */
  'step:end': { step: number; result: StepResult };
  /** Run completed */
  complete: { result: RunResult };

  // ── Execution process (aligned with StreamEvent) ──
  /** Phase transition */
  'phase-change': { from: Phase; to: Phase };
  /** LLM token streaming output */
  token: { token: string };
  /** Tool execution started */
  'tool:start': { action: Action };
  /** Tool execution completed */
  'tool:end': { result: unknown };
  /** Parallel tool execution started */
  'tools:start': { actions: Action[] };
  /** Parallel tool execution completed */
  'tools:end': { results: Record<string, unknown> };
  /** Execution error */
  error: { error: Error; context: { toolName?: string; step: number } };

  // ── Context compression (aligned with StreamEvent) ──
  /** Compression started */
  compressing: Record<string, never>;
  /** Compression completed */
  compressed: { summary: string; removedCount: number };

  // ── Skill (aligned with StreamEvent) ──
  /** Skill loading */
  'skill:loading': { name: string };
  /** Skill loaded */
  'skill:loaded': { name: string; tokenCount: number };
  /** Skill execution started */
  'skill:start': { name: string; task: string; state?: AgentState };
  /** Skill execution completed */
  'skill:end': { name: string; result: string; state?: AgentState };

  // ── SubAgent (aligned with StreamEvent) ──
  /** Sub-agent started */
  'subagent:start': { name: string; task: string };
  /** Sub-agent completed */
  'subagent:end': { name: string; result: DelegateResult };

  // ── LLM call (aligned with StreamEvent) ──
  /** Before LLM request is sent */
  'llm:request': {
    messages: Array<{ role: string; content: string }>;
    tools: string[];
    skill: { current: string | null; stack: string[] } | null;
  };
  /** After LLM response is received */
  'llm:response': {
    text: string;
    toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> | null;
  };
}

/**
 * Configuration options for AgentRunner
 *
 * Supports both injection and quick initialization patterns
 */
export interface RunnerOptions {
  /** Model identifier to use for LLM calls */
  model: string;

  // --- LLM: injection or quick initialization (mutually exclusive) ---
  /** LLM provider instance (injection mode) */
  llmClient?: ILLMProvider;
  /** LLM quick initialization config (quick init mode) */
  llm?: LLMQuickInit;

  // --- Tools: injection or quick initialization (can be merged) ---
  /** Tool registry instance (injection mode) */
  toolRegistry?: IToolRegistry;
  /** Tools array for quick initialization */
  tools?: ColtsTool[];

  /** System prompt/instructions (optional) - merged with AgentConfig.instructions */
  systemPrompt?: string;

  /** Request timeout in milliseconds (optional) */
  requestTimeout?: number;

  /** Default max steps for run() (default: 10) */
  maxSteps?: number;

  /** Context compressor: pass CompressionConfig for built-in, or IContextCompressor for custom */
  compressor?: CompressionConfig | IContextCompressor;

  // --- Skills: injection or quick initialization ---
  /** Skill provider instance (injection mode) */
  skillProvider?: ISkillProvider;
  /** Skill directory list (quick init, creates FilesystemSkillProvider internally) */
  skillDirectories?: string[];

  // --- SubAgents ---
  /** Sub-agent configuration list, auto-registers delegate tool when provided */
  subAgents?: SubAgentConfig[];

  // --- Extensibility ---
  /** Tool schema formatter (defaults to DefaultToolSchemaFormatter) */
  toolSchemaFormatter?: IToolSchemaFormatter;
  /** Sub-agent factory (defaults to DefaultSubAgentFactory) */
  subAgentFactory?: ISubAgentFactory;
}

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
        parentToolRegistry: this.toolRegistry,
        subAgentFactory: this.subAgentFactory,
      });
      this.toolRegistry.register(delegateTool);
    }
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

    // 3. Call LLM
    const response = await this.llmProvider.call({
      model: this.options.model,
      messages,
      priority: chatOptions?.priority ?? 0,
      requestTimeout: this.options.requestTimeout,
    });

    // 4. Add assistant message to state
    newState = addAssistantMessage(newState, response.content, {
      type: 'final',
    });

    // 5. Increment step count
    newState = incrementStepCount(newState);

    // 6. Clean up stale skill state on completion
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

    // 3. Start streaming
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
              state: currentState,
            };
            break;
          }

          case 'done': {
            // Finalize state with complete response
            let finalState = incrementStepCount(
              addAssistantMessage(currentState, accumulatedContent, {
                type: 'final',
              })
            );
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
              state: currentState,
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
        state: currentState,
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
    options?: AdvanceOptions
  ): Promise<AdvanceResult> {
    const from = execState.phase;
    try {
      const result = await executeAdvance(this.ctx, state, execState, toolRegistry, options);

      // Emit corresponding StreamEvent based on phase type
      if (result.phase.type === 'executing-tool') {
        if (result.phase.actions.length === 1) {
          this.emit('tool:start', { action: result.phase.actions[0] });
        } else {
          this.emit('tools:start', { actions: result.phase.actions });
        }
      }
      if (result.phase.type === 'tool-result') {
        const keys = Object.keys(result.phase.results);
        if (keys.length === 1) {
          this.emit('tool:end', { result: result.phase.results[keys[0]] });
        } else {
          this.emit('tools:end', { results: result.phase.results });
        }
      }
      if (result.phase.type === 'error') {
        this.emit('error', { error: result.phase.error, context: { step: 0 } });
      }
      this.emit('phase-change', { from, to: result.phase });
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', { error: err, context: { step: 0 } });
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
    options?: AdvanceOptions
  ): AsyncGenerator<StreamEvent, AdvanceResult> {
    try {
      const generator = executeAdvanceStream(this.ctx, state, execState, toolRegistry, options);

      while (true) {
        const { done, value } = await generator.next();
        if (done) {
          return value as AdvanceResult;
        }
        // Uniform forwarding: emit using the yield event's type and payload
        this.emit(value.type as keyof RunnerEventMap, value as never);
        yield value;
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', { error: err, context: { step: 0 } });
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
    const execState = createExecutionState();
    const stepIdx = stepNumber ?? 0;

    this.emit('step:start', { step: stepIdx, state });

    // Loop advance() until a natural stopping point
    let currentState = state;

    try {
      while (!isTerminalPhase(execState.phase)) {
        options?.signal?.throwIfAborted();

        const from = execState.phase;
        const {
          state: newState,
          phase,
          done,
        } = await executeAdvance(this.ctx, currentState, execState, registry, options);

        currentState = await maybeCompress(this.compressor, newState);

        // Emit corresponding StreamEvent based on phase type
        if (phase.type === 'executing-tool') {
          if (phase.actions.length === 1) {
            this.emit('tool:start', { action: phase.actions[0] });
          } else {
            this.emit('tools:start', { actions: phase.actions });
          }
        }
        this.emit('phase-change', { from, to: phase });

        // Terminal: completed (direct answer, no tool call)
        if (done && phase.type === 'completed') {
          const result: StepResult = { type: 'done', answer: phase.answer };
          this.emit('step:end', { step: stepIdx, result });
          return { state: currentState, result };
        }

        // Terminal: error (LLM call failed)
        if (done && phase.type === 'error') {
          const result: StepResult = { type: 'error', error: phase.error };
          this.emit('step:end', { step: stepIdx, result });
          return { state: currentState, result };
        }

        // Tool-result: delegate to shared processToolResult
        if (phase.type === 'tool-result') {
          const outcome = await processToolResult(currentState, execState, registry);
          currentState = await maybeCompress(this.compressor, outcome.state);

          // Forward lifecycle effects to EventEmitter
          for (const effect of outcome.effects) {
            if ((effect.type as string).startsWith('step:')) continue;
            this.emit(effect.type as keyof RunnerEventMap, effect as never);
          }

          // Determine step control flow from effects
          const stepEffect = outcome.effects.find((e): e is ToolPostEffect & { type: string } =>
            (e.type as string).startsWith('step:')
          );

          if (stepEffect?.type === 'step:continue') {
            // Continue the while loop (e.g. skill loaded/returned)
            continue;
          }
          if (stepEffect?.type === 'step:done') {
            const answer = (stepEffect as { type: 'step:done'; answer: string }).answer;
            const result: StepResult = { type: 'done', answer };
            this.emit('step:end', { step: stepIdx, result });
            return { state: currentState, result };
          }
          if (stepEffect?.type === 'step:error') {
            const error = (stepEffect as { type: 'step:error'; error: Error }).error;
            const result: StepResult = { type: 'error', error };
            this.emit('step:end', { step: stepIdx, result });
            return { state: currentState, result };
          }

          // step:continue-return (same-skill, cyclic, plain tool)
          const toolResult = (stepEffect as { type: 'step:continue-return'; toolResult: unknown })
            .toolResult;
          const result: StepResult = { type: 'continue', toolResult };
          this.emit('step:end', { step: stepIdx, result });
          return { state: currentState, result };
        }
      }

      // Should not reach here
      throw new Error('Unexpected: step loop exited without reaching terminal phase');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', { error: err, context: { step: stepIdx } });
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
    this.emit('step:start', { step: stepIdx, state });
    try {
      const generator = executeStepStream(this.ctx, this.compressor, state, toolRegistry, options);

      while (true) {
        const { done, value } = await generator.next();
        if (done) {
          const result = value as { state: AgentState; result: StepResult };
          this.emit('step:end', { step: stepIdx, result: result.result });
          return result;
        }
        // Uniform forwarding: emit using the yield event's type and payload
        this.emit(value.type as keyof RunnerEventMap, value as never);
        yield value;
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', { error: err, context: { step: stepIdx } });
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
    const initializedState = this.initializeSkillState(state);

    this.emit('run:start', { state: initializedState });
    const registry = toolRegistry ?? this.toolRegistry;
    const maxSteps = options?.maxSteps ?? this.options.maxSteps ?? 10;
    let currentState = initializedState;
    let totalSteps = 0;

    try {
      while (totalSteps < maxSteps) {
        options?.signal?.throwIfAborted();

        // Call step() to get full event propagation (advance → step → run)
        const { state: newState, result } = await this.step(
          currentState,
          registry,
          options,
          totalSteps
        );
        currentState = newState;
        totalSteps++;

        if (result.type === 'done') {
          // Defensive cleanup: clear skillState when top-level skill replies directly (without return_skill)
          currentState = this.cleanupStaleSkillState(currentState);
          const runResult: RunResult = { type: 'success', answer: result.answer, totalSteps };
          this.emit('run:end', { state: currentState, result: runResult });
          return { state: currentState, result: runResult };
        }

        if (result.type === 'error') {
          const runResult: RunResult = { type: 'error', error: result.error, totalSteps };
          this.emit('error', { error: result.error, context: { step: totalSteps - 1 } });
          this.emit('run:end', { state: currentState, result: runResult });
          return { state: currentState, result: runResult };
        }

        // Auto-compress between steps
        if (this.compressor && this.compressor.shouldCompress(currentState)) {
          this.emit('compressing', {});
          const prevAnchor = currentState.context.compression?.anchor ?? 0;
          currentState = await maybeCompress(this.compressor, currentState);
          const newAnchor = currentState.context.compression?.anchor ?? 0;
          if (currentState.context.compression) {
            this.emit('compressed', {
              summary: currentState.context.compression.summary,
              removedCount: newAnchor - prevAnchor,
            });
          }
        }
      }

      // maxSteps exhausted
      const runResult: RunResult = { type: 'max_steps', totalSteps };
      this.emit('run:end', { state: currentState, result: runResult });
      return { state: currentState, result: runResult };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', { error: err, context: { step: totalSteps } });
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
    const initializedState = this.initializeSkillState(state);

    this.emit('run:start', { state: initializedState });
    const registry = toolRegistry ?? this.toolRegistry;
    const maxSteps = options?.maxSteps ?? this.options.maxSteps ?? 10;
    let currentState = initializedState;
    let totalSteps = 0;

    try {
      while (totalSteps < maxSteps) {
        options?.signal?.throwIfAborted();

        // Step start
        this.emit('step:start', { step: totalSteps, state: currentState });
        yield { type: 'step:start', step: totalSteps, state: currentState };

        // Use stepStream to get real-time tokens and phase events
        const iterator = executeStepStream(
          this.ctx,
          this.compressor,
          currentState,
          registry,
          options
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

        currentState = stepResult.state;
        this.emit('step:end', { step: totalSteps, result: stepResult.result });
        yield { type: 'step:end', step: totalSteps, result: stepResult.result };
        totalSteps++;

        // Auto-compress between steps
        if (this.compressor && this.compressor.shouldCompress(currentState)) {
          this.emit('compressing', {});
          yield { type: 'compressing' };
          const prevAnchor = stepResult.state.context.compression?.anchor ?? 0;
          currentState = await maybeCompress(this.compressor, currentState);
          const newAnchor = currentState.context.compression?.anchor ?? 0;
          if (currentState.context.compression) {
            this.emit('compressed', {
              summary: currentState.context.compression.summary,
              removedCount: newAnchor - prevAnchor,
            });
            yield {
              type: 'compressed',
              summary: currentState.context.compression.summary,
              removedCount: newAnchor - prevAnchor,
            };
          }
        }

        if (stepResult.result.type === 'done') {
          // Defensive cleanup: clear skillState when top-level skill replies directly (without return_skill)
          currentState = this.cleanupStaleSkillState(currentState);
          const runResult: RunResult = {
            type: 'success',
            answer: stepResult.result.answer,
            totalSteps,
          };
          this.emit('run:end', { state: currentState, result: runResult });
          yield { type: 'complete', result: runResult };
          return { state: currentState, result: runResult };
        }

        if (stepResult.result.type === 'error') {
          const runResult: RunResult = {
            type: 'error',
            error: stepResult.result.error,
            totalSteps,
          };
          this.emit('error', {
            error: stepResult.result.error,
            context: { step: totalSteps - 1 },
          });
          this.emit('run:end', { state: currentState, result: runResult });
          yield { type: 'complete', result: runResult };
          return { state: currentState, result: runResult };
        }
      }

      // maxSteps exhausted
      const runResult: RunResult = { type: 'max_steps', totalSteps };
      this.emit('run:end', { state: currentState, result: runResult });
      yield { type: 'complete', result: runResult };
      return { state: currentState, result: runResult };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', { error: err, context: { step: totalSteps } });
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
