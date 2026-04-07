/**
 * Request scheduler with three-level semaphore and priority queue
 *
 * @module
 * @remarks
 * The scheduler implements a sophisticated concurrency control system using
 * three levels of semaphores: Provider → API Key → Model. This prevents
 * cascading failures and ensures fair resource distribution.
 */

import { EventEmitter } from 'eventemitter3';
import PQueue from 'p-queue';
import type {
  ProviderConfig,
  ApiKeyConfig,
  SchedulerEvent,
  TrackedProvider,
  TrackedApiKey,
  LLMClientConfig,
} from './types.js';

/**
 * Semaphore for concurrency control.
 *
 * @remarks
 * A counting semaphore that allows up to `max` concurrent acquisitions.
 * When the limit is reached, subsequent acquire calls wait in a FIFO queue.
 *
 * This implementation is used by the scheduler to enforce concurrency limits
 * at the provider, API key, and model levels.
 *
 * @internal
 */
class Semaphore {
  /** Current number of acquired permits. */
  private count = 0;

  /** Maximum number of concurrent permits allowed. */
  private readonly max: number;

  /** Queue of waiters blocked on acquire. */
  private readonly queue: Array<() => void> = [];

  /**
   * Creates a new semaphore.
   *
   * @param max - Maximum number of concurrent permits
   */
  constructor(max: number) {
    this.max = max;
  }

  /**
   * Acquire a permit, blocking if necessary.
   *
   * @returns Promise that resolves when a permit is acquired
   *
   * @remarks
   * If the current count is below max, the permit is granted immediately.
   * Otherwise, the call waits in a FIFO queue until a permit becomes available.
   */
  async acquire(): Promise<void> {
    if (this.count < this.max) {
      this.count++;
      return;
    }

    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  /**
   * Release a permit, waking a waiter if any.
   *
   * @remarks
   * If there are waiting acquirers, the permit is transferred to the next
   * waiter in the queue. Otherwise, the count is decremented.
   */
  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        // Keep count the same, just transfer to next waiter
        next();
      }
    } else {
      this.count--;
    }
  }

  /**
   * Get current usage statistics.
   *
   * @returns Object with current and max permit counts
   */
  getUsage(): { current: number; max: number } {
    return { current: this.count, max: this.max };
  }
}

/**
 * Request scheduler managing three-level concurrency limits.
 *
 * @remarks
 * The scheduler coordinates request execution with the following features:
 *
 * **Three-Level Concurrency Control**:
 * - Provider level: Limits concurrent requests per provider
 * - API Key level: Limits concurrent requests per API key
 * - Model level: Limits concurrent requests per (key, model) pair
 *
 * **Priority Queue**:
 * - Requests are queued with priority values
 * - Higher priority requests are processed first
 * - FIFO ordering for requests with equal priority
 *
 * **Round-Robin Key Selection**:
 * - When multiple keys support the same model, requests are distributed evenly
 * - Keys are selected at execution time to account for changing availability
 *
 * **State Events**:
 * - `queued`: Request entered the queue
 * - `started`: Request began execution
 * - `retry`: Request is being retried
 * - `completed`: Request finished successfully
 * - `failed`: Request failed after all retries
 *
 * @example
 * ```typescript
 * const scheduler = new RequestScheduler({
 *   defaultProviderConcurrency: 10,
 *   defaultKeyConcurrency: 5,
 *   defaultModelConcurrency: 3
 * });
 *
 * // Register provider and key
 * scheduler.registerProvider({ name: 'openai', maxConcurrency: 10 });
 * scheduler.registerApiKey({
 *   key: 'sk-...',
 *   provider: 'openai',
 *   maxConcurrency: 5,
 *   models: [{ modelId: 'gpt-4', maxConcurrency: 2 }]
 * });
 *
 * // Execute a request
 * const result = await scheduler.execute(
 *   'gpt-4',
 *   1, // priority
 *   async (key) => {
 *     // Make the actual API call
 *     return await callOpenAI(key.key, messages);
 *   },
 *   'request-123' // optional request ID
 * );
 * ```
 *
 * @public
 */
