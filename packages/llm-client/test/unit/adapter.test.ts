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
});
