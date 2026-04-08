/**
 * PiAiAdapter unit tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PiAiAdapter } from '../../src/adapter';

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

describe('PiAiAdapter', () => {
  let adapter: PiAiAdapter;

  beforeEach(() => {
    adapter = new PiAiAdapter();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('complete', () => {
    it('should call pi-ai complete with correct parameters', async () => {
      const mockResult = {
        content: [{ type: 'text', text: 'Hello!' }],
        usage: { input: 10, output: 5 },
        stopReason: 'stop',
      };
      vi.mocked(piComplete).mockResolvedValue(mockResult as never);
      vi.mocked(getModel).mockReturnValue(null);

      const result = await adapter.complete(
        'gpt-4',
        'sk-test',
        {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hi' }],
        },
        undefined
      );

      expect(piComplete).toHaveBeenCalled();
      expect(result.content).toBe('Hello!');
      expect(result.tokens).toEqual({ input: 10, output: 5 });
      expect(result.stopReason).toBe('stop');
    });

    it('should handle retryable errors with retry', async () => {
      const error = new Error('Rate limit');
      (error as { status?: number }).status = 429;

      vi.mocked(piComplete)
        .mockRejectedValueOnce(error as never)
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Success' }],
          usage: { input: 5, output: 3 },
          stopReason: 'stop',
        } as never);
      vi.mocked(getModel).mockReturnValue(null);

      const onRetry = vi.fn();
      const result = await adapter.complete(
        'gpt-4',
        'sk-test',
        {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hi' }],
          retryOptions: { retries: 3, minTimeout: 100 },
        },
        onRetry
      );

      expect(piComplete).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(result.content).toBe('Success');
    });

    it('should not retry on non-retryable errors', async () => {
      const error = new Error('Bad request');
      (error as { status?: number }).status = 400;

      vi.mocked(piComplete).mockRejectedValue(error as never);
      vi.mocked(getModel).mockReturnValue(null);

      await expect(
        adapter.complete('gpt-4', 'sk-test', {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hi' }],
          retryOptions: { retries: 3 },
        })
      ).rejects.toThrow('Bad request');

      expect(piComplete).toHaveBeenCalledTimes(1);
    });
  });

  describe('streamWithRetry', () => {
    it('should yield text events in real-time during streaming', async () => {
      const mockEvents = [
        { type: 'text_delta', delta: 'Hello' },
        { type: 'text_delta', delta: ' World' },
        { type: 'text_end', content: 'Hello World', contentIndex: 0 },
        { type: 'done', message: { usage: { input: 5, output: 2 } } },
      ];

      vi.mocked(piStream).mockImplementation(mockAsyncStream(mockEvents));
      vi.mocked(getModel).mockReturnValue(null);

      const events: Array<{ type: string; delta?: string }> = [];
      for await (const event of adapter.streamWithRetry('gpt-4', 'sk-test', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        events.push(event);
      }

      // Should yield real-time text events, not just done
      const textEvents = events.filter((e) => e.type === 'text');
      expect(textEvents.length).toBe(3); // text_delta + text_delta + text_end
      expect(textEvents[0].delta).toBe('Hello');
      expect(textEvents[1].delta).toBe(' World');

      // Last event should be done
      expect(events[events.length - 1].type).toBe('done');
    });

    it('should yield done event with token stats', async () => {
      const mockEvents = [
        { type: 'text_delta', delta: 'Hi' },
        { type: 'done', message: { usage: { input: 10, output: 3 } } },
      ];

      vi.mocked(piStream).mockImplementation(mockAsyncStream(mockEvents));
      vi.mocked(getModel).mockReturnValue(null);

      const events: Array<{ type: string }> = [];
      for await (const event of adapter.streamWithRetry('gpt-4', 'sk-test', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        events.push(event);
      }

      const doneEvent = events.find((e) => e.type === 'done') as
        | { type: 'done'; tokens: { input: number; output: number } }
        | undefined;
      expect(doneEvent).toBeDefined();
      expect(doneEvent!.tokens).toEqual({ input: 10, output: 3 });
    });

    it('should yield tool_call events', async () => {
      const mockEvents = [
        { type: 'text_delta', delta: 'Let me calculate' },
        {
          type: 'toolcall_end',
          toolCall: { id: 'call-1', name: 'calc', arguments: { expr: '1+1' } },
        },
        { type: 'done', message: { usage: { input: 5, output: 5 } } },
      ];

      vi.mocked(piStream).mockImplementation(mockAsyncStream(mockEvents));
      vi.mocked(getModel).mockReturnValue(null);

      const events: Array<{ type: string; toolCall?: { id: string; name: string } }> = [];
      for await (const event of adapter.streamWithRetry('gpt-4', 'sk-test', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        events.push(event);
      }

      const toolCallEvent = events.find((e) => e.type === 'tool_call');
      expect(toolCallEvent).toBeDefined();
      expect(toolCallEvent!.toolCall!.name).toBe('calc');
      expect(toolCallEvent!.toolCall!.id).toBe('call-1');
    });

    it('should handle stream errors', async () => {
      vi.mocked(piStream).mockImplementation(async function* () {
        throw new Error('Stream failed');
      });
      vi.mocked(getModel).mockReturnValue(null);

      const events: Array<{ type: string }> = [];
      for await (const event of adapter.streamWithRetry('gpt-4', 'sk-test', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        events.push(event);
      }

      expect(events.some((e) => e.type === 'error')).toBe(true);
    });

    it('should retry on retryable connection errors', async () => {
      const rateLimitError = new Error('Rate limit');
      (rateLimitError as { status?: number }).status = 429;

      let callCount = 0;
      vi.mocked(piStream).mockImplementation(async function* () {
        callCount++;
        if (callCount === 1) {
          throw rateLimitError;
        }
        yield { type: 'text_delta', delta: 'Hello' } as never;
        yield { type: 'done', message: { usage: { input: 5, output: 2 } } } as never;
      });
      vi.mocked(getModel).mockReturnValue(null);

      const onRetry = vi.fn();
      const events: Array<{ type: string }> = [];
      for await (const event of adapter.streamWithRetry(
        'gpt-4',
        'sk-test',
        {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hi' }],
          retryOptions: { retries: 2, minTimeout: 10 },
        },
        onRetry
      )) {
        events.push(event);
      }

      // Should have retried and succeeded
      expect(callCount).toBe(2);
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(events.some((e) => e.type === 'text')).toBe(true);
      expect(events.some((e) => e.type === 'done')).toBe(true);
    });

    it('should not retry on non-retryable errors', async () => {
      const badRequestError = new Error('Bad request');
      (badRequestError as { status?: number }).status = 400;

      vi.mocked(piStream).mockImplementation(async function* () {
        throw badRequestError;
      });
      vi.mocked(getModel).mockReturnValue(null);

      const events: Array<{ type: string }> = [];
      for await (const event of adapter.streamWithRetry('gpt-4', 'sk-test', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        retryOptions: { retries: 3, minTimeout: 10 },
      })) {
        events.push(event);
      }

      // Should not retry, just yield error
      expect(piStream).toHaveBeenCalledTimes(1);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('error');
    });

    it('should yield mid-stream errors without retry', async () => {
      vi.mocked(piStream).mockImplementation(async function* () {
        yield { type: 'text_delta', delta: 'Start' } as never;
        yield { type: 'text_delta', delta: ' more' } as never;
        throw new Error('Mid-stream failure');
      });
      vi.mocked(getModel).mockReturnValue(null);

      const events: Array<{ type: string; delta?: string }> = [];
      for await (const event of adapter.streamWithRetry('gpt-4', 'sk-test', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        retryOptions: { retries: 3, minTimeout: 10 },
      })) {
        events.push(event);
      }

      // Should have text events + error, no retry
      expect(piStream).toHaveBeenCalledTimes(1);
      const textEvents = events.filter((e) => e.type === 'text');
      expect(textEvents.length).toBe(2);
      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
    });

    it('should skip null-mapped events (start, toolcall_start, etc)', async () => {
      const mockEvents = [
        { type: 'start', partial: {} },
        { type: 'text_start', contentIndex: 0 },
        { type: 'text_delta', delta: 'Hello' },
        { type: 'toolcall_start' },
        { type: 'toolcall_delta' },
        { type: 'toolcall_end', toolCall: { id: 'c1', name: 'f', arguments: {} } },
        { type: 'done', message: { usage: { input: 5, output: 2 } } },
      ];

      vi.mocked(piStream).mockImplementation(mockAsyncStream(mockEvents));
      vi.mocked(getModel).mockReturnValue(null);

      const events: Array<{ type: string }> = [];
      for await (const event of adapter.streamWithRetry('gpt-4', 'sk-test', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        events.push(event);
      }

      // start, text_start (delta=''), toolcall_start, toolcall_delta are null/skipped
      // Only text_delta, toolcall_end, done are yielded
      expect(events.map((e) => e.type)).toEqual(['text', 'text', 'tool_call', 'done']);
    });
  });
});
