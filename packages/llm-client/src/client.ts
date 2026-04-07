/**
 * Main LLM Client implementation
 *
 * @module
 */

import { EventEmitter } from 'eventemitter3';
import pTimeout from 'p-timeout';
import { RequestScheduler } from './scheduler.js';
import { PiAiAdapter } from './adapter.js';
import type {
  ProviderConfig,
  ApiKeyConfig,
  CallOptions,
  LLMResponse,
  StreamEvent,
  ClientStats,
  SchedulerEvent,
  LLMClientConfig,
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
 * Unified LLM client with multi-provider support, concurrency control,
 * priority queuing, and comprehensive token tracking.
 *
 * @remarks
 * The LLMClient provides a unified interface for interacting with various
 * LLM providers (OpenAI, Anthropic, etc.) through the pi-ai library.
 *
 * Key features:
 * - **Multi-provider support**: Register multiple providers and API keys
 * - **Three-level concurrency control**: Provider → API Key → Model
 * - **Priority queuing**: Higher priority requests are processed first
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

  /**
   * Creates a new LLMClient instance.
   *
   * @param config - Optional configuration for default concurrency limits and base URL
   *
   * @example
   * ```typescript
   * const client = new LLMClient({
   *   defaultProviderConcurrency: 10,
   *   defaultKeyConcurrency: 5,
   *   defaultModelConcurrency: 3,
   *   baseUrl: 'https://custom-api.example.com/v1'
   * });
   * ```
   */
  constructor(config?: LLMClientOptions) {
    super();
    this.config = {
      defaultProviderConcurrency: config?.defaultProviderConcurrency ?? 10,
      defaultKeyConcurrency: config?.defaultKeyConcurrency ?? 5,
      defaultModelConcurrency: config?.defaultModelConcurrency ?? 3,
    };
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
   *   priority: 1,
   *   requestTimeout: 30000
   * });
   *
   * console.log(response.content);
   * console.log(`Tokens used: ${response.tokens.input} in, ${response.tokens.output} out`);
   * ```
   */
  async call(options: CallOptions): Promise<LLMResponse> {
    const { model, priority = 0, totalTimeout, requestId } = options;

    const execute = async (key: { key: string }): Promise<LLMResponse> => {
      // Emit retry through scheduler
      const onRetry = (attempt: number, error: Error) => {
        this.scheduler.emitRetry(requestId ?? 'unknown', attempt, error);
      };

      return this.adapter.complete(model, key.key, options, onRetry);
    };

    const promise = this.scheduler.execute(model, priority, execute, requestId);

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
    const { model, priority = 0, totalTimeout, requestId } = options;

    // Create a promise that resolves to the stream
    const streamPromise = this.scheduler.execute(
      model,
      priority,
      async (key: { key: string }): Promise<AsyncIterable<StreamEvent>> => {
        const onRetry = (attempt: number, error: Error) => {
          this.scheduler.emitRetry(requestId ?? 'unknown', attempt, error);
        };

        // Return the async iterable directly
        return this.adapter.streamWithRetry(model, key.key, options, onRetry);
      },
      requestId
    );

    // Apply total timeout
    const iterable = totalTimeout
      ? await pTimeout(streamPromise, {
          milliseconds: totalTimeout,
          message: `Total timeout (including queue wait) exceeded ${totalTimeout}ms`,
        })
      : await streamPromise;

    // Yield from the returned iterable
    for await (const event of iterable) {
      yield event;
    }
  }

  /**
   * Get current client statistics.
   *
   * @returns Current statistics including queue size, active requests, and key health
   *
   * @remarks
   * This method provides real-time visibility into the client's internal state.
   * Use it for monitoring, debugging, or making dynamic decisions about
   * request prioritization.
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
   * Clear all registered providers and API keys.
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
