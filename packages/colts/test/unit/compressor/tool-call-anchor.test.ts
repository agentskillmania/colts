/**
 * @fileoverview Compressor anchor safety rule (R2P-102, aligned with Rust 6817c6c)
 *
 * The anchor may only land on a `user` message — a natural safe boundary that
 * closes ALL pairings (toolCalls→tool results, reasoningContent→assistant).
 * Originally a regression test for the one-step orphan-tool guard (Rust 39b646f):
 * if the raw truncate anchor landed right after an assistant `toolCalls` message
 * but before its `tool` result(s), the assembler would emit an orphan
 * `role:"tool"` whose `toolCallId` points at a dropped assistant — rejected by
 * the LLM as "Messages with role 'tool' must be a response to a preceding
 * message with 'tool_calls'". R2P-102 replaced that per-case back-up with the
 * stronger "land on a user message" rule: the anchor backs up to the nearest
 * user message, which subsumes the old guard (the assistant(toolCalls) stays
 * paired with its results because the whole turn is kept).
 */

import { describe, it, expect } from 'vitest';
import { DefaultContextCompressor } from '../../../src/compressor/index.js';
import { createAgentState } from '../../../src/state/index.js';
import type { AgentState, Message } from '../../../src/types.js';

function makeState(messages: Message[]): AgentState {
  const state = createAgentState({
    name: 't',
    instructions: '',
    tools: [],
  });
  state.context.messages = messages;
  return state;
}

describe('compressor orphan-tool anchor guard', () => {
  it('backs the anchor up past an assistant(toolCalls) to avoid an orphan tool result', async () => {
    // [user, assistant(toolCalls c1), tool(result c1)] — length 3, keepRecent 1
    // ⇒ raw anchor = 2 (the tool result index), which would slice to [tool] (orphan).
    const state = makeState([
      { id: '1', role: 'user', content: 'hi', type: 'text', timestamp: 0, tokenCount: 1 },
      {
        id: '2',
        role: 'assistant',
        content: '',
        type: 'text',
        timestamp: 0,
        toolCalls: [{ id: 'c1', name: 'search', arguments: { q: 'x' } }],
      },
      {
        id: '3',
        role: 'tool',
        content: 'result',
        type: 'tool-result',
        timestamp: 0,
        tokenCount: 1,
        toolCallId: 'c1',
        toolName: 'search',
      },
    ]);
    const c = new DefaultContextCompressor({ strategy: 'truncate', keepRecent: 1, threshold: 1 });
    const result = await c.compress(state);
    // R2P-102: anchor 只能落在用户消息上 → raw 2(tool)回退到 0(最近的 user)。
    // assistant(toolCalls) 与它的 tool 结果作为完整一轮保留在发送窗口内。
    expect(result.anchor).toBe(0);
  });

  it('backs the anchor up for parallel tool calls (assistant with N toolCalls)', async () => {
    const state = makeState([
      { id: '1', role: 'user', content: 'hi', type: 'text', timestamp: 0, tokenCount: 1 },
      {
        id: '2',
        role: 'assistant',
        content: '',
        type: 'text',
        timestamp: 0,
        toolCalls: [
          { id: 'c1', name: 'a', arguments: {} },
          { id: 'c2', name: 'b', arguments: {} },
        ],
      },
      {
        id: '3',
        role: 'tool',
        content: 'r1',
        type: 'tool-result',
        timestamp: 0,
        tokenCount: 1,
        toolCallId: 'c1',
        toolName: 'a',
      },
      {
        id: '4',
        role: 'tool',
        content: 'r2',
        type: 'tool-result',
        timestamp: 0,
        tokenCount: 1,
        toolCallId: 'c2',
        toolName: 'b',
      },
    ]);
    // length 4, keepRecent 2 ⇒ raw anchor = 2 (first tool result) → orphans both.
    const c = new DefaultContextCompressor({ strategy: 'truncate', keepRecent: 2, threshold: 1 });
    const result = await c.compress(state);
    // R2P-102: raw 2(tool)回退到 0(user)。两个 tool 结果与父 assistant 完整保留。
    expect(result.anchor).toBe(0);
  });

  it('also backs a non-toolCalls assistant anchor up to the user message (R2P-102 stronger rule)', async () => {
    const state = makeState([
      { id: '1', role: 'user', content: 'hi', type: 'text', timestamp: 0, tokenCount: 1 },
      { id: '2', role: 'assistant', content: 'hello', type: 'text', timestamp: 0, tokenCount: 1 },
      { id: '3', role: 'assistant', content: 'world', type: 'text', timestamp: 0, tokenCount: 1 },
    ]);
    // No toolCalls anywhere, but the raw anchor (2) still lands on an assistant.
    // R2P-102 一律回退到最近 user（0）——旧规则的"无 toolCalls 不回退"不再成立，
    // user 边界规则对 reasoning_content 等配对同样安全。
    const c = new DefaultContextCompressor({ strategy: 'truncate', keepRecent: 1, threshold: 1 });
    const result = await c.compress(state);
    expect(result.anchor).toBe(0);
  });
});
