/**
 * @fileoverview Compressor skill instruction exemption
 *
 * Task 4 of "skill 持续性重设计": load_skill tool results carry the SKILL.md body
 * and must persist through compression. This test verifies that the prune and
 * truncate stages of DefaultContextCompressor leave load_skill tool results intact.
 */

import { describe, it, expect } from 'vitest';
import { DefaultContextCompressor } from '../../../src/compressor/index.js';
import { createAgentState } from '../../../src/state/index.js';
import type { AgentState, Message } from '../../../src/types.js';

// Helper: build an AgentState seeded with the given messages.
function makeState(messages: Message[]): AgentState {
  const state = createAgentState({
    name: 't',
    instructions: '',
    tools: [],
  });
  // Replace the default empty history with the provided fixtures.
  state.context.messages = messages;
  return state;
}

describe('compressor skill exemption', () => {
  it('prune must NOT stub load_skill tool results', async () => {
    // Well over the default pruneThreshold (150 tokens) so a non-exempt tool
    // would be stubbed.
    const longInstructions = 'A'.repeat(2000);
    const state = makeState([
      { id: '1', role: 'user', content: 'hi', type: 'text', timestamp: 0, tokenCount: 1 },
      {
        id: '2',
        role: 'assistant',
        content: '',
        type: 'text',
        timestamp: 0,
        toolCalls: [{ id: 'c1', name: 'load_skill', arguments: { name: 'x' } }],
      },
      {
        id: '3',
        role: 'tool',
        content: longInstructions,
        type: 'tool-result',
        timestamp: 0,
        tokenCount: 2000,
        toolCallId: 'c1',
        toolName: 'load_skill',
      },
      { id: '4', role: 'assistant', content: 'done', type: 'text', timestamp: 0 },
    ]);
    const c = new DefaultContextCompressor({ strategy: 'truncate', keepRecent: 1, threshold: 1 });
    const result = await c.compress(state);
    const pruned = result.prunedMessages ?? [];
    // load_skill result (index 2) must not appear in prunedMessages.
    expect(pruned.find((p) => p.index === 2)).toBeUndefined();
  });

  it('truncate anchor must keep load_skill results visible', async () => {
    const state = makeState([
      { id: '1', role: 'user', content: 'hi', type: 'text', timestamp: 0, tokenCount: 1 },
      {
        id: '2',
        role: 'assistant',
        content: '',
        type: 'text',
        timestamp: 0,
        toolCalls: [{ id: 'c1', name: 'load_skill', arguments: { name: 'x' } }],
      },
      {
        id: '3',
        role: 'tool',
        content: 'instructions',
        type: 'tool-result',
        timestamp: 0,
        tokenCount: 1,
        toolCallId: 'c1',
        toolName: 'load_skill',
      },
      // Padding so truncate would normally drop index 3.
      ...Array.from({ length: 15 }, (_, i) => ({
        id: `${i + 4}`,
        role: (i % 2 ? 'user' : 'assistant') as Message['role'],
        content: 'x',
        type: 'text' as const,
        timestamp: 0,
        tokenCount: 1,
      })),
    ]);
    const c = new DefaultContextCompressor({ strategy: 'truncate', keepRecent: 5, threshold: 1 });
    const result = await c.compress(state);
    // Anchor must be <= 3 so the load_skill result (index 3) stays after anchor (visible).
    expect(result.anchor).toBeLessThanOrEqual(3);
  });
});