export class RequestScheduler extends EventEmitter {
  /** Map of provider names to their semaphores. */
  private providerSemaphores = new Map<string, Semaphore>();

  /** Map of API keys to their semaphores. */
  private keySemaphores = new Map<string, Semaphore>();

  /** Map of "key:model" to model semaphores. */
  private modelSemaphores = new Map<string, Semaphore>();

  /** Map of provider names to tracked provider data. */
  private providers = new Map<string, TrackedProvider>();

  /** Map of API keys to tracked key data. */
  private apiKeys = new Map<string, TrackedApiKey>();

  /** Priority queue for pending requests. */
  private queue: PQueue;

  /** Round-robin index for key selection. */
  private keyIndex = 0;

  /** Counter for generating unique request IDs. */
  private requestIdCounter = 0;

  /** Default concurrency configuration. */
  private defaultConfig: Required<LLMClientConfig>;

  /**
   * Creates a new RequestScheduler.
   *
   * @param config - Default concurrency configuration
   *
   * @remarks
   * The scheduler uses p-queue for priority queuing but manages concurrency
   * internally via semaphores. The p-queue is configured with infinite
   * concurrency because semaphore acquisition happens inside queue tasks.
   */
  constructor(config?: Required<LLMClientConfig>) {
    super();
    this.defaultConfig = config ?? {
      defaultProviderConcurrency: 10,
      defaultKeyConcurrency: 5,
      defaultModelConcurrency: 3,
    };
    this.queue = new PQueue({
      concurrency: Infinity, // We handle concurrency via semaphores
    });
  }

  /**
   * Register a provider with the scheduler.
   *
   * @param config - Provider configuration
   * @throws Error if provider with the same name is already registered
   *
   * @remarks
   * Providers must be registered before any API keys can be registered.
   * The maxConcurrency defaults to the configured defaultProviderConcurrency
   * if not specified.
   */
  registerProvider(config: ProviderConfig): void {
    if (this.providers.has(config.name)) {
      throw new Error(`Provider ${config.name} already registered`);
    }

    const maxConcurrency = config.maxConcurrency ?? this.defaultConfig.defaultProviderConcurrency;

    this.providers.set(config.name, {
      ...config,
      maxConcurrency,
      activeCount: 0,
    });
    this.providerSemaphores.set(config.name, new Semaphore(maxConcurrency));
  }

  /**
   * Register an API key with the scheduler.
   *
   * @param config - API key configuration
   * @throws Error if key is already registered or provider doesn't exist
   *
   * @remarks
   * The API key is associated with a previously registered provider.
   * Concurrency limits default to the configured defaults if not specified.
   * Model semaphores are created for each model in the configuration.
   */
  registerApiKey(config: ApiKeyConfig): void {
    const key = config.key;
    if (this.apiKeys.has(key)) {
      throw new Error(`API key ${key.slice(0, 8)}... already registered`);
    }

    if (!this.providers.has(config.provider)) {
      throw new Error(`Provider ${config.provider} not registered`);
    }

    const keyConcurrency = config.maxConcurrency ?? this.defaultConfig.defaultKeyConcurrency;

    // Apply default model concurrency if not specified
    const models = config.models.map((m) => ({
      ...m,
      maxConcurrency: m.maxConcurrency ?? this.defaultConfig.defaultModelConcurrency,
    }));

    this.apiKeys.set(key, {
      ...config,
      maxConcurrency: keyConcurrency,
      models,
      activeCount: 0,
      successCount: 0,
      failCount: 0,
      lastUsed: Date.now(),
    });

    this.keySemaphores.set(key, new Semaphore(keyConcurrency));

    // Create model semaphores
    for (const model of models) {
      const modelKey = `${key}:${model.modelId}`;
      this.modelSemaphores.set(modelKey, new Semaphore(model.maxConcurrency));
    }
  }

