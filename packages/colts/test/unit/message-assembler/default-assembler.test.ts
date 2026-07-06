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

// ── ERR2: assembler must propagate isError from tool-result messages ──

describe('ERR2: assembler propagates isError flag on tool results', () => {
  it('maps a tool message with isError:true to toolResult.isError:true', () => {
    const state: AgentState = {
      id: 'test',
      config: { name: 'test', instructions: '', tools: [] },
      context: {
        messages: [
          {
            id: 'm1',
            role: 'tool',
            content: 'Tool execution rejected by human: delete_file',
            toolCallId: 'call_rej',
            toolName: 'delete_file',
            type: 'tool-result',
            isError: true,
            timestamp: Date.now(),
          },
        ],
        stepCount: 0,
        totalTokens: { input: 0, output: 0 },
      },
    } as unknown as AgentState;

    const assembler = new DefaultMessageAssembler();
    const messages = assembler.build(state, {
      systemPrompt: 'You are helpful.',
      model: 'test-model',
    });

    const toolResult = messages.find((m) => m.role === 'toolResult');
    expect(toolResult).toBeDefined();
    expect(toolResult!.isError).toBe(true);
  });

  it('defaults isError to false for normal tool results', () => {
    const state: AgentState = {
      id: 'test',
      config: { name: 'test', instructions: '', tools: [] },
      context: {
        messages: [
          {
            id: 'm1',
            role: 'tool',
            content: 'File deleted successfully',
            toolCallId: 'call_ok',
            toolName: 'delete_file',
            type: 'tool-result',
            timestamp: Date.now(),
          },
        ],
        stepCount: 0,
        totalTokens: { input: 0, output: 0 },
      },
    } as unknown as AgentState;

    const assembler = new DefaultMessageAssembler();
    const messages = assembler.build(state, {
      systemPrompt: 'You are helpful.',
      model: 'test-model',
    });

    const toolResult = messages.find((m) => m.role === 'toolResult');
    expect(toolResult).toBeDefined();
    expect(toolResult!.isError).toBe(false);
  });
});
