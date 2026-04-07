/**
 * Main LLM Client class
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
 * LLM Client with multi-provider support, concurrency control,
 * priority queuing, and comprehensive token tracking.
 */
export class LLMClient extends EventEmitter {
  private scheduler: RequestScheduler;
  private adapter: PiAiAdapter;
  private config: Required<LLMClientConfig>;

  constructor(config?: LLMClientConfig) {
    super();
    this.config = {
      defaultProviderConcurrency: config?.defaultProviderConcurrency ?? 10,
      defaultKeyConcurrency: config?.defaultKeyConcurrency ?? 5,
      defaultModelConcurrency: config?.defaultModelConcurrency ?? 3,
    };
    this.scheduler = new RequestScheduler(this.config);
    this.adapter = new PiAiAdapter();

    // Forward scheduler events
    this.scheduler.on('state', (event: SchedulerEvent) => {
      this.emit('state', event);
    });
  }

  /**
   * Register a provider
   */
  registerProvider(config: ProviderConfig): void {
    this.scheduler.registerProvider(config);
  }

  /**
   * Register an API key
   */
  registerApiKey(config: ApiKeyConfig): void {
    this.scheduler.registerApiKey(config);
  }

  /**
   * Call the LLM (non-streaming)
   */
  async call(options: CallOptions): Promise<LLMResponse> {
    const { model, priority = 0, totalTimeout } = options;

    const execute = async (key: { key: string }): Promise<LLMResponse> => {
      // Emit retry through scheduler
      const onRetry = (attempt: number, error: Error) => {
        this.scheduler.emitRetry('unknown', attempt, error);
      };

      return this.adapter.complete(model, key.key, options, onRetry);
    };

    const promise = this.scheduler.execute(model, priority, execute);

    if (totalTimeout) {
      return pTimeout(promise, {
        milliseconds: totalTimeout,
        message: `Total timeout (including queue wait) exceeded ${totalTimeout}ms`,
      });
    }

    return promise;
  }

  /**
   * Call the LLM (streaming)
   */
  async *stream(options: CallOptions): AsyncIterable<StreamEvent> {
    const { model, priority = 0, totalTimeout } = options;

    // Create a promise that resolves to the stream
    const streamPromise = this.scheduler.execute(
      model,
      priority,
      async (key: { key: string }): Promise<AsyncIterable<StreamEvent>> => {
        const onRetry = (attempt: number, error: Error) => {
          this.scheduler.emitRetry('unknown', attempt, error);
        };

        // Return the async iterable directly
        return this.adapter.streamWithRetry(model, key.key, options, onRetry);
      }
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
   * Get client statistics
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
   * Clear all registrations
   */
  clear(): void {
    this.scheduler.clear();
  }
}

// Re-export types
export type {
  ProviderConfig,
  ApiKeyConfig,
  ModelConstraint,
  CallOptions,
  LLMResponse,
  StreamEvent,
  TokenStats,
  ClientStats,
  SchedulerEvent,
  RetryOptions,
} from './types.js';