  /**
   * Get all API keys that support a specific model.
   *
   * @param modelId - Model identifier
   * @returns Array of API keys supporting the model
   *
   * @internal
   */
  private getKeysForModel(modelId: string): TrackedApiKey[] {
    const keys: TrackedApiKey[] = [];
    for (const key of this.apiKeys.values()) {
      if (key.models.some((m) => m.modelId === modelId)) {
        keys.push(key);
      }
    }
    return keys;
  }

  /**
   * Select an API key using round-robin.
   *
   * @param modelId - Model identifier
   * @returns Selected API key or null if none available
   *
   * @remarks
   * Round-robin selection distributes load evenly across available keys.
   * The selection happens at execution time to account for keys that
   * may have been added or removed.
   *
   * @internal
   */
  private selectKey(modelId: string): TrackedApiKey | null {
    const keys = this.getKeysForModel(modelId);
    if (keys.length === 0) {
      return null;
    }

    // Round-robin selection
    const index = this.keyIndex % keys.length;
    this.keyIndex = (this.keyIndex + 1) % keys.length;
    return keys[index];
  }

  /**
   * Generate a unique request ID.
   *
   * @returns Unique request identifier string
   *
   * @internal
   */
  private generateRequestId(): string {
    return `req-${Date.now()}-${++this.requestIdCounter}`;
  }

  /**
   * Execute a request with three-level semaphore control.
   *
   * @param modelId - Model identifier
   * @param priority - Request priority (higher = processed first)
   * @param executor - Function to execute when resources are available
   * @param requestId - Optional external request ID for tracing
   * @returns Promise resolving to the executor's result
   * @throws Error if no API key supports the model, or on execution failure
   *
   * @remarks
   * This method implements the core scheduling logic:
   *
   * 1. **Validation**: Checks that at least one key supports the model
   * 2. **Queueing**: Adds the request to the priority queue
   * 3. **Key Selection**: Uses round-robin to select an available key
   * 4. **Semaphore Acquisition**: Acquires provider → key → model semaphores
   * 5. **Execution**: Runs the executor function with the selected key
   * 6. **Cleanup**: Releases semaphores and updates statistics
   *
   * Semaphores are acquired in a specific order (provider → key → model)
   * to prevent deadlocks. They are released in reverse order.
   *
   * State events are emitted at each stage for observability.
   *
   * @example
   * ```typescript
   * const result = await scheduler.execute(
   *   'gpt-4',
   *   1,
   *   async (key) => {
   *     return await callOpenAI(key.key, messages);
   *   },
   *   'my-request-id'
   * );
   * ```
   */
  async execute<T>(
    modelId: string,
    priority: number,
    executor: (key: TrackedApiKey) => Promise<T>,
    requestId?: string
  ): Promise<T> {
    const finalRequestId = requestId ?? this.generateRequestId();

    // Check if any key is available (without consuming a slot)
    const availableKeys = this.getKeysForModel(modelId);
    if (availableKeys.length === 0) {
      throw new Error(`No API key available for model ${modelId}`);
    }

    // Emit queued event
    const queueSize = this.queue.size;
    this.emit('state', {
      type: 'queued',
      requestId: finalRequestId,
      position: queueSize,
      estimatedWait: queueSize * 1000, // Rough estimate
    } as SchedulerEvent);

    const result = await this.queue.add(
      async (): Promise<T> => {
        // Select key at execution time (round-robin)
        const selectedKey = this.selectKey(modelId);
        if (!selectedKey) {
          throw new Error(`No API key available for model ${modelId}`);
        }

        const provider = this.providers.get(selectedKey.provider);
        if (!provider) {
          throw new Error(`Provider ${selectedKey.provider} not found`);
        }

        const providerSem = this.providerSemaphores.get(selectedKey.provider)!;
        const keySem = this.keySemaphores.get(selectedKey.key)!;
        const modelKey = `${selectedKey.key}:${modelId}`;
        const modelSem = this.modelSemaphores.get(modelKey);

        if (!modelSem) {
          throw new Error(
            `Model ${modelId} not available for key ${selectedKey.key.slice(0, 8)}...`
          );
        }

        // Atomically acquire all three semaphores
        // Note: We acquire in order: provider -> key -> model to avoid deadlock
        await providerSem.acquire();
        try {
          await keySem.acquire();
          try {
            await modelSem.acquire();
            try {
              // Update active counts
              provider.activeCount++;
              selectedKey.activeCount++;
              selectedKey.lastUsed = Date.now();

              // Emit started event
              this.emit('state', {
                type: 'started',
                requestId: finalRequestId,
                key: selectedKey.key.slice(0, 8) + '...',
                model: modelId,
              } as SchedulerEvent);

              const startTime = Date.now();

              try {
                const result = await executor(selectedKey);

                // Update stats
                provider.activeCount--;
                selectedKey.activeCount--;
                selectedKey.successCount++;

                // Emit completed event
                this.emit('state', {
                  type: 'completed',
                  requestId: finalRequestId,
                  duration: Date.now() - startTime,
                } as SchedulerEvent);

                return result;
              } catch (error) {
                // Update stats
                provider.activeCount--;
                selectedKey.activeCount--;
                selectedKey.failCount++;
                selectedKey.lastError = error instanceof Error ? error.message : String(error);

                throw error;
              } finally {
                // Release semaphores in reverse order
                modelSem.release();
              }
            } finally {
              keySem.release();
            }
          } finally {
            providerSem.release();
          }
        } finally {
          // Ensure provider semaphore is released if not already
          // This handles the case where an error occurred before inner finally blocks ran
          const usage = providerSem.getUsage();
          if (usage.current > 0 && provider.activeCount < usage.current) {
            // Already released by inner finally, do nothing
          }
        }
      },
      { priority }
    );

    if (result === undefined) {
      throw new Error('Queue returned undefined');
    }

    return result;
  }

