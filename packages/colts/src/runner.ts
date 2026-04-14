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
import { addUserMessage, addAssistantMessage, incrementStepCount } from './state.js';
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
import { buildMessages, getToolsForLLM } from './runner-message-builder.js';
import { compressState, maybeCompress } from './runner-compression.js';
import { executeAdvance } from './runner-advance.js';
import type { RunnerContext } from './runner-advance.js';
import { streamCallingLLM, executeAdvanceStream, executeStepStream } from './runner-stream.js';
import type { ISkillProvider } from './skills/types.js';
import { FilesystemSkillProvider } from './skills/filesystem-provider.js';
import { createLoadSkillTool, createReturnSkillTool } from './skills/index.js';
import type { SubAgentConfig, DelegateResult } from './subagent/types.js';
import { createDelegateTool } from './subagent/delegate-tool.js';
import { EventEmitter } from 'eventemitter3';

/**
 * Runner 事件映射 — 与 AsyncGenerator 的 StreamEvent / RunStreamEvent 完全对齐
 *
 * 以 yield 事件为 source of truth，EventEmitter 只是 bridge。
 * run:start / run:end 是 EventEmitter 独有的生命周期事件（yield 体系无对应物）。
 */
export interface RunnerEventMap {
  // ── 生命周期（run 级，EventEmitter 独有） ──
  /** run 开始 */
  'run:start': { state: AgentState };
  /** run 结束 */
  'run:end': { state: AgentState; result: RunResult };

  // ── 生命周期（step 级，与 RunStreamEvent 对齐） ──
  /** step 开始 */
  'step:start': { step: number; state: AgentState };
  /** step 结束 */
  'step:end': { step: number; result: StepResult };
  /** run 完成 */
  complete: { result: RunResult };

  // ── 执行过程（与 StreamEvent 对齐） ──
  /** 阶段转换 */
  'phase-change': { from: Phase; to: Phase };
  /** LLM token 流式输出 */
  token: { token: string };
  /** 工具开始执行 */
  'tool:start': { action: Action };
  /** 工具执行完成 */
  'tool:end': { result: unknown };
  /** 执行错误 */
  error: { error: Error; context: { toolName?: string; step: number } };

  // ── 上下文压缩（与 StreamEvent 对齐） ──
  /** 开始压缩 */
  compressing: Record<string, never>;
  /** 压缩完成 */
  compressed: { summary: string; removedCount: number };

  // ── Skill（与 StreamEvent 对齐） ──
  /** Skill 加载中 */
  'skill:loading': { name: string };
  /** Skill 加载完成 */
  'skill:loaded': { name: string; tokenCount: number };
  /** Skill 开始执行 */
  'skill:start': { name: string; task: string };
  /** Skill 执行完成 */
  'skill:end': { name: string; result: string };

  // ── SubAgent（与 StreamEvent 对齐） ──
  /** 子代理开始执行 */
  'subagent:start': { name: string; task: string };
  /** 子代理执行完成 */
  'subagent:end': { name: string; result: DelegateResult };

  // ── LLM 调用（与 StreamEvent 对齐） ──
  /** LLM 请求发送前 */
  'llm:request': {
    messages: Array<{ role: string; content: string }>;
    tools: string[];
    skill: { current: string | null; stack: string[] } | null;
  };
  /** LLM 响应完成后 */
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
    this.initializeSkillState(state);

    // 1. Add user message to state
    let newState = addUserMessage(state, userInput);

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
      visible: true,
    });

    // 5. Increment step count
    newState = incrementStepCount(newState);

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
    // 1. Add user message to state (initial state for streaming)
    const currentState = addUserMessage(state, userInput);

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
            const finalState = incrementStepCount(
              addAssistantMessage(currentState, accumulatedContent, {
                type: 'final',
                visible: true,
              })
            );

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
    return buildMessages(state, {
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
    return getToolsForLLM(registry);
  }

  /**
   * Initialize skill state in AgentState if not present
   *
   * @param state - Agent state to initialize
   * @private
   */
  private initializeSkillState(state: AgentState): void {
    if (!state.context.skillState && this._skillProvider) {
      state.context.skillState = {
        stack: [],
        current: null,
        availableSkills: this._skillProvider.listSkills().map((s) => ({
          name: s.name,
          description: s.description,
        })),
      };
    }
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

      // 根据 phase 类型补发对应的 StreamEvent
      if (result.phase.type === 'executing-tool') {
        this.emit('tool:start', { action: result.phase.action });
      }
      if (result.phase.type === 'tool-result') {
        this.emit('tool:end', { result: result.phase.result });
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
        // 统一转发：直接用 yield 事件的 type 和 payload
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

        // 根据 phase 类型补发对应的 StreamEvent
        if (phase.type === 'executing-tool') {
          this.emit('tool:start', { action: phase.action });
        }
        if (phase.type === 'tool-result') {
          this.emit('tool:end', { result: phase.result });
        }
        this.emit('phase-change', { from, to: phase });

        // Terminal: completed (direct answer)
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

        // Non-terminal stopping point: tool-result
        if (phase.type === 'tool-result') {
          const result: StepResult = { type: 'continue', toolResult: phase.result };
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
        // 统一转发：直接用 yield 事件的 type 和 payload
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
    this.initializeSkillState(state);

    this.emit('run:start', { state });
    const registry = toolRegistry ?? this.toolRegistry;
    const maxSteps = options?.maxSteps ?? this.options.maxSteps ?? 10;
    let currentState = state;
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
    this.emit('run:start', { state });
    const registry = toolRegistry ?? this.toolRegistry;
    const maxSteps = options?.maxSteps ?? this.options.maxSteps ?? 10;
    let currentState = state;
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
          // 统一转发：直接用 yield 事件的 type 和 payload
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
}
