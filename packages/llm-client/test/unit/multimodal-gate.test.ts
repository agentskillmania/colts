/**
 * Multimodal input declaration chain + defensive gate unit tests.
 *
 * Mirrors Rust 37c3395:
 * - `multimodal_gate.rs`: image parts on a model without image input declared
 *   are rejected client-side (never reach the scheduler/provider).
 * - `meta_constraint.rs` spirit: the input declaration flows from config
 *   (quickInit / registerApiKey) through the registered constraint into the
 *   pi-ai request construction.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LLMClient } from '../../src/client';
import type { Message, UserMessage } from '../../src/types';

vi.mock('@mariozechner/pi-ai', () => ({
  complete: vi.fn(),
  stream: vi.fn(),
  getModel: vi.fn(),
}));

import { complete as piComplete, stream as piStream } from '@mariozechner/pi-ai';

/** Build a client whose model `m` declares the given input modalities. */
function clientWithModel(input?: string[]): LLMClient {
  const client = new LLMClient();
  client.registerProvider({ name: 'p', maxConcurrency: 5 });
  client.registerApiKey({
    key: 'sk-test',
    provider: 'p',
    maxConcurrency: 5,
    models: [{ modelId: 'm', maxConcurrency: 5, ...(input !== undefined && { input }) }],
  });
  return client;
}

/** User message carrying text + image parts (base64 payload placeholder). */
function imageMessage(text: string): UserMessage {
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      { type: 'image', data: 'AAA', mimeType: 'image/png' },
    ],
    timestamp: Date.now(),
  };
}

/** Plain-string user message. */
function textMessage(text: string): UserMessage {
  return { role: 'user', content: text, timestamp: Date.now() };
}

function mockCompleteOk(): void {
  vi.mocked(piComplete).mockResolvedValue({
    content: [{ type: 'text', text: 'ok' }],
    usage: { input: 1, output: 1 },
    stopReason: 'stop',
  } as never);
}

describe('multimodal defensive gate (mirrors Rust multimodal_gate.rs)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCompleteOk();
  });

  it('rejects image parts when model does not declare image input', async () => {
    // Both the default (no input declaration → ['text']) and an explicit
    // text-only declaration must be rejected client-side.
    for (const input of [undefined, ['text']]) {
      const client = clientWithModel(input);
      await expect(
        client.call({ model: 'm', messages: [imageMessage('看图说话')] })
      ).rejects.toThrow('does not declare image input');
    }
    // The rejection happens before the request layer: pi-ai is never called.
    expect(piComplete).not.toHaveBeenCalled();
  });

  it('passes the gate when model declares image input', async () => {
    const client = clientWithModel(['text', 'image']);
    const response = await client.call({ model: 'm', messages: [imageMessage('看图说话')] });
    expect(response.content).toBe('ok');
    expect(piComplete).toHaveBeenCalledTimes(1);
  });

  it('plain text messages skip the gate', async () => {
    const client = clientWithModel(undefined);
    await client.call({ model: 'm', messages: [textMessage('hello')] });
    expect(piComplete).toHaveBeenCalledTimes(1);
  });

  it('text-only part arrays do not trigger the gate', async () => {
    // Stricter than Rust's has_parts() (any parts → gate): text parts are
    // wire-compatible with text-only models and must not be rejected.
    const client = clientWithModel(undefined);
    const message: UserMessage = {
      role: 'user',
      content: [{ type: 'text', text: '纯文本 parts' }],
      timestamp: Date.now(),
    };
    await client.call({ model: 'm', messages: [message] });
    expect(piComplete).toHaveBeenCalledTimes(1);
  });

  it('stream() rejects image parts for text-only models on first iteration', async () => {
    const client = clientWithModel(undefined);
    await expect(async () => {
      for await (const _event of client.stream({ model: 'm', messages: [imageMessage('看图')] })) {
        // unreachable: the gate rejects before any event is yielded
      }
    }).rejects.toThrow('does not declare image input');
  });

  it('stream() passes image parts through when image input is declared', async () => {
    async function* mockStream() {
      yield { type: 'done', message: { usage: { input: 1, output: 1 } } } as never;
    }
    vi.mocked(piStream).mockReturnValue(mockStream());

    const client = clientWithModel(['text', 'image']);
    const events: Array<{ type: string }> = [];
    for await (const event of client.stream({ model: 'm', messages: [imageMessage('看图')] })) {
      events.push(event);
    }
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  it('gates toolResult messages carrying image parts', async () => {
    const client = clientWithModel(undefined);
    const messages: Message[] = [
      textMessage('run the tool'),
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'screenshot',
        content: [{ type: 'image', data: 'AAA', mimeType: 'image/png' }],
        isError: false,
        timestamp: Date.now(),
      },
    ];
    await expect(client.call({ model: 'm', messages })).rejects.toThrow(
      'does not declare image input'
    );
  });

  it('rejects image parts for unregistered models (fallback is text-only)', async () => {
    const client = clientWithModel(['text', 'image']);
    await expect(
      client.call({ model: 'unregistered-model', messages: [imageMessage('看图')] })
    ).rejects.toThrow("model 'unregistered-model' does not declare image input");
    expect(piComplete).not.toHaveBeenCalled();
  });
});

describe('input modality declaration chain (config → registration → pi-ai request)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCompleteOk();
  });

  it('quickInit providers[].models[].input flows into the registered constraint', () => {
    const client = LLMClient.quickInit({
      providers: [
        {
          name: 'openai',
          apiKey: 'sk-x',
          models: [
            { modelId: 'glm-4.5v', input: ['text', 'image'] },
            { modelId: 'glm-5' }, // no declaration → adapter default ['text']
          ],
        },
      ],
    });

    expect(client.getModelCapabilities('glm-4.5v').input).toEqual(['text', 'image']);
    expect(client.getModelCapabilities('glm-5').input).toEqual(['text']);
  });

  it('declared input reaches the pi-ai request construction (model.input)', async () => {
    const client = clientWithModel(['text', 'image']);
    await client.call({ model: 'm', messages: [imageMessage('看图说话')] });

    // The Model object handed to pi-ai must carry the declared modalities —
    // pi-ai gates tool-result image serialization on model.input including
    // 'image', so losing this field would silently drop images downstream.
    const modelArg = vi.mocked(piComplete).mock.calls[0][0] as { input?: string[] };
    expect(modelArg.input).toEqual(['text', 'image']);
  });

  it('registerApiKey ModelConstraint.input reaches the pi-ai request construction', async () => {
    const client = LLMClient.quickInit({
      providers: [
        {
          name: 'openai',
          apiKey: 'sk-x',
          models: [{ modelId: 'gpt-4o', input: ['text', 'image'] }],
        },
      ],
    });
    await client.call({ model: 'gpt-4o', messages: [textMessage('hi')] });

    const modelArg = vi.mocked(piComplete).mock.calls[0][0] as { input?: string[] };
    expect(modelArg.input).toEqual(['text', 'image']);
  });

  it('models without declaration fall back to text-only in the request', async () => {
    const client = clientWithModel(undefined);
    await client.call({ model: 'm', messages: [textMessage('hi')] });

    const modelArg = vi.mocked(piComplete).mock.calls[0][0] as { input?: string[] };
    expect(modelArg.input).toEqual(['text']);
  });
});
