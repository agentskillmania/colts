/**
 * Multimodal integration tests — real LLM calls with image input.
 *
 * Mirrors Rust 35dc808 `multimodal_integration.rs`. Uses the dedicated
 * `_MULTIMODEL` env series (see ./config.ts) so these tests point at a
 * vision-capable model independently of the text-only main config:
 * - OPENAI_API_KEY_MULTIMODEL / OPENAI_BASE_URL_MULTIMODEL
 * - PROVIDER_MULTIMODEL / MODEL_MULTIMODEL
 * - ENABLE_MULTIMODEL_INTEGRATION_TESTS=true
 *
 * Skip accounting: this file registers exactly ONE itif-gated test, so an
 * unconfigured environment contributes exactly 1 skip (colts gate.sh known
 * exception ceiling 3 = multi-key 2 + multimodel 1).
 */

import { describe, it, expect } from 'vitest';
import { LLMClient } from '../../src/client';
import type { AssistantMessage, Message, UserMessage } from '../../src/types';
import { multimodalConfig, isMultimodalConfigured, itif } from './config';

/**
 * 64x64 solid red PNG (test fixture, generated locally with zlib — verified
 * to decode back to solid red and accepted by the real vision API).
 *
 * NOTE: deliberately NOT the Rust 35dc808 fixture constant — that base64 is a
 * malformed PNG (broken IDAT), rejected by the provider as "unsupported
 * image". The Rust test never ran against a real API (Rust .env never set
 * ENABLE_MULTIMODEL_INTEGRATION_TESTS), so its fixture went unvalidated;
 * this is the corrected equivalent fixture.
 */
const RED_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAb0lEQVR4nO3PAQkAAAyEwO9feoshgnABdLep8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3IPanc8OLDQitxAAAAAElFTkSuQmCC';

/**
 * Build the multimodal client: register the vision model WITH the image
 * input declaration — the declaration chain under test. Without it, the
 * client-side multimodal gate (mirroring Rust 37c3395) would reject every
 * image-carrying request below.
 */
function createMultimodalClient(): LLMClient {
  const client = new LLMClient({ baseUrl: multimodalConfig.baseUrl });
  client.registerProvider({
    name: multimodalConfig.provider,
    ...(multimodalConfig.baseUrl !== undefined && { baseUrl: multimodalConfig.baseUrl }),
    maxConcurrency: 5,
  });
  client.registerApiKey({
    key: multimodalConfig.apiKey,
    provider: multimodalConfig.provider,
    maxConcurrency: 3,
    ...(multimodalConfig.baseUrl !== undefined && { baseUrl: multimodalConfig.baseUrl }),
    models: [
      {
        modelId: multimodalConfig.testModel,
        maxConcurrency: 2,
        // 关键:声明图像输入能力,否则多模态 gate 客户端侧拒绝。
        input: ['text', 'image'],
      },
    ],
  });
  return client;
}

/** User message carrying text + image parts (pi-ai serializes to data URL). */
function imageMessage(text: string): UserMessage {
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      { type: 'image', data: RED_PNG_BASE64, mimeType: 'image/png' },
    ],
    timestamp: Date.now(),
  };
}

/** Plain-string user message. */
function textMessage(text: string): UserMessage {
  return { role: 'user', content: text, timestamp: Date.now() };
}

/** Assistant history entry built from a previous response. */
function assistantMessage(content: string): AssistantMessage {
  return { role: 'assistant', content: [{ type: 'text', text: content }], timestamp: Date.now() };
}

function assertRed(content: string, context: string): void {
  const lower = content.toLowerCase();
  expect(
    lower.includes('红') || lower.includes('red'),
    `${context}: expected the model to identify red, got: ${content}`
  ).toBe(true);
}

describe('Integration: Multimodal input (real vision model, _MULTIMODEL env)', () => {
  // 单一 itif:env 未配时恰好计 1 个 skip(gate.sh 已知例外上限 3 的第三席)。
  // 三个场景(Rust 35dc808 的三个测试)在一个测试内顺序执行:
  // 单轮识图 / 多轮带图历史追问 / 纯文本兼容回归。
  itif(isMultimodalConfigured())(
    'multimodal: image understanding, multimodal history follow-up, plain-text compat',
    async () => {
      const client = createMultimodalClient();
      const model = multimodalConfig.testModel;

      // ── 场景 1:单轮识图(64x64 纯红 PNG → 模型识别红色) ──────────
      const first = await client.call({
        model,
        messages: [imageMessage('这张图片是什么颜色?用一个词回答。')],
        requestTimeout: 120000,
      });
      console.log('[multimodal] single-turn:', first.content);
      expect(first.content.length).toBeGreaterThan(0);
      assertRed(first.content, 'single-turn image understanding');

      // ── 场景 2:多轮带图历史追问(历史消息多模态全链路:gate → 调度 →
      // pi-ai wire)。第二轮历史里保留图片 parts + 助手回答,追问颜色。 ──
      const history: Message[] = [
        imageMessage('记住这张图片的颜色,只用"记住了"回答。'),
        assistantMessage(first.content),
        textMessage('我刚才给你看的图片是什么颜色?'),
      ];
      const second = await client.call({
        model,
        messages: history,
        requestTimeout: 120000,
      });
      console.log('[multimodal] follow-up:', second.content);
      assertRed(second.content, 'multimodal history follow-up');

      // ── 场景 3:同一多模态客户端上,纯文本请求行为不变(兼容回归)。 ──
      const plain = await client.call({
        model,
        messages: [textMessage('用"好"回答。')],
        requestTimeout: 120000,
      });
      console.log('[multimodal] plain-text:', plain.content);
      expect(plain.content.length).toBeGreaterThan(0);
    },
    400000
  );
});
