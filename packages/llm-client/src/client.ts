/**
 * @fileoverview Main LLM Client implementation.
 *
 * @module
 */

import { EventEmitter } from 'eventemitter3';
import pTimeout from 'p-timeout';

import { PiAiAdapter } from './adapter.js';
import { RequestScheduler } from './scheduler.js';
import type {
  ProviderConfig,
  ApiKeyConfig,
  LLMQuickInit,
  CallOptions,
  LLMResponse,
  StreamEvent,
  ClientStats,
  SchedulerEvent,
  LLMClientConfig,
  ModelMeta,
  ModelCapabilities,
  ModelConstraint,
} from './types.js';

/**
 * Configuration options for LLMClient.
 *
 * @remarks
 * Extends the base LLMClientConfig with additional options
 * for customizing adapter behavior.
 */
export interface LLMClientOptions extends LLMClientConfig {
  /** Custom base URL for the API (e.g., for proxy or different provider endpoints) */
  baseUrl?: string;
}

/**
 * Client-side validation error for programmatically distinguishable rejections.
 *
 * @remarks
 * Thrown by the multimodal defensive gate ({@link LLMClient.call}/
 * {@link LLMClient.stream}) when a request violates a declared-capability
 * constraint — a configuration error, not a provider error. Callers can
 * distinguish it from real provider failures (e.g. an API 400 about the
 * image payload) via `error.name === 'LLMClientValidationError'` or
 * `instanceof LLMClientValidationError`, and react accordingly (fix the
 * model config instead of retrying).
 *
 * Retry semantics match Rust's `AdapterError::Validation` (non-retryable);
 * Rust types it as an enum variant, here it is a named Error subclass.
 *
 * @public
 */
export class LLMClientValidationError extends Error {
  /**
   * Creates a validation error.
   *
   * @param message - Human-readable description of the violated constraint
   */
  constructor(message: string) {
    super(message);
    this.name = 'LLMClientValidationError';
  }
}

/**
 * Unified LLM client with multi-provider support, concurrency control,
 * and comprehensive token tracking.
 *
 * @remarks
 * The LLMClient provides a unified interface for interacting with various
 * LLM providers (OpenAI, Anthropic, etc.) through the pi-ai library.
 *
 * Key features:
 * - **Multi-provider support**: Register multiple providers and API keys
 * - **Three-level concurrency control**: Provider → API Key → Model
 * - **Automatic retries**: Configurable retry with exponential backoff
 * - **Streaming support**: Real-time token-by-token responses
 * - **Observability**: State events and statistics for monitoring
 * - **Custom base URL**: Support for proxy or alternative API endpoints
 *
 * @example
 * Basic usage:
 * ```typescript
 * const client = new LLMClient();
 *
 * // Register provider and API key
 * client.registerProvider({ name: 'openai', maxConcurrency: 10 });
 * client.registerApiKey({
 *   key: 'sk-...',
 *   provider: 'openai',
 *   maxConcurrency: 5,
 *   models: [{ modelId: 'gpt-4', maxConcurrency: 2 }]
 * });
 *
 * // Make a request
 * const response = await client.call({
 *   model: 'gpt-4',
 *   messages: [{ role: 'user', content: 'Hello!' }]
 * });
 * ```
 *
 * @example
 * With custom base URL (e.g., for ZhiPu AI):
 * ```typescript
 * const client = new LLMClient({
 *   baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4'
 * });
 *
 * client.registerProvider({ name: 'openai', maxConcurrency: 10 });
 * client.registerApiKey({
 *   key: 'your-api-key',
 *   provider: 'openai',
 *   maxConcurrency: 5,
 *   models: [{ modelId: 'GLM-4.7', maxConcurrency: 2 }]
 * });
 * ```
 *
 * @example
 * With observability:
 * ```typescript
 * client.on('state', (event) => {
 *   console.log(`[${event.requestId}] ${event.type}`);
 * });
 *
 * const stats = client.getStats();
 * console.log(`Queue: ${stats.queueSize}`);
 * ```
 *
 * @public
 */
export class LLMClient extends EventEmitter {
  /** Internal request scheduler managing concurrency and queuing. */
  private scheduler: RequestScheduler;

  /** Adapter for the pi-ai library. */
  private adapter: PiAiAdapter;

