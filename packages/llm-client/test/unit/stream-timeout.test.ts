/**
 * streamWithRetry 的 requestTimeout 总时长约束测试。
 *
 * 修复前：requestTimeout 只在 call() 路径生效，stream 路径完全不消费
 * ——挂死的流永不 resolve，调用方的轮永远 busy（只能手工 stop）。
 * 修复后：连接阶段与逐事件迭代都受同一 deadline 约束，超时产出
 * error 事件（与 call() 的超时语义一致）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@mariozechner/pi-ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mariozechner/pi-ai')>();
  return { ...actual, stream: vi.fn() };
});

import { stream as piStreamMock } from '@mariozechner/pi-ai';
import { PiAiAdapter } from '../../src/adapter.js';

function neverResolvingStream() {
  return {
    async *[Symbol.asyncIterator]() {
      await new Promise(() => {
        /* never resolves — 模拟挂死的 LLM 流 */
      });
    },
  };
}

beforeEach(() => {
  vi.mocked(piStreamMock).mockReset();
});

describe('streamWithRetry: requestTimeout 总时长', () => {
  it('挂死的流在超时后产出 error 事件（而非永久挂起）', async () => {
    vi.mocked(piStreamMock).mockReturnValue(neverResolvingStream() as never);
    const adapter = new PiAiAdapter();
    const events: Array<{ type: string; error?: string }> = [];
    for await (const ev of adapter.streamWithRetry({
      modelId: 'gpt-4',
      apiKey: 'k',
      options: {
        messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
        requestTimeout: 50,
        retryOptions: { retries: 0 },
      },
    })) {
      events.push(ev as { type: string; error?: string });
    }
    const err = events.find((e) => e.type === 'error');
    expect(err).toBeDefined();
    expect(err!.error).toMatch(/timeout/i);
  });

  it('未设 requestTimeout 时行为不变（长流不受影响）', async () => {
    vi.mocked(piStreamMock).mockReturnValue({
      async *[Symbol.asyncIterator]() {
        // pi-ai 的原生事件形状：text_start → text_end（mapEvent 映射为
        // 本包 StreamEvent 的 'text'）。
        yield { type: 'text_start' } as never;
        yield { type: 'text_end', content: 'ok' } as never;
      },
    } as never);
    const adapter = new PiAiAdapter();
    const seen: string[] = [];
    for await (const ev of adapter.streamWithRetry({
      modelId: 'gpt-4',
      apiKey: 'k',
      options: {
        messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
        retryOptions: { retries: 0 },
      },
    })) {
      seen.push((ev as { type: string }).type);
    }
    expect(seen).toContain('text');
  });
});
