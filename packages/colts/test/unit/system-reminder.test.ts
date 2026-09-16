/**
 * R2P-101b: SystemReminder row primitive (legacy, aligned with Rust HEAD).
 *
 * Evolution chain (Rust): 5120a3e introduced MessageType::SystemReminder +
 * add_system_reminder — the daemon persisted one frozen time-context row per
 * turn, merged by the wrangler-side assembler into the preceding user
 * message's <system-reminder> tail. 1f08b1f then REMOVED the per-turn
 * writes: current time is computed per request by the wrangler-side
 * assembler as the first line of the trailing dynamic reminder. At HEAD the
 * colts-side row type + writer survive purely as LEGACY: old archives
 * (written between those two commits) must deserialize and replay.
 *
 * colts-side boundary contract (this file pins it):
 * - addSystemReminder appends role:'system' + type:'system-reminder' rows;
 *   content is frozen per turn (persisted verbatim).
 * - It is a DIFFERENT mechanism from marker rows (addSystemMessage):
 *   marker rows are LLM-invisible timeline traces; system-reminder rows are
 *   LLM-visible once merged (wrangler-side concern, batch R2P-101w).
 * - The colts DefaultMessageAssembler skips system-reminder rows like every
 *   other system row — same as Rust colts' DefaultMessageAssembler. Merging
 *   into the previous user message happens ONLY in the wrangler assembler.
 */

import { describe, it, expect } from 'vitest';
import { DefaultMessageAssembler } from '../../src/message-assembler/default-assembler.js';
import {
  createAgentState,
  addUserMessage,
  addSystemMessage,
  addSystemReminder,
} from '../../src/state/index.js';
import type { AgentConfig, AgentState } from '../../src/types.js';

const config: AgentConfig = {
  name: 'test-agent',
  instructions: 'You are a helpful assistant.',
  tools: [],
};

describe('R2P-101b: addSystemReminder (legacy row primitive)', () => {
  it('appends a role:system row typed system-reminder with token estimate', () => {
    let state = createAgentState(config);
    state = addUserMessage(state, 'hello');
    state = addSystemReminder(state, 'Time: X');

    expect(state.context.messages).toHaveLength(2);
    const row = state.context.messages[1];
    expect(row.role).toBe('system');
    expect(row.type).toBe('system-reminder');
    expect(row.content).toBe('Time: X');
    expect(typeof row.tokenCount).toBe('number');
    expect(row.tokenCount!).toBeGreaterThan(0);
  });

  it('serializes with the kebab-case type key (old-end recognizable)', () => {
    // Wire/archive shape must match Rust serde: "type":"system-reminder".
    let state = createAgentState(config);
    state = addSystemReminder(state, 'Time: Wednesday, 13/05/2026, 10:06 (+08:00)');
    const json = JSON.stringify(state.context.messages[0]);
    expect(json).toContain('"type":"system-reminder"');
  });

  it('is immutable and freezes content per turn — original state untouched', () => {
    const state = createAgentState(config);
    const before = state.context.messages.length;
    const returned = addSystemReminder(state, 'Time: X');
    expect(state.context.messages.length).toBe(before);
    expect(returned.context.messages.length).toBe(before + 1);
    // Persisted verbatim: replays of this row are byte-stable, which is the
    // whole point of freezing per turn (prefix-cache friendliness).
    expect(returned.context.messages[returned.context.messages.length - 1].content).toBe('Time: X');
  });

  it('differs from marker rows: addSystemMessage rows carry no type', () => {
    // Two mechanisms: marker rows (LLM-invisible timeline traces) never set
    // `type`; system-reminder rows always carry type 'system-reminder'.
    let state = createAgentState(config);
    state = addSystemMessage(state, '{"kind":"compact"}');
    state = addSystemReminder(state, 'Time: X');
    expect(state.context.messages[0].type).toBeUndefined();
    expect(state.context.messages[1].type).toBe('system-reminder');
  });
});

describe('R2P-101b: colts assembler boundary for system-reminder rows', () => {
  it('DefaultMessageAssembler skips system-reminder rows (merge is wrangler-side)', async () => {
    // Same as Rust colts: the default assembler skips ALL system rows,
    // including typed system-reminder ones. Merging the row into the
    // preceding user message's <system-reminder> tail is exclusively the
    // wrangler-side assembler's legacy replay branch (batch R2P-101w).
    let state: AgentState = createAgentState(config);
    state = addUserMessage(state, 'hello');
    state = addSystemReminder(state, 'Time: X');
    state = addUserMessage(state, 'next turn');

    const assembler = new DefaultMessageAssembler();
    const messages = await assembler.build(state, { model: 'test-model' });

    const texts = messages.map((m) =>
      typeof m.content === 'string'
        ? m.content
        : m.content.map((c) => (c.type === 'text' ? c.text : '')).join('')
    );
    expect(texts.some((t) => t.includes('hello'))).toBe(true);
    expect(texts.some((t) => t.includes('next turn'))).toBe(true);
    expect(texts.some((t) => t.includes('Time: X'))).toBe(false);
    expect(texts.some((t) => t.includes('<system-reminder>'))).toBe(false);
  });
});