  /** Client configuration with resolved defaults. */
  private config: Required<LLMClientConfig>;

  /** Global default base URL used when a provider/key does not specify one. */
  private baseUrl?: string;

  /**
   * 便捷创建：从 provider 列表一次装配 LLMClient。
   *
   * 每个 provider 对应一个 API key；模型列表决定该 key 下可用的模型。
   * 这是「内置 LLM」的入口——上层不需要自己维护 provider/key/model 注册。
   *
   * @param config - 快速初始化配置（providers + models）
   * @param options - 可选：默认并发/Base URL 覆盖
   * @returns 配置完成的 LLMClient
   *
   * @example
   * ```typescript
   * const client = LLMClient.quickInit({
   *   providers: [{ name: 'openai', apiKey: 'sk-...', models: [{ modelId: 'gpt-4o' }] }],
   * });
   * ```
   */
  static quickInit(config: LLMQuickInit, options?: LLMClientOptions): LLMClient {
    const client = new LLMClient(options);

    for (const provider of config.providers) {
      const providerConcurrency = provider.maxConcurrency ?? 5;

      client.registerProvider({
        name: provider.name,
        baseUrl: provider.baseUrl,
        maxConcurrency: providerConcurrency,
      });

      client.registerApiKey({
        key: provider.apiKey,
        provider: provider.name,
        maxConcurrency: providerConcurrency,
        models: provider.models.map((model) => ({
          modelId: model.modelId,
          maxConcurrency: model.maxConcurrency ?? 3,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          reasoning: model.reasoning,
          input: model.input,
        })),
      });
    }

    return client;
  }

  /**
   * Creates a new LLMClient instance.
   *
   * @param config - Optional configuration for default concurrency limits and base URL
   *
   * @example
   * ```typescript
   * const client = new LLMClient({
   *   defaultProviderConcurrency: 5,
   *   defaultKeyConcurrency: 5,
   *   defaultModelConcurrency: 3,
   *   baseUrl: 'https://custom-api.example.com/v1'
   * });
   * ```
   */
  constructor(config?: LLMClientOptions) {
    super();
    this.config = {
      defaultProviderConcurrency: config?.defaultProviderConcurrency ?? 5,
      defaultKeyConcurrency: config?.defaultKeyConcurrency ?? 5,
      defaultModelConcurrency: config?.defaultModelConcurrency ?? 3,
    };
    this.baseUrl = config?.baseUrl;
    this.scheduler = new RequestScheduler(this.config);
    this.adapter = new PiAiAdapter({ baseUrl: config?.baseUrl });

    // Forward scheduler events to client listeners
    this.scheduler.on('state', (event: SchedulerEvent) => {
      this.emit('state', event);
    });
  }

  /**
   * Register a provider with the client.
   *
   * @param config - Provider configuration including name and concurrency limit
   * @throws Error if a provider with the same name is already registered
   * @returns Nothing; the provider is registered as a side effect.
   *
   * @remarks
   * Providers must be registered before any API keys can be registered for them.
   * The provider's concurrency limit acts as a global cap across all its API keys.
   *
   * @example
   * ```typescript
   * client.registerProvider({
   *   name: 'openai',
   *   maxConcurrency: 10
   * });
   * ```
   */
  registerProvider(config: ProviderConfig): void {
    this.scheduler.registerProvider(config);
  }

  /**
   * Register an API key with the client.
   *
   * @param config - API key configuration including key, provider, and supported models
   * @throws Error if the provider is not registered or key is already registered
   * @returns Nothing; the API key is registered as a side effect.
   *
   * @remarks
   * The API key is associated with a previously registered provider.
   * Each key can support multiple models with individual concurrency constraints.
   *
   * The scheduler uses round-robin selection to distribute requests across
   * available keys that support the requested model.
   *
   * @example
   * ```typescript
   * client.registerApiKey({
   *   key: 'sk-...',
   *   provider: 'openai',
   *   maxConcurrency: 5,
   *   models: [
   *     { modelId: 'gpt-4', maxConcurrency: 2 },
   *     { modelId: 'gpt-3.5-turbo', maxConcurrency: 5 }
   *   ]
   * });
   * ```
   */
  registerApiKey(config: ApiKeyConfig): void {
    this.scheduler.registerApiKey(config);
  }

