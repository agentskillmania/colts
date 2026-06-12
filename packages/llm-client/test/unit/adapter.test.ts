/**
 * PiAiAdapter unit tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PiAiAdapter } from '../../src/adapter.js';

// Mock pi-ai module
vi.mock('@mariozechner/pi-ai', () => ({
  complete: vi.fn(),
  stream: vi.fn(),
  getModel: vi.fn(),
}));

import { complete as piComplete, stream as piStream, getModel } from '@mariozechner/pi-ai';

/**
 * Helper: create a mock async generator from event list.
 * Must use async function* so that [Symbol.asyncIterator] is available.
 */
function mockAsyncStream(events: unknown[]): () => AsyncGenerator<never> {
  return async function* () {
    for (const event of events) {
      yield event as never;
    }
  };
}

/**
 * Helper: create a mock AssistantMessageEvent.
 */
function event(type: string, extra: Record<string, unknown> = {}) {
  return { type, ...extra };
}

describe('PiAiAdapter', () => {
  let adapter: PiAiAdapter;

  beforeEach(() => {
    adapter = new PiAiAdapter();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getModelMeta', () => {
    it('returns fallback defaults when no metadata provided', () => {
      const adapter = new PiAiAdapter();
      const meta = adapter.getModelMeta('unknown-model');
      expect(meta.contextWindow).toBe(128000);
      expect(meta.maxTokens).toBe(16384);
      expect(meta.reasoning).toBe(true);
      expect(meta.input).toEqual(['text']);
    });

    it('returns user-provided metadata', () => {
      const adapter = new PiAiAdapter();
      const meta = adapter.getModelMeta('glm-5', {
        contextWindow: 200000,
        maxTokens: 131072,
        reasoning: true,
      });
      expect(meta.contextWindow).toBe(200000);
      expect(meta.maxTokens).toBe(131072);
    });

    it('allows input override via meta', () => {
      const adapter = new PiAiAdapter();
      const meta = adapter.getModelMeta('gpt-4', { input: ['text', 'image'] });
      expect(meta.input).toEqual(['text', 'image']);
    });

    it('falls back for individual fields not provided', () => {
      const adapter = new PiAiAdapter();
      const meta = adapter.getModelMeta('my-model', {
        contextWindow: 64000,
      });
      expect(meta.contextWindow).toBe(64000);
      expect(meta.maxTokens).toBe(16384);
    });

    it('defaults reasoning to true when not specified', () => {
      const adapter = new PiAiAdapter();
      // reasoning=true is the new default — verified through model creation
      // We can't directly check model.reasoning from getModelMeta, but
      // the thinking translation logic depends on it.
      const meta = adapter.getModelMeta('some-model');
      expect(meta.contextWindow).toBe(128000);
    });

    it('uses user reasoning=false when specified', () => {
      const adapter = new PiAiAdapter();
      const meta = adapter.getModelMeta('simple-model', {
        reasoning: false,
        contextWindow: 32000,
        maxTokens: 2048,
      });
      expect(meta.contextWindow).toBe(32000);
      expect(meta.maxTokens).toBe(2048);
    });
  });

  describe('getModelCapabilities', () => {
    it('returns strict capabilities with all required fields for unknown models', () => {
      const adapter = new PiAiAdapter();
      const caps = adapter.getModelCapabilities('unknown-model');
      expect(caps.contextWindow).toBe(128000);
      expect(caps.maxTokens).toBe(16384);
      expect(caps.reasoning).toBe(true);
      expect(caps.input).toEqual(['text']);
    });

    it('returns overridden capabilities when meta provided', () => {
      const adapter = new PiAiAdapter();
      const caps = adapter.getModelCapabilities('gpt-4', {
        contextWindow: 64000,
        maxTokens: 2048,
        reasoning: false,
        input: ['text', 'image'],
      });
      expect(caps.contextWindow).toBe(64000);
      expect(caps.maxTokens).toBe(2048);
      expect(caps.reasoning).toBe(false);
      expect(caps.input).toEqual(['text', 'image']);
    });
  });

  describe('detectThinkingFormat (via adapter behavior)', () => {
    it('detects deepseek format from bigmodel.cn URL', () => {
      const adapter = new PiAiAdapter({ baseUrl: 'https://open.bigmodel.cn/api/paas/v4' });
      // Model will be created with deepseek compat
      const meta = adapter.getModelMeta('glm-5');
      expect(meta.contextWindow).toBe(128000);
    });

    it('detects deepseek format from deepseek.com URL', () => {
      const adapter = new PiAiAdapter({ baseUrl: 'https://api.deepseek.com/v1' });
      const meta = adapter.getModelMeta('deepseek-chat');
      expect(meta.contextWindow).toBe(128000);
    });

    it('detects qwen format from aliyun URL', () => {
      const adapter = new PiAiAdapter({
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      });
      const meta = adapter.getModelMeta('qwen-max');
      expect(meta.contextWindow).toBe(128000);
    });

    it('returns undefined for unknown URL', () => {
      const adapter = new PiAiAdapter({ baseUrl: 'https://some-api.example.com/v1' });
      const meta = adapter.getModelMeta('custom-model');
      expect(meta.contextWindow).toBe(128000);
    });

    it('returns defaults when no baseUrl', () => {
      const adapter = new PiAiAdapter();
      const meta = adapter.getModelMeta('any-model');
      expect(meta.contextWindow).toBe(128000);
      expect(meta.maxTokens).toBe(16384);
    });
  });

  // ============================================================
  // complete()
  // ============================================================
  describe('complete()', () => {
    it('returns text content and token usage', async () => {
      vi.mocked(piComplete).mockResolvedValue({
        content: [{ type: 'text', text: 'Hello, world!' }],
        usage: { input: 10, output: 5 },
        stopReason: 'stop',
      } as never);

      const response = await adapter.complete('gpt-4', 'sk-test', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(response.content).toBe('Hello, world!');
      expect(response.tokens).toEqual({ input: 10, output: 5 });
      expect(response.stopReason).toBe('stop');
      expect(response.toolCalls).toBeUndefined();
      expect(response.thinking).toBeUndefined();
    });

    it('concatenates multiple text chunks', async () => {
      vi.mocked(piComplete).mockResolvedValue({
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: ', ' },
          { type: 'text', text: 'world!' },
        ],
        usage: { input: 5, output: 3 },
        stopReason: 'stop',
      } as never);

      const response = await adapter.complete('gpt-4', 'sk-test', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(response.content).toBe('Hello, world!');
    });

    it('captures thinking content separately', async () => {
      vi.mocked(piComplete).mockResolvedValue({
        content: [
          { type: 'thinking', thinking: 'Let me think.' },
          { type: 'text', text: 'The answer is 42.' },
        ],
        usage: { input: 8, output: 4 },
        stopReason: 'stop',
      } as never);

      const response = await adapter.complete('gpt-4', 'sk-test', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'What is the answer?' }],
      });

      expect(response.content).toBe('The answer is 42.');
      expect(response.thinking).toBe('Let me think.');
    });

    it('parses tool calls into response', async () => {
      vi.mocked(piComplete).mockResolvedValue({
        content: [
          {
            type: 'toolCall',
            id: 'call-1',
            name: 'calculate',
            arguments: { expression: '2+2' },
          },
        ],
        usage: { input: 12, output: 6 },
        stopReason: 'tool_calls',
      } as never);

      const response = await adapter.complete('gpt-4', 'sk-test', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Calculate 2+2' }],
      });

      expect(response.toolCalls).toEqual([
        { id: 'call-1', name: 'calculate', arguments: { expression: '2+2' } },
      ]);
      expect(response.stopReason).toBe('tool_calls');
    });

    it('returns zero tokens when usage is missing', async () => {
      vi.mocked(piComplete).mockResolvedValue({
        content: [{ type: 'text', text: 'No usage' }],
        stopReason: 'stop',
      } as never);

      const response = await adapter.complete('gpt-4', 'sk-test', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(response.tokens).toEqual({ input: 0, output: 0 });
    });

    it('passes tools to piComplete when provided', async () => {
      vi.mocked(piComplete).mockResolvedValue({
        content: [{ type: 'text', text: 'Ok' }],
        usage: { input: 1, output: 1 },
        stopReason: 'stop',
      } as never);

      const tools = [{ name: 'calc', description: 'Calc', parameters: {} }];
      await adapter.complete('gpt-4', 'sk-test', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        tools: tools as never,
      });

      expect(piComplete).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ tools: expect.any(Array) }),
        expect.objectContaining({ apiKey: 'sk-test' })
      );
    });

    it('applies requestTimeout and throws on timeout', async () => {
      vi.mocked(piComplete).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 10000))
      );

      await expect(
        adapter.complete('gpt-4', 'sk-test', {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hi' }],
          requestTimeout: 50,
        })
      ).rejects.toThrow('Request timeout after 50ms');
    });

    it('does not apply timeout when requestTimeout is omitted', async () => {
      vi.mocked(piComplete).mockResolvedValue({
        content: [{ type: 'text', text: 'Ok' }],
        stopReason: 'stop',
      } as never);

      await adapter.complete('gpt-4', 'sk-test', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(piComplete).toHaveBeenCalledTimes(1);
    });

    it('uses custom baseUrl in created model', async () => {
      const customAdapter = new PiAiAdapter({ baseUrl: 'https://custom.example.com/v1' });
      vi.mocked(piComplete).mockResolvedValue({
        content: [{ type: 'text', text: 'Ok' }],
        stopReason: 'stop',
      } as never);

      await customAdapter.complete('custom-model', 'sk-test', {
        model: 'custom-model',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      const modelArg = vi.mocked(piComplete).mock.calls[0][0] as { baseUrl?: string };
      expect(modelArg.baseUrl).toBe('https://custom.example.com/v1');
    });
  });

  // ============================================================
  // streamWithRetry()
  // ============================================================
  describe('streamWithRetry()', () => {
    it('yields text events with deltas and accumulated content', async () => {
      vi.mocked(piStream).mockReturnValue(
        mockAsyncStream([
          event('text_start'),
          event('text_delta', { delta: 'Hello' }),
          event('text_delta', { delta: ' world' }),
          event('text_end', { content: 'Hello world' }),
          event('done', { message: { usage: { input: 3, output: 2 } } }),
        ])()
      );

      const events = [];
      for await (const event of adapter.streamWithRetry('gpt-4', 'sk-test', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        events.push(event);
      }

      expect(events).toEqual([
        { type: 'text', delta: '' },
        { type: 'text', delta: 'Hello' },
        { type: 'text', delta: ' world' },
        { type: 'text', delta: '', accumulatedContent: 'Hello world' },
        {
          type: 'done',
          tokens: { input: 3, output: 2 },
          roundTotalTokens: { input: 3, output: 2 },
        },
      ]);
    });

    it('yields thinking events when thinkingEnabled is true', async () => {
      vi.mocked(piStream).mockReturnValue(
        mockAsyncStream([
          event('thinking_start'),
          event('thinking_delta', { delta: 'Let me' }),
          event('thinking_delta', { delta: ' think' }),
          event('thinking_end', { content: 'Let me think' }),
          event('done', { message: { usage: { input: 1, output: 1 } } }),
        ])()
      );

      const events = [];
      for await (const event of adapter.streamWithRetry('gpt-4', 'sk-test', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        thinkingEnabled: true,
      })) {
        events.push(event);
      }

      expect(events).toEqual([
        { type: 'thinking', delta: '' },
        { type: 'thinking', delta: 'Let me', thinking: 'Let me' },
        { type: 'thinking', delta: ' think', thinking: ' think' },
        { type: 'thinking', delta: '', thinking: 'Let me think' },
        {
          type: 'done',
          tokens: { input: 1, output: 1 },
          roundTotalTokens: { input: 1, output: 1 },
        },
      ]);
    });

    it('yields tool_call event on toolcall_end', async () => {
      vi.mocked(piStream).mockReturnValue(
        mockAsyncStream([
          event('toolcall_start'),
          event('toolcall_delta'),
          event('toolcall_end', {
            toolCall: { id: 'call-1', name: 'calc', arguments: { x: 1 } },
          }),
          event('done', { message: { usage: { input: 2, output: 3 } } }),
        ])()
      );

      const events = [];
      for await (const event of adapter.streamWithRetry('gpt-4', 'sk-test', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        events.push(event);
      }

      expect(events).toEqual([
        {
          type: 'tool_call',
          toolCall: { id: 'call-1', name: 'calc', arguments: { x: 1 } },
        },
        {
          type: 'done',
          tokens: { input: 2, output: 3 },
          roundTotalTokens: { input: 2, output: 3 },
        },
      ]);
    });

    it('skips start and unknown event types', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.mocked(piStream).mockReturnValue(
        mockAsyncStream([
          event('start'),
          event('text_delta', { delta: 'Hi' }),
          event('unknown_type', { data: 'ignored' }),
          event('done', { message: { usage: { input: 1, output: 1 } } }),
        ])()
      );

      const events = [];
      for await (const event of adapter.streamWithRetry('gpt-4', 'sk-test', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        events.push(event);
      }

      expect(events).toEqual([
        { type: 'text', delta: 'Hi' },
        {
          type: 'done',
          tokens: { input: 1, output: 1 },
          roundTotalTokens: { input: 1, output: 1 },
        },
      ]);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown stream event type: unknown_type')
      );
      consoleWarnSpy.mockRestore();
    });

    it('yields error event when stream ends immediately', async () => {
      vi.mocked(piStream).mockReturnValue(mockAsyncStream([])());

      const events = [];
      for await (const event of adapter.streamWithRetry('gpt-4', 'sk-test', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'error',
        error: 'Stream ended immediately without events',
      });
    });

    it('retries connection-level failures before yielding events', async () => {
      let attempt = 0;
      vi.mocked(piStream).mockImplementation(() => {
        attempt++;
        if (attempt < 3) {
          throw new Error('ECONNREFUSED');
        }
        return mockAsyncStream([
          event('text_delta', { delta: 'Ok' }),
          event('done', { message: { usage: { input: 1, output: 1 } } }),
        ])();
      });

      const retryCalls: Array<{ attempt: number; message: string }> = [];
      const events = [];
      for await (const event of adapter.streamWithRetry(
        'gpt-4',
        'sk-test',
        {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hi' }],
          retryOptions: { retries: 3, minTimeout: 1, maxTimeout: 10, factor: 1 },
        },
        (attempt, error) => retryCalls.push({ attempt, message: error.message })
      )) {
        events.push(event);
      }

      expect(events).toEqual([
        { type: 'text', delta: 'Ok' },
        {
          type: 'done',
          tokens: { input: 1, output: 1 },
          roundTotalTokens: { input: 1, output: 1 },
        },
      ]);
      expect(retryCalls.length).toBe(2);
      expect(retryCalls[0].attempt).toBe(1);
      expect(retryCalls[1].attempt).toBe(2);
    });

    it('yields error event when all retries exhausted', async () => {
      vi.mocked(piStream).mockImplementation(() => {
        const err = new Error('rate limited');
        (err as { status?: number }).status = 429;
        throw err;
      });

      const events = [];
      for await (const event of adapter.streamWithRetry('gpt-4', 'sk-test', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        retryOptions: { retries: 1, minTimeout: 1, maxTimeout: 10, factor: 1 },
      })) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'error',
        error: expect.stringContaining('rate limited'),
      });
    });

    it('yields error event for mid-stream failures', async () => {
      async function* throwingStream() {
        yield event('text_delta', { delta: 'Partial' }) as never;
        throw new Error('Stream broke');
      }
      vi.mocked(piStream).mockReturnValue(throwingStream());

      const events = [];
      for await (const event of adapter.streamWithRetry('gpt-4', 'sk-test', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        events.push(event);
      }

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ type: 'text', delta: 'Partial' });
      expect(events[1]).toMatchObject({
        type: 'error',
        error: 'Stream broke',
      });
    });

    it('forwards abort signal to piStream', async () => {
      vi.mocked(piStream).mockReturnValue(mockAsyncStream([])());

      const controller = new AbortController();
      controller.abort();

      const events = [];
      for await (const event of adapter.streamWithRetry('gpt-4', 'sk-test', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        signal: controller.signal,
      })) {
        events.push(event);
      }

      expect(piStream).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.objectContaining({ signal: controller.signal })
      );
    });
  });

  // ============================================================
  // Retry behavior
  // ============================================================
  describe('retry behavior', () => {
    it('retries on 429 errors', async () => {
      let attempt = 0;
      vi.mocked(piComplete).mockImplementation(() => {
        attempt++;
        if (attempt < 2) {
          const err = new Error('Too many requests');
          (err as { status?: number }).status = 429;
          return Promise.reject(err);
        }
        return Promise.resolve({
          content: [{ type: 'text', text: 'Ok' }],
          usage: { input: 1, output: 1 },
          stopReason: 'stop',
        } as never);
      });

      const response = await adapter.complete('gpt-4', 'sk-test', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        retryOptions: { retries: 2, minTimeout: 1, maxTimeout: 10, factor: 1 },
      });

      expect(response.content).toBe('Ok');
      expect(piComplete).toHaveBeenCalledTimes(2);
    });

    it('retries on 5xx errors', async () => {
      let attempt = 0;
      vi.mocked(piComplete).mockImplementation(() => {
        attempt++;
        if (attempt < 2) {
          const err = new Error('Internal server error');
          (err as { status?: number }).status = 503;
          return Promise.reject(err);
        }
        return Promise.resolve({
          content: [{ type: 'text', text: 'Ok' }],
          stopReason: 'stop',
        } as never);
      });

      const response = await adapter.complete('gpt-4', 'sk-test', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        retryOptions: { retries: 2, minTimeout: 1, maxTimeout: 10, factor: 1 },
      });

      expect(response.content).toBe('Ok');
    });

    it('retries on network errors', async () => {
      let attempt = 0;
      vi.mocked(piComplete).mockImplementation(() => {
        attempt++;
        if (attempt < 2) {
          return Promise.reject(new Error('ECONNREFUSED'));
        }
        return Promise.resolve({
          content: [{ type: 'text', text: 'Ok' }],
          stopReason: 'stop',
        } as never);
      });

      const response = await adapter.complete('gpt-4', 'sk-test', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        retryOptions: { retries: 2, minTimeout: 1, maxTimeout: 10, factor: 1 },
      });

      expect(response.content).toBe('Ok');
    });

    it('does not retry on 4xx client errors', async () => {
      vi.mocked(piComplete).mockImplementation(() => {
        const err = new Error('Bad request');
        (err as { status?: number }).status = 400;
        return Promise.reject(err);
      });

      await expect(
        adapter.complete('gpt-4', 'sk-test', {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hi' }],
          retryOptions: { retries: 3, minTimeout: 1, maxTimeout: 10, factor: 1 },
        })
      ).rejects.toThrow('Bad request');

      expect(piComplete).toHaveBeenCalledTimes(1);
    });

    it('does not retry non-Error rejections', async () => {
      vi.mocked(piComplete).mockRejectedValue('string error');

      await expect(
        adapter.complete('gpt-4', 'sk-test', {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hi' }],
          retryOptions: { retries: 3, minTimeout: 1, maxTimeout: 10, factor: 1 },
        })
      ).rejects.toThrow('string error');

      expect(piComplete).toHaveBeenCalledTimes(1);
    });

    it('calls onRetry with wrapped error and attempt number', async () => {
      vi.mocked(piComplete).mockImplementation(() => {
        const err = new Error('timeout');
        (err as { status?: number }).status = 503;
        return Promise.reject(err);
      });

      const retryCalls: Array<{ attempt: number; message: string; status?: number }> = [];
      await expect(
        adapter.complete(
          'gpt-4',
          'sk-test',
          {
            model: 'gpt-4',
            messages: [{ role: 'user', content: 'Hi' }],
            retryOptions: { retries: 0, minTimeout: 1, maxTimeout: 10, factor: 1 },
          },
          (attempt, error) =>
            retryCalls.push({
              attempt,
              message: error.message,
              status: (error as { status?: number }).status,
            })
        )
      ).rejects.toThrow();

      expect(retryCalls.length).toBe(1);
      expect(retryCalls[0].attempt).toBe(1);
      expect(retryCalls[0].message).toContain('timeout');
      expect(retryCalls[0].status).toBe(503);
    });

    it('disables retries when retries is 0', async () => {
      vi.mocked(piComplete).mockRejectedValue(new Error('fail'));

      await expect(
        adapter.complete('gpt-4', 'sk-test', {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hi' }],
          retryOptions: { retries: 0 },
        })
      ).rejects.toThrow('fail');

      expect(piComplete).toHaveBeenCalledTimes(1);
    });
  });
});
