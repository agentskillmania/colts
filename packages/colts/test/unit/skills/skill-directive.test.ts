/**
 * R2P-114: skill-directive marker on engine-injected directive rows
 * (aligned with Rust 87a54aa).
 *
 * After a successful load_skill the engine injects a user-role driving
 * instruction (the task text, or the fallback English line). Unmarked, the
 * history rebuild (fromHistory) renders it as a real user line — a line the
 * user never said, wedged between the skill block and the following content,
 * cutting the assistant turn (live/resume non-isomorphic).
 *
 * Rust added MessageType::SkillDirective (kebab: skill-directive) to tag the
 * injected row: LLM assembly treats it by role and still sends it as a plain
 * user message (zero model-side change); the frontend skips bubble rendering
 * and does not reset the current turn.
 *
 * colts-side boundary contract (this file pins it):
 * - The wire name is kebab-case 'skill-directive' (Rust serde rename_all);
 *   JSON round-trip keeps the marker recognizable for history rebuild.
 * - The colts DefaultMessageAssembler passes such rows through as ordinary
 *   user messages (filtering is NOT this type's job, unlike system rows).
 * - DIFFERENT mechanism from system-reminder rows: those are role 'system'
 *   legacy rows the assembler skips; skill-directive rows are role 'user'
 *   conversation participants.
 */

import { describe, it, expect } from 'vitest';
import { DefaultMessageAssembler } from '../../../src/message-assembler/default-assembler.js';
import { createAgentState, addUserMessage } from '../../../src/state/index.js';
import type { AgentConfig, Message } from '../../../src/types.js';

const config: AgentConfig = {
  name: 'test-agent',
  instructions: 'You are a helpful assistant.',
  tools: [],
};

/** Build a state whose last user row is a tagged skill directive. */
function stateWithDirective(): { state: ReturnType<typeof createAgentState>; directive: Message } {
  let state = createAgentState(config);
  state = addUserMessage(state, 'draw a sunset');
  const directive: Message = {
    id: 'directive-1',
    role: 'user',
    content: 'Follow the loaded skill instructions to complete the user request.',
    type: 'skill-directive',
    timestamp: Date.now(),
  };
  state = {
    ...state,
    context: { ...state.context, messages: [...state.context.messages, directive] },
  };
  return { state, directive };
}

describe('R2P-114: skill-directive wire shape', () => {
  it('serializes with the kebab-case type key (history round-trip recognizable)', () => {
    const { directive } = stateWithDirective();
    // Wire/archive shape must match Rust serde: "type":"skill-directive".
    const json = JSON.stringify(directive);
    expect(json).toContain('"type":"skill-directive"');
    // Round-trip through JSON (the persistence path) keeps the marker.
    const restored = JSON.parse(json) as Message;
    expect(restored.role).toBe('user');
    expect(restored.type).toBe('skill-directive');
  });
});

describe('R2P-114: colts assembler boundary for skill-directive rows', () => {
  it('DefaultMessageAssembler sends skill-directive rows as ordinary user messages', async () => {
    // Zero model-side change: assembly is by role, the type marker is for the
    // history rebuild only (same as Rust — the LLM still sees a user message).
    const { state } = stateWithDirective();

    const assembler = new DefaultMessageAssembler();
    const messages = await assembler.build(state, { model: 'test-model' });

    const texts = messages.map((m) =>
      typeof m.content === 'string'
        ? m.content
        : m.content.map((c) => (c.type === 'text' ? c.text : '')).join('')
    );
    expect(texts.some((t) => t.includes('draw a sunset'))).toBe(true);
    expect(
      texts.some((t) =>
        t.includes('Follow the loaded skill instructions to complete the user request.')
      )
    ).toBe(true);
  });

  it('is distinct from system-reminder rows: user-role rows are never filtered by type', async () => {
    // The two row markers must not be confused: system-reminder rows are
    // role 'system' (assembler-skipped, legacy replay); skill-directive rows
    // are role 'user' conversation participants that pass through untouched.
    const { state } = stateWithDirective();
    const assembler = new DefaultMessageAssembler();
    const messages = await assembler.build(state, { model: 'test-model' });

    const directiveMsg = messages.find((m) =>
      typeof m.content === 'string'
        ? m.content.includes('Follow the loaded skill instructions')
        : m.content.some(
            (c) => c.type === 'text' && c.text.includes('Follow the loaded skill instructions')
          )
    );
    expect(directiveMsg).toBeDefined();
    expect(directiveMsg!.role).toBe('user');
  });
});
