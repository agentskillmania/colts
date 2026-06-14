/**
 * LLMClient unit tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LLMClient } from '../../src/client';

vi.mock('@mariozechner/pi-ai', () => ({
  complete: vi.fn(),
  stream: vi.fn(),
  getModel: vi.fn(),
}));

import { complete as piComplete, stream as piStream } from '@mariozechner/pi-ai';

describe('LLMClient', () => {
  let client: LLMClient;

  beforeEach(() => {
    client = new LLMClient();
  });

  describe('registration', () => {
    it('should register a provider', () => {
      client.registerProvider({
        name: 'test-provider',
        maxConcurrency: 5,
      });

      const stats = client.getStats();
      expect(stats.providerActiveCounts.has('test-provider')).toBe(true);
    });

    it('should throw when registering duplicate provider', () => {
      client.registerProvider({
        name: 'test-provider',
        maxConcurrency: 5,
      });

      expect(() => {
        client.registerProvider({
          name: 'test-provider',
          maxConcurrency: 3,
        });
      }).toThrow('already registered');
    });

    it('should register an API key', () => {
      client.registerProvider({
        name: 'openai',
        maxConcurrency: 10,
      });

      client.registerApiKey({
        key: 'sk-test123',
        provider: 'openai',
        maxConcurrency: 3,
        models: [{ modelId: 'gpt-4', maxConcurrency: 2 }],
      });

      const stats = client.getStats();
      expect(stats.keyHealth.size).toBe(1);
    });

    it('should throw when registering key for non-existent provider', () => {
      expect(() => {
        client.registerApiKey({
          key: 'sk-test',
          provider: 'non-existent',
          maxConcurrency: 3,
          models: [],
        });
      }).toThrow('not registered');
    });

    it('should throw when registering duplicate API key', () => {
      client.registerProvider({ name: 'openai', maxConcurrency: 10 });
      client.registerApiKey({
        key: 'sk-same',
        provider: 'openai',
        maxConcurrency: 3,
        models: [],
      });

      expect(() => {
        client.registerApiKey({
          key: 'sk-same',
          provider: 'openai',
          maxConcurrency: 5,
          models: [],
        });
      }).toThrow('already registered');
    });
  });

  describe('stats', () => {
    it('should return initial stats', () => {
      const stats = client.getStats();

      expect(stats.queueSize).toBe(0);
      expect(stats.activeRequests).toBe(0);
      expect(stats.keyHealth.size).toBe(0);
      expect(stats.providerActiveCounts.size).toBe(0);
    });

    it('should reflect registered providers in stats', () => {
      client.registerProvider({ name: 'p1', maxConcurrency: 5 });
      client.registerProvider({ name: 'p2', maxConcurrency: 10 });

      const stats = client.getStats();
      expect(stats.providerActiveCounts.size).toBe(2);
      expect(stats.providerActiveCounts.get('p1')).toBe(0);
      expect(stats.providerActiveCounts.get('p2')).toBe(0);
    });
  });

  describe('events', () => {
    it('should emit queued, started, and completed state events during a call', async () => {
      vi.mocked(piComplete).mockResolvedValue({
        content: [{ type: 'text', text: 'Hello!' }],
        usage: { input: 5, output: 2 },
        stopReason: 'stop',
      } as never);

      const events: string[] = [];
      client.on('state', (event) => {
        events.push(event.type);
      });

      client.registerProvider({ name: 'openai', maxConcurrency: 5 });
      client.registerApiKey({
        key: 'sk-test',
        provider: 'openai',
        maxConcurrency: 3,
        models: [{ modelId: 'gpt-4', maxConcurrency: 2 }],
      });

      await client.call({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(events).toContain('queued');
      expect(events).toContain('started');
      expect(events).toContain('completed');
    });
  });

  describe('clear', () => {
    it('should clear all registrations', () => {
      client.registerProvider({ name: 'openai', maxConcurrency: 10 });
      client.registerApiKey({
        key: 'sk-test',
        provider: 'openai',
        maxConcurrency: 3,
        models: [{ modelId: 'gpt-4', maxConcurrency: 2 }],
      });

      expect(client.getStats().providerActiveCounts.size).toBe(1);

      client.clear();

      expect(client.getStats().providerActiveCounts.size).toBe(0);
      expect(client.getStats().keyHealth.size).toBe(0);
    });
  });

  describe('streaming', () => {
    it('should support streaming calls', async () => {
      expect(typeof client.stream).toBe('function');
    });
  });

  describe('getModelMeta', () => {
    it('returns metadata from registered model', () => {
      client.registerProvider({ name: 'openai', maxConcurrency: 10 });
      client.registerApiKey({
        key: 'test-key',
        provider: 'openai',
        maxConcurrency: 5,
        models: [
          {
            modelId: 'glm-5',
            maxConcurrency: 3,
            contextWindow: 200000,
            maxTokens: 131072,
            reasoning: true,
          },
        ],
      });

      const meta = client.getModelMeta('glm-5');
      expect(meta.contextWindow).toBe(200000);
      expect(meta.maxTokens).toBe(131072);
    });

    it('returns defaults for model without metadata', () => {
      client.registerProvider({ name: 'openai', maxConcurrency: 10 });
      client.registerApiKey({
        key: 'test-key',
        provider: 'openai',
        maxConcurrency: 5,
        models: [{ modelId: 'some-model', maxConcurrency: 3 }],
      });

      const meta = client.getModelMeta('some-model');
      expect(meta.contextWindow).toBe(128000);
      expect(meta.maxTokens).toBe(16384);
    });

    it('returns fallback when no API key is registered', () => {
      const meta = client.getModelMeta('unknown-model');
      expect(meta.contextWindow).toBe(128000);
      expect(meta.maxTokens).toBe(16384);
    });
  });

  describe('getModelCapabilities', () => {
    it('returns strict capabilities from registered model', () => {
      client.registerProvider({ name: 'openai', maxConcurrency: 10 });
      client.registerApiKey({
        key: 'test-key',
        provider: 'openai',
        maxConcurrency: 5,
        models: [
          {
            modelId: 'gpt-4',
            maxConcurrency: 3,
            contextWindow: 200000,
            maxTokens: 131072,
            reasoning: true,
            input: ['text', 'image'],
          },
        ],
      });

      const caps = client.getModelCapabilities('gpt-4');
      expect(caps.contextWindow).toBe(200000);
      expect(caps.maxTokens).toBe(131072);
      expect(caps.reasoning).toBe(true);
      expect(caps.input).toEqual(['text', 'image']);
    });

    it('returns fallback capabilities for unregistered model', () => {
      client.registerProvider({ name: 'openai', maxConcurrency: 10 });
      client.registerApiKey({
        key: 'test-key',
        provider: 'openai',
        maxConcurrency: 5,
        models: [{ modelId: 'other-model', maxConcurrency: 3 }],
      });

      const caps = client.getModelCapabilities('other-model');
      expect(caps.contextWindow).toBe(128000);
      expect(caps.maxTokens).toBe(16384);
      expect(caps.reasoning).toBe(true);
      expect(caps.input).toEqual(['text']);
    });

    it('returns fallback when no API key is registered', () => {
      const caps = client.getModelCapabilities('unknown-model');
      expect(caps.contextWindow).toBe(128000);
      expect(caps.maxTokens).toBe(16384);
      expect(caps.reasoning).toBe(true);
      expect(caps.input).toEqual(['text']);
    });
  });

  describe('stream()', () => {
    it('yields events from the adapter stream', async () => {
      async function* mockStream() {
        yield { type: 'text_delta', delta: 'Hello' } as never;
        yield { type: 'done', message: { usage: { input: 1, output: 1 } } } as never;
      }
      vi.mocked(piStream).mockReturnValue(mockStream());

      client.registerProvider({ name: 'openai', maxConcurrency: 5 });
      client.registerApiKey({
        key: 'sk-test',
        provider: 'openai',
        maxConcurrency: 3,
        models: [{ modelId: 'gpt-4', maxConcurrency: 2 }],
      });

      const events = [];
      for await (const event of client.stream({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        events.push(event);
      }

      expect(events).toContainEqual({ type: 'text', delta: 'Hello' });
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'done', roundTotalTokens: { input: 1, output: 1 } })
      );
    });
  });

  describe('multi-provider baseUrl routing', () => {
    beforeEach(() => {
      vi.mocked(piComplete).mockClear();
      vi.mocked(piComplete).mockResolvedValue({
        content: [{ type: 'text', text: 'Ok' }],
        usage: { input: 1, output: 1 },
        stopReason: 'stop',
      } as never);
    });

    it('routes model to provider-specific baseUrl', async () => {
      client.registerProvider({
        name: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        maxConcurrency: 5,
      });
      client.registerProvider({
        name: 'zhipu',
        baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
        maxConcurrency: 5,
      });

      client.registerApiKey({
        key: 'sk-openai',
        provider: 'openai',
        maxConcurrency: 3,
        models: [{ modelId: 'gpt-4', maxConcurrency: 2 }],
      });
      client.registerApiKey({
        key: 'sk-zhipu',
        provider: 'zhipu',
        maxConcurrency: 3,
        models: [{ modelId: 'GLM-4.7', maxConcurrency: 2 }],
      });

      await client.call({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hi' }] });
      await client.call({ model: 'GLM-4.7', messages: [{ role: 'user', content: 'Hi' }] });

      const calls = vi.mocked(piComplete).mock.calls;
      expect(calls).toHaveLength(2);

      const baseUrls = calls.map((call) => (call[0] as { baseUrl?: string }).baseUrl);
      expect(baseUrls).toContain('https://api.openai.com/v1');
      expect(baseUrls).toContain('https://open.bigmodel.cn/api/coding/paas/v4');
    });

    it('uses API-key-level baseUrl override', async () => {
      client.registerProvider({
        name: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        maxConcurrency: 5,
      });
      client.registerApiKey({
        key: 'sk-proxy',
        provider: 'openai',
        baseUrl: 'https://proxy.example.com/v1',
        maxConcurrency: 3,
        models: [{ modelId: 'gpt-4', maxConcurrency: 2 }],
      });

      await client.call({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hi' }] });

      const calls = vi.mocked(piComplete).mock.calls;
      const modelArg = calls[calls.length - 1][0] as { baseUrl?: string };
      expect(modelArg.baseUrl).toBe('https://proxy.example.com/v1');
    });

    it('falls back to LLMClient-level baseUrl when provider has none', async () => {
      const defaultClient = new LLMClient({
        baseUrl: 'https://global-fallback.example.com/v1',
      });
      defaultClient.registerProvider({ name: 'openai', maxConcurrency: 5 });
      defaultClient.registerApiKey({
        key: 'sk-test',
        provider: 'openai',
        maxConcurrency: 3,
        models: [{ modelId: 'gpt-4', maxConcurrency: 2 }],
      });

      await defaultClient.call({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hi' }] });

      const calls = vi.mocked(piComplete).mock.calls;
      const modelArg = calls[calls.length - 1][0] as { baseUrl?: string };
      expect(modelArg.baseUrl).toBe('https://global-fallback.example.com/v1');
    });
  });
});
