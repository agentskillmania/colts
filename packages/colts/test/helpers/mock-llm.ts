/**
 * @fileoverview Shared mock LLM client factory for colts unit tests.
 *
 * Consolidates 13+ duplicated `createMockLLMClient` implementations across the
 * test suite. Each option defaults to the behavior of the "Standard" variant
 * (step.test.ts, advance.test.ts, etc.) so that most callers need no options.
 */

import { vi } from 'vitest';
import type { LLMClient, LLMResponse, ModelMeta } from '@agentskillmania/llm-client';

export interface MockLLMOptions {
  /**
   * Yield `thinking` stream tokens when `response.thinking` is present.
   * Enabled in: run.test.ts, step-equivalence.test.ts, path-equivalence.test.ts
   */
  enableThinking?: boolean;

  /**
   * Yield `tool_call` stream tokens when `response.toolCalls` is non-empty.
   * Default true. Disabled in: concurrency.test.ts, emitter.test.ts
   */
  enableToolCalls?: boolean;

  /**
   * How to split `response.content` into stream text tokens.
   * - 'word' — split by space (default, most tests)
   * - 'char' — split by character (emitter.test.ts)
   * - 'all'  — single chunk (concurrency.test.ts)
   */
  split?: 'word' | 'char' | 'all';

  /**
   * Skip yielding text tokens when `response.content` is empty.
   * Enabled in: stream-normal.test.ts, stream-misbehavior.test.ts
   */
  skipEmptyContent?: boolean;

  /**
   * Delay in ms before `call()` resolves. Use 'random' for
   * `Math.random() * 10` (concurrency.test.ts). Default 0.
   */
  callDelay?: number | 'random';

  /**
   * Behavior when responses array is exhausted.
   * - 'throw' — throw Error (default, most tests)
   * - 'default' — return a fallback response (emitter.test.ts)
   */
  onExhausted?: 'throw' | 'default';

  /**
   * Fallback response used when `onExhausted` is 'default'.
   */
  defaultResponse?: LLMResponse;
}

const DEFAULT_FALLBACK: LLMResponse = {
  content: 'Default response',
  toolCalls: [],
  tokens: { input: 10, output: 5 },
  stopReason: 'stop',
};

/**
 * Create a mock LLM client with configurable streaming behavior.
 *
 * @param responses - Sequence of responses to return (call/stream share one index)
 * @param options - Behavioral overrides
 * @returns Mock LLM client compatible with AgentRunner
 */
export function createMockLLMClient(
  responses: LLMResponse[],
  options: MockLLMOptions = {}
): LLMClient {
  const {
    enableThinking = false,
    enableToolCalls = true,
    split = 'word',
    skipEmptyContent = false,
    callDelay = 0,
    onExhausted = 'throw',
    defaultResponse = DEFAULT_FALLBACK,
  } = options;

  let callIndex = 0;

  return {
    call: vi.fn().mockImplementation(() => {
      if (callIndex >= responses.length) {
        if (onExhausted === 'default') {
          return Promise.resolve({ ...defaultResponse });
        }
        throw new Error(`No more mock responses (index ${callIndex}, total ${responses.length})`);
      }
      const delay = callDelay === 'random' ? Math.random() * 10 : callDelay;
      if (delay > 0) {
        return new Promise((resolve) => setTimeout(() => resolve(responses[callIndex++]), delay));
      }
      return Promise.resolve(responses[callIndex++]);
    }),

    stream: vi.fn().mockImplementation(async function* () {
      if (callIndex >= responses.length) {
        if (onExhausted === 'default') {
          const fallback = { ...defaultResponse };
          const chars = fallback.content.split('');
          let accumulated = '';
          for (const char of chars) {
            accumulated += char;
            yield {
              type: 'text' as const,
              delta: char,
              accumulatedContent: accumulated,
            };
          }
          yield {
            type: 'done' as const,
            roundTotalTokens: fallback.tokens,
          };
          return;
        }
        throw new Error('No more mock responses for stream');
      }

      // NOTE: Most variants (A/B/C) increment callIndex AFTER yielding all
      // tokens. Variant D (concurrency) increments BEFORE. We replicate the
      // "after" behavior here because it is the majority pattern.
      const response = responses[callIndex];

      if (enableThinking && response.thinking) {
        const thinkingTokens = response.thinking.split(' ');
        for (let i = 0; i < thinkingTokens.length; i++) {
          yield {
            type: 'thinking' as const,
            delta: thinkingTokens[i] + (i < thinkingTokens.length - 1 ? ' ' : ''),
          };
        }
      }

      const content = response.content;
      if (content.length > 0 || !skipEmptyContent) {
        if (split === 'word') {
          const tokens = content.split(' ');
          for (let i = 0; i < tokens.length; i++) {
            yield {
              type: 'text' as const,
              delta: tokens[i] + (i < tokens.length - 1 ? ' ' : ''),
              accumulatedContent: tokens.slice(0, i + 1).join(' '),
            };
          }
        } else if (split === 'char') {
          const chars = content.split('');
          let accumulated = '';
          for (const char of chars) {
            accumulated += char;
            yield {
              type: 'text' as const,
              delta: char,
              accumulatedContent: accumulated,
            };
          }
        } else {
          // 'all'
          yield {
            type: 'text' as const,
            delta: content,
            accumulatedContent: content,
          };
        }
      }

      if (enableToolCalls && response.toolCalls && response.toolCalls.length > 0) {
        for (const toolCall of response.toolCalls) {
          yield {
            type: 'tool_call' as const,
            toolCall: {
              id: toolCall.id,
              name: toolCall.name,
              arguments: toolCall.arguments,
            },
          };
        }
      }

      yield {
        type: 'done' as const,
        roundTotalTokens: response.tokens,
      };

      callIndex++;
    }),

    getModelMeta: vi.fn().mockReturnValue({
      contextWindow: 128000,
      maxTokens: 4096,
    } satisfies ModelMeta),
  } as unknown as LLMClient;
}

/**
 * Create a mock LLM client whose `stream()` immediately throws.
 * Used by delegate-tool tests that only exercise the blocking path.
 */
export function createNoStreamMockLLMClient(responses: LLMResponse[]): LLMClient {
  let callIndex = 0;
  return {
    call: vi.fn().mockImplementation(() => {
      if (callIndex >= responses.length) {
        throw new Error(`No more mock responses (index ${callIndex}, total ${responses.length})`);
      }
      return Promise.resolve(responses[callIndex++]);
    }),
    stream: vi.fn().mockImplementation(async function* () {
      throw new Error('Stream not used in this test');
    }),
    getModelMeta: vi.fn().mockReturnValue({
      contextWindow: 128000,
      maxTokens: 4096,
    } satisfies ModelMeta),
  } as unknown as LLMClient;
}

/**
 * Create a mock LLM client with no `stream` implementation at all
 * (method is just `vi.fn()`). Used by runner/index.test.ts.
 */
export function createCallOnlyMockLLMClient(responses: LLMResponse[]): LLMClient {
  let callIndex = 0;
  return {
    call: vi.fn().mockImplementation(() => {
      if (callIndex >= responses.length) {
        throw new Error(`No more mock responses (index ${callIndex})`);
      }
      return Promise.resolve(responses[callIndex++]);
    }),
    stream: vi.fn(),
    getModelMeta: vi.fn().mockReturnValue({
      contextWindow: 128000,
      maxTokens: 4096,
    } satisfies ModelMeta),
  } as unknown as LLMClient;
}