  /**
   * Check whether any message carries image parts (multimodal input).
   *
   * @param messages - Conversation messages to inspect
   * @returns True if at least one message of ANY role whose content is an
   * array carries an image part
   *
   * @remarks
   * Scans every message regardless of role: array-shaped content is the only
   * thing inspected (plain string content is text by definition), and while
   * only user/toolResult content can carry `ImageContent` at the type level,
   * the scan itself is role-agnostic. Text-only part arrays do NOT count as
   * multimodal — the gate targets image payload specifically (wire-compatible
   * text parts must not be rejected for text-only models).
   *
   * @internal
   */
  private hasImageParts(messages: CallOptions['messages']): boolean {
    return messages.some(
      (m) => Array.isArray(m.content) && m.content.some((part) => part.type === 'image')
    );
  }

  /**
   * Multimodal defensive gate (mirrors Rust 37c3395 `validate_multimodal`).
   *
   * @param options - Request options including model and messages
   * @throws {LLMClientValidationError} when messages contain image parts but
   * the model's resolved capabilities do not declare `"image"` input
   *
   * @remarks
   * When a message carries image parts, the model must have declared image
   * input capability (`input: ["text", "image"]` at registration time —
   * `LLMQuickInit.providers[].models[].input` or `ModelConstraint.input`).
   * Otherwise the request is rejected client-side before it reaches the
   * scheduler — sending a base64 image to a text-only model would only
   * produce a hard-to-locate 400 from the provider.
   *
   * The rejection happens pre-scheduler, so it is never retried and never
   * pollutes key health stats. Retry semantics are equivalent to Rust's
   * non-retryable `AdapterError::Validation`; typing differs in degree —
   * Rust is an enum variant, here a named Error subclass
   * (`name === 'LLMClientValidationError'`), both programmatically
   * distinguishable from provider errors.
   *
   * Deliberate divergence from Rust: the capability lookup resolves through
   * the adapter, which falls back to pi-ai's built-in model registry — a
   * registry-known vision model (e.g. `gpt-4o`) therefore passes the gate
   * even without an explicit `input` declaration in the config. Rust has no
   * registry fallback and rejects any model without an explicit declaration.
   * The leniency is intentional: pi-ai registry data is authoritative for
   * models it knows.
   *
   * @internal
   */
  private validateMultimodal(options: CallOptions): void {
    if (!this.hasImageParts(options.messages)) {
      return;
    }
    const capabilities = this.getModelCapabilities(options.model);
    if (!capabilities.input.includes('image')) {
      throw new LLMClientValidationError(
        `messages contain multimodal parts but model '${options.model}' does not declare image input capability ` +
          `(set input: ["text", "image"] in the model's config to allow it)`
      );
    }
  }

  /**
   * Make a non-streaming request to the LLM.
   *
   * @param options - Request options including model, messages, and configuration
   * @returns Promise resolving to the complete LLM response
   * @throws Error if no API key is available for the model, or on request failure
   *
   * @remarks
   * This method returns the complete response after the entire generation
   * is finished. For real-time streaming responses, use {@link stream} instead.
   *
   * The request goes through the following lifecycle:
   * 1. Queued (if concurrency limits are reached)
   * 2. Started (when a slot becomes available)
   * 3. Retry (if transient errors occur)
   * 4. Completed or Failed
   *
   * State events are emitted for each lifecycle transition.
   *
   * @example
   * ```typescript
   * const response = await client.call({
   *   model: 'gpt-4',
   *   messages: [
   *     { role: 'system', content: 'You are helpful.' },
   *     { role: 'user', content: 'Hello!' }
   *   ],
   *   requestTimeout: 30000
   * });
   *
   * console.log(response.content);
   * console.log(`Tokens used: ${response.tokens.input} in, ${response.tokens.output} out`);
   * ```
   */
  async call(options: CallOptions): Promise<LLMResponse> {
    const { model, totalTimeout, requestId, signal } = options;

    // Multimodal gate: reject image parts for models without image input
    // declared — before queueing, so it is neither retried nor counted as
    // a key failure (mirrors Rust 37c3395).
    this.validateMultimodal(options);

    const execute = async (ctx: {
      key: { key: string };
      baseUrl?: string;
      modelConstraint?: ModelConstraint;
    }): Promise<LLMResponse> => {
      // Emit retry through scheduler
      const onRetry = (attempt: number, error: Error) => {
        this.scheduler.emitRetry(requestId ?? 'unknown', attempt, error);
      };

      const effectiveBaseUrl = ctx.baseUrl ?? this.baseUrl;
      return this.adapter.complete({
        modelId: model,
        apiKey: ctx.key.key,
        options,
        onRetry,
        baseUrl: effectiveBaseUrl,
        modelConstraint: ctx.modelConstraint,
      });
    };

    const promise = this.scheduler.execute(model, execute, requestId, signal);

    if (totalTimeout) {
      return pTimeout(promise, {
        milliseconds: totalTimeout,
        message: `Total timeout (including queue wait) exceeded ${totalTimeout}ms`,
      });
    }

    return promise;
  }

