/**
 * @fileoverview Compressor orphan-tool anchor guard
 *
 * Regression for the bug fixed on the Rust side in `39b646f` / `compressor.rs`
 * (the `while anchor > existing_anchor` back-up loop): if the raw truncate
 * anchor lands immediately AFTER an assistant `toolCalls` message but BEFORE
 * its `tool` result(s), the assembler would emit an orphan `role:"tool"` whose
 * `toolCallId` points at a dropped assistant — rejected by the LLM as
 * "Messages with role 'tool' must be a response to a preceding message with
 * 'tool_calls'". The anchor must back up to include the assistant message.
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
    // Guard must back the anchor from 2 → 1 so the assistant(toolCalls) stays
    // paired with its tool result in the sent window.
    expect(result.anchor).toBe(1);
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
    expect(result.anchor).toBe(1);
  });

  it('does NOT back up for an assistant message without toolCalls (no false positive)', async () => {
    const state = makeState([
      { id: '1', role: 'user', content: 'hi', type: 'text', timestamp: 0, tokenCount: 1 },
      { id: '2', role: 'assistant', content: 'hello', type: 'text', timestamp: 0, tokenCount: 1 },
      { id: '3', role: 'assistant', content: 'world', type: 'text', timestamp: 0, tokenCount: 1 },
    ]);
    // No toolCalls anywhere ⇒ guard never fires ⇒ raw anchor (2) stands.
    const c = new DefaultContextCompressor({ strategy: 'truncate', keepRecent: 1, threshold: 1 });
    const result = await c.compress(state);
    expect(result.anchor).toBe(2);
  });
});
