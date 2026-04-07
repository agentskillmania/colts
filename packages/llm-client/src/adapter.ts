/**
 * Pi-ai adapter with retry logic and token tracking
 */

import {
  complete as piComplete,
  stream as piStream,
  getModel,
  type Model,
  type Context,
  type Tool,
  type AssistantMessageEvent,
  type Usage,
} from '@mariozechner/pi-ai';
import pRetry from 'p-retry';
import pTimeout from 'p-timeout';
import type { CallOptions, LLMResponse, StreamEvent, TokenStats, RetryOptions } from './types.js';

/**
 * Check if error is retryable
 */
function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  // Check for rate limit (429) or server errors (5xx)
  const status = (error as { status?: number }).status;
  if (status === 429 || (typeof status === 'number' && status >= 500)) {
    return true;
  }

  // Check for network-related error messages
  const message = error.message.toLowerCase();
  const networkErrors = ['timeout', 'econnrefused', 'econnreset', 'enotfound', 'network', 'socket'];

  return networkErrors.some((err) => message.includes(err));
}

/**
 * Adapter for pi-ai with retry and token tracking
 */
export class PiAiAdapter {
  private defaultRetryOptions: Required<RetryOptions> = {
    retries: 3,
    minTimeout: 1000,
    maxTimeout: 10000,
    factor: 2,
  };

  /**
   * Create a Model instance from config
   */
  private createModel(modelId: string): Model<string> {
    // Try to get model from pi-ai registry
    const model = getModel('openai', modelId as never);
    if (model) {
      return model as Model<string>;
    }

    // Fallback: create a custom model
    return {
      id: modelId,
      name: modelId,
      api: 'openai-chat',
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    } as Model<string>;
  }

  /**
   * Build context from messages
   */
  private buildContext(messages: CallOptions['messages']): Context {
    return {
      messages: messages as Context['messages'],
    };
  }

  /**
   * Merge retry options
   */
  private mergeRetryOptions(options?: RetryOptions): Required<RetryOptions> {
    return {
      ...this.defaultRetryOptions,
      ...options,
    };
  }

  /**
   * Execute with retry logic
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    retryOptions: Required<RetryOptions>,
    onRetry?: (attempt: number, error: Error) => void
  ): Promise<T> {
    return pRetry(operation, {
      retries: retryOptions.retries,
      minTimeout: retryOptions.minTimeout,
      maxTimeout: retryOptions.maxTimeout,
      factor: retryOptions.factor,
      shouldRetry: (error) => isRetryableError(error),
      onFailedAttempt: ({ attemptNumber }) => {
        const error = new Error(`Attempt ${attemptNumber} failed`);
        if (onRetry) {
          onRetry(attemptNumber, error);
        }
      },
    });
  }

  /**
   * Convert Usage to TokenStats
   */
  private usageToTokenStats(usage: Usage | undefined): TokenStats {
    if (!usage) {
      return { input: 0, output: 0 };
    }
    return {
      input: usage.input,
      output: usage.output,
    };
  }

  /**
   * Non-streaming completion
   */
  async complete(
    modelId: string,
    apiKey: string,
    options: CallOptions,
    onRetry?: (attempt: number, error: Error) => void
  ): Promise<LLMResponse> {
    const model = this.createModel(modelId);
    const context = this.buildContext(options.messages);
    const retryOpts = this.mergeRetryOptions(options.retryOptions);

    const operation = async (): Promise<LLMResponse> => {
      const result = await piComplete(model, context, {
        apiKey,
        thinkingEnabled: options.thinkingEnabled,
        tools: options.tools as Tool[],
        signal: options.signal,
      });

      // Extract text content
      let content = '';
      let thinking: string | undefined;
      const toolCalls: LLMResponse['toolCalls'] = [];

      for (const item of result.content) {
        if (item.type === 'text') {
          content += item.text;
        } else if (item.type === 'thinking') {
          thinking = (thinking || '') + item.thinking;
        } else if (item.type === 'toolCall') {
          toolCalls.push({
            id: item.id,
            name: item.name,
            arguments: item.arguments,
          });
        }
      }

      return {
        content,
        thinking,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        tokens: this.usageToTokenStats(result.usage),
        stopReason: result.stopReason,
      };
    };

    // Apply timeout if specified
    const promise = this.withRetry(operation, retryOpts, onRetry);

    if (options.requestTimeout) {
      return pTimeout(promise, {
        milliseconds: options.requestTimeout,
        message: `Request timeout after ${options.requestTimeout}ms`,
      });
    }

    return promise;
  }

  /**
   * Map pi-ai event to our StreamEvent format
   */
  private mapEvent(event: AssistantMessageEvent): StreamEvent {
    switch (event.type) {
      case 'text_delta':
        return {
          type: 'text',
          delta: event.delta,
        };

      case 'thinking_delta':
        return {
          type: 'thinking',
          delta: event.delta,
          thinking: event.delta,
        };

      case 'toolcall_end':
        return {
          type: 'tool_call',
          toolCall: {
            id: event.toolCall.id,
            name: event.toolCall.name,
            arguments: event.toolCall.arguments,
          },
        };

      case 'done':
        return {
          type: 'done',
          tokens: this.usageToTokenStats(event.message.usage),
          roundTotalTokens: this.usageToTokenStats(event.message.usage),
        };

      case 'error':
        return {
          type: 'error',
          error: event.error.errorMessage || 'Unknown error',
        };

      default:
        return {
          type: 'error',
          error: `Unknown event type: ${event.type}`,
        };
    }
  }

  /**
   * Streaming completion with proper retry and event accumulation
   */
  async *streamWithRetry(
    modelId: string,
    apiKey: string,
    options: CallOptions,
    onRetry?: (attempt: number, error: Error) => void
  ): AsyncIterable<StreamEvent> {
    const model = this.createModel(modelId);
    const context = this.buildContext(options.messages);

    let accumulatedContent = '';
    let currentTokens: TokenStats = { input: 0, output: 0 };
    let isDone = false;

    const runStream = async (): Promise<void> => {
      const stream = piStream(model, context, {
        apiKey,
        thinkingEnabled: options.thinkingEnabled,
        tools: options.tools as Tool[],
        signal: options.signal,
      });

      for await (const event of stream) {
        const mapped = this.mapEvent(event);

        // Update accumulators
        if (mapped.delta && mapped.type === 'text') {
          accumulatedContent += mapped.delta;
        }
        if (mapped.tokens) {
          currentTokens = mapped.tokens;
        }

        if (mapped.type === 'done') {
          isDone = true;
        }
      }
    };

    const retryOpts = this.mergeRetryOptions(options.retryOptions);

    try {
      await this.withRetry(runStream, retryOpts, onRetry);
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
      return;
    }

    // Yield final state
    if (isDone) {
      yield {
        type: 'done',
        accumulatedContent,
        tokens: { ...currentTokens },
        roundTotalTokens: { ...currentTokens },
      };
    }
  }
}
