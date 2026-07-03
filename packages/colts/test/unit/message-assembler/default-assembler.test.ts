/**
 * BUG4: enablePromptThinking must inject valid <think></think> tag syntax,
 * not literal placeholder text like "<think...</think (closing)>".
 *
 * The old code had unresolved placeholder annotations in the prompt text —
 * the LLM received garbled instructions instead of proper tag syntax.
 */

import { describe, it, expect } from 'vitest';
import { DefaultMessageAssembler } from '../../../src/message-assembler/default-assembler.js';
import type { AgentState } from '../../../src/types.js';

function makeState(): AgentState {
  return {
    id: 'test',
    config: { name: 'test', instructions: '', tools: [] },
    context: {
      messages: [],
      stepCount: 0,
      totalTokens: { input: 0, output: 0 },
    },
  } as unknown as AgentState;
}

describe('BUG4: enablePromptThinking injects valid tag syntax', () => {
  it('uses <think></think> tags, not placeholder text', () => {
    const assembler = new DefaultMessageAssembler();
    const messages = assembler.build(makeState(), {
      systemPrompt: 'You are helpful.',
      model: 'test-model',
      enablePromptThinking: true,
    });

    // Find the system instructions message
    const systemMsg = messages.find(
      (m) => typeof m.content === 'string' && m.content.includes('[System Instructions]')
    );
    expect(systemMsg).toBeDefined();

    const content = systemMsg!.content as string;

    // Must contain valid <think></think> tags
    expect(content).toContain('<think></think>');
    expect(content).toContain('</think>');

    // Must NOT contain the old placeholder annotations
    expect(content).not.toContain('(closing)');
    expect(content).not.toContain('<think...');
  });

  it('does not inject thinking guidance when enablePromptThinking is false', () => {
    const assembler = new DefaultMessageAssembler();
    const messages = assembler.build(makeState(), {
      systemPrompt: 'You are helpful.',
      model: 'test-model',
    });

    const systemMsg = messages.find(
      (m) => typeof m.content === 'string' && m.content.includes('[System Instructions]')
    );
    // When thinking is off, there may be no system instructions message at all,
    // or it should not contain think tags.
    if (systemMsg) {
      const content = systemMsg.content as string;
      expect(content).not.toContain('<think>');
    }
  });
});