  /**
   * Emit a retry event.
   *
   * @param requestId - Request identifier
   * @param attempt - Retry attempt number (1-indexed)
   * @param error - Error that triggered the retry
   *
   * @remarks
   * This method is called by the adapter when a request fails
   * and is being retried. It emits a 'state' event with type 'retry'.
   *
   * @internal
   */
  emitRetry(requestId: string, attempt: number, error: Error): void {
    this.emit('state', {
      type: 'retry',
      requestId,
      attempt,
      error: error.message,
    } as SchedulerEvent);
  }

  /**
   * Get current scheduler statistics.
   *
   * @returns Object containing queue size, active requests, and key health
   *
   * @remarks
   * Returns real-time statistics useful for monitoring and debugging:
   * - queueSize: Number of pending requests in the priority queue
   * - activeRequests: Number of requests currently executing
   * - keyHealth: Success/failure counts per API key (masked)
   * - providerActiveCounts: Active request count per provider
   * - keyActiveCounts: Active request count per API key
   */
  getStats() {
    const keyHealth = new Map<string, { success: number; fail: number; lastError?: string }>();
    for (const [key, tracked] of this.apiKeys) {
      keyHealth.set(key.slice(0, 8) + '...', {
        success: tracked.successCount,
        fail: tracked.failCount,
        lastError: tracked.lastError,
      });
    }

    const providerActiveCounts = new Map<string, number>();
    for (const [name, provider] of this.providers) {
      providerActiveCounts.set(name, provider.activeCount);
    }

    const keyActiveCounts = new Map<string, number>();
    for (const [key, tracked] of this.apiKeys) {
      keyActiveCounts.set(key.slice(0, 8) + '...', tracked.activeCount);
    }

    return {
      queueSize: this.queue.size,
      activeRequests: this.queue.pending,
      keyHealth,
      providerActiveCounts,
      keyActiveCounts,
    };
  }

  /**
   * Clear all registrations.
   *
   * @remarks
   * Removes all providers, API keys, and semaphores. The scheduler
   * returns to its initial state. In-flight requests are not affected.
   */
  clear(): void {
    this.providers.clear();
    this.apiKeys.clear();
    this.providerSemaphores.clear();
    this.keySemaphores.clear();
    this.modelSemaphores.clear();
    this.keyIndex = 0;
  }
}
