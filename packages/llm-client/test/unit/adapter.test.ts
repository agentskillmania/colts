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
    it('should stream events successfully', async () => {
      const mockEvents = [
        { type: 'text_delta', delta: 'Hello' },
        { type: 'text_delta', delta: ' World' },
        { type: 'done', message: { usage: { input: 5, output: 2 } } },
      ];

      vi.mocked(piStream).mockImplementation(function* () {
        for (const event of mockEvents) {
          yield event as never;
        }
      });
      vi.mocked(getModel).mockReturnValue(null);

      const events: Array<{ type: string }> = [];
      for await (const event of adapter.streamWithRetry('gpt-4', 'sk-test', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
      expect(events[events.length - 1].type).toBe('done');
    });

    it('should handle stream errors', async () => {
      vi.mocked(piStream).mockImplementation(function* () {
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
  });
});