  /**
   * Make a streaming request to the LLM.
   *
   * @param options - Request options including model, messages, and configuration
   * @returns Async iterable yielding stream events
   * @throws Error if no API key is available for the model, or on request failure
   *
   * @remarks
   * This method returns an async iterable that yields events as the model
   * generates content. This allows for real-time display of the response
   * as it's being generated.
   *
   * Event types:
   * - `text`: Regular text content (includes delta and accumulatedContent)
   * - `thinking`: Reasoning content (when thinkingEnabled is true)
   * - `tool_call`: Tool/function call requested by the model
   * - `done`: Stream completed successfully (includes final token counts)
   * - `error`: An error occurred during streaming
   *
   * @example
   * ```typescript
   * for await (const event of client.stream({
   *   model: 'gpt-4',
   *   messages: [{ role: 'user', content: 'Write a poem' }]
   * })) {
   *   switch (event.type) {
   *     case 'text':
   *       process.stdout.write(event.delta);
   *       break;
   *     case 'done':
   *       console.log('\n--- Done! ---');
   *       console.log('Tokens:', event.roundTotalTokens);
   *       break;
   *     case 'error':
   *       console.error('Error:', event.error);
   *       break;
   *   }
   * }
   * ```
   */
  async *stream(options: CallOptions): AsyncIterable<StreamEvent> {
    const { model, totalTimeout, requestId, signal } = options;

    // Multimodal gate: same contract as call() — rejects on first iteration
    // (before queueing) when image parts meet a text-only model.
    this.validateMultimodal(options);

    // Merge timeout and caller signal into a single abort controller
    // so that totalTimeout covers both queue wait and stream consumption.
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (totalTimeout) {
      timeoutId = setTimeout(() => {
        abortController.abort(new Error(`Total timeout exceeded ${totalTimeout}ms`));
      }, totalTimeout);
    }

    if (signal) {
      if (signal.aborted) {
        abortController.abort(signal.reason);
      } else {
        signal.addEventListener('abort', () => abortController.abort(signal.reason), {
          once: true,
        });
      }
    }

    try {
      // Create a promise that resolves to the stream
      const streamPromise = this.scheduler.execute(
        model,
        async (ctx: {
          key: { key: string };
          baseUrl?: string;
          modelConstraint?: ModelConstraint;
        }): Promise<AsyncIterable<StreamEvent>> => {
          const onRetry = (attempt: number, error: Error) => {
            this.scheduler.emitRetry(requestId ?? 'unknown', attempt, error);
          };

          const effectiveBaseUrl = ctx.baseUrl ?? this.baseUrl;

          // Return the async iterable directly, wired to the merged signal
          return this.adapter.streamWithRetry({
            modelId: model,
            apiKey: ctx.key.key,
            options: { ...options, signal: abortController.signal },
            onRetry,
            baseUrl: effectiveBaseUrl,
            modelConstraint: ctx.modelConstraint,
          });
        },
        requestId,
        abortController.signal
      );

      const iterable = await streamPromise;

      // Yield from the returned iterable, respecting abort signal
      const iterator = iterable[Symbol.asyncIterator]();

      // CONC2 fix: create the abort Promise ONCE (not per loop iteration).
      // The old code created a new Promise + addEventListener inside the
      // while loop, accumulating listeners that were never removed on normal
      // completion — a memory leak proportional to the number of stream chunks.
      const abortPromise = new Promise<never>((_, reject) => {
        if (abortController.signal.aborted) {
          reject(abortController.signal.reason);
          return;
        }
        abortController.signal.addEventListener(
          'abort',
          () => reject(abortController.signal.reason),
          { once: true }
        );
      });

      try {
        while (true) {
          const result = await Promise.race([iterator.next(), abortPromise]);
          if (result.done) break;
          yield result.value;
        }
      } finally {
        iterator.return?.();
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * Get current client statistics.
   *
   * @returns Current statistics including queue size, active requests, and key health
   *
   * @remarks
   * This method provides real-time visibility into the client's internal state.
   * Use it for monitoring or debugging.
   *
   * The returned statistics include:
   * - Queue size: Number of pending requests
   * - Active requests: Number of in-flight requests
   * - Key health: Success/failure counts per API key (masked)
   * - Provider and key active counts: Current load distribution
   *
   * @example
   * ```typescript
   * const stats = client.getStats();
   * console.log(`Queue: ${stats.queueSize}, Active: ${stats.activeRequests}`);
   *
   * // Check key health
   * for (const [key, health] of stats.keyHealth) {
   *   const successRate = health.success / (health.success + health.fail);
   *   console.log(`Key ${key}: ${(successRate * 100).toFixed(1)}% success`);
   * }
   * ```
   */
  getStats(): ClientStats {
    const stats = this.scheduler.getStats();

    return {
      queueSize: stats.queueSize,
      activeRequests: stats.activeRequests,
      keyHealth: stats.keyHealth,
      providerActiveCounts: stats.providerActiveCounts,
      keyActiveCounts: stats.keyActiveCounts,
    };
  }

  /**
   * Get model metadata (context window, max output tokens).
   *
   * @param modelId - Model identifier
   * @returns Model metadata with contextWindow and maxTokens
   *
   * @remarks
   * Returns metadata from ModelConstraint registration if available,
   * otherwise returns adapter defaults.
   */
  getModelMeta(modelId: string): ModelMeta {
    const constraint = this.scheduler.getModelConstraint(modelId);
    return this.adapter.getModelMeta(
      modelId,
      constraint
        ? {
            contextWindow: constraint.contextWindow,
            maxTokens: constraint.maxTokens,
            reasoning: constraint.reasoning,
            input: constraint.input,
          }
        : undefined
    );
  }

  getModelCapabilities(modelId: string): ModelCapabilities {
    const constraint = this.scheduler.getModelConstraint(modelId);
    return this.adapter.getModelCapabilities(
      modelId,
      constraint
        ? {
            contextWindow: constraint.contextWindow,
            maxTokens: constraint.maxTokens,
            reasoning: constraint.reasoning,
            input: constraint.input,
          }
        : undefined
    );
  }

  /**
   * Clear all registered providers and API keys.
   *
   * @returns Nothing; clears all registrations as a side effect.
   *
   * @remarks
   * This method removes all registrations, effectively resetting the client
   * to its initial state. It can be used to reconfigure the client without
   * creating a new instance.
   *
   * Note: Any in-flight requests will continue to completion, but new
   * requests will fail until providers and keys are re-registered.
   *
   * @example
   * ```typescript
   * // Clear and reconfigure
   * client.clear();
   *
   * client.registerProvider({ name: 'anthropic', maxConcurrency: 10 });
   * client.registerApiKey({
   *   key: 'sk-ant-...',
   *   provider: 'anthropic',
   *   maxConcurrency: 5,
   *   models: [{ modelId: 'claude-3-opus', maxConcurrency: 2 }]
   * });
   * ```
   */
  clear(): void {
    this.scheduler.clear();
  }
}

// Re-export types for convenience
export type {
  /** Configuration for LLM providers. */
  ProviderConfig,
  /** Configuration for API keys. */
  ApiKeyConfig,
  /** Model constraint configuration. */
  ModelConstraint,
  /** Options for LLM requests. */
  CallOptions,
  /** Response from non-streaming requests. */
  LLMResponse,
  /** Stream event types. */
  StreamEvent,
  /** Token usage statistics. */
  TokenStats,
  /** Client statistics. */
  ClientStats,
  /** Scheduler state events. */
  SchedulerEvent,
  /** Retry configuration options. */
  RetryOptions,
} from './types.js';
