/**
 * @fileoverview DefaultContextCompressor Unit Tests
 *
 * Coverage: constructor, shouldCompress, compress (all 4 strategies),
 * generateSummary, edge cases
 */

import { describe, it, expect, vi } from 'vitest';
import { DefaultContextCompressor } from '../../../src/compressor/index.js';
import { createAgentState } from '../../../src/state/index.js';
import type { AgentState, ILLMProvider, CompressionConfig } from '../../../src/types.js';

// Helper: create an AgentState with a specified number of messages
function createStateWithMessages(count: number): AgentState {
  const state = createAgentState({
    name: 'test',
    instructions: 'test',
    tools: [],
  });

  // Directly manipulate state.context.messages
  for (let i = 0; i < count; i++) {
    state.context.messages.push({
      role: 'user',
      content: `Message ${i}`,
      type: 'text',
      timestamp: Date.now(),
    });
  }
  return state;
}

// Helper: create a state with compression metadata
function createStateWithCompression(
  messageCount: number,
  anchor: number,
  summary: string = 'Summary'
): AgentState {
  const state = createStateWithMessages(messageCount);
  state.context.compression = { summary, anchor };
  return state;
}

// Mock LLM Provider
function createMockLLMProvider(summaryText: string): ILLMProvider {
  return {
    call: vi.fn().mockResolvedValue({
      content: summaryText,
      tokens: { input: 10, output: 5 },
      stopReason: 'stop',
    }),
    stream: vi.fn(),
  };
}

// ============================================================
// Constructor
// ============================================================
describe('DefaultContextCompressor - Constructor', () => {
  it('should use default config values', () => {
    const compressor = new DefaultContextCompressor();
    const state = createStateWithMessages(49);
    expect(compressor.shouldCompress(state)).toBe(false);

    const state2 = createStateWithMessages(50);
    expect(compressor.shouldCompress(state2)).toBe(true);
  });

  it('should accept custom config', () => {
    const compressor = new DefaultContextCompressor({ threshold: 10 });
    const state = createStateWithMessages(9);
    expect(compressor.shouldCompress(state)).toBe(false);

    const state2 = createStateWithMessages(10);
    expect(compressor.shouldCompress(state2)).toBe(true);
  });

  it('should throw when summarize strategy used without LLM provider', () => {
    expect(() => new DefaultContextCompressor({ strategy: 'summarize' })).toThrow(
      "Strategy 'summarize' requires an LLM provider"
    );
  });

  it('should not throw for truncate strategy without LLM provider', () => {
    expect(() => new DefaultContextCompressor({ strategy: 'truncate' })).not.toThrow();
  });

  it('should accept summarize strategy with LLM provider', () => {
    const llm = createMockLLMProvider('summary');
    expect(
      () => new DefaultContextCompressor({ strategy: 'summarize' }, llm, 'gpt-4')
    ).not.toThrow();
  });

  it('should accept summarize strategy with summaryProvider instead of llmProvider', () => {
    const summaryLLM = createMockLLMProvider('summary');
    expect(
      () =>
        new DefaultContextCompressor(
          { strategy: 'summarize', summaryProvider: summaryLLM, summaryModel: 'cheap-model' },
          undefined,
          undefined
        )
    ).not.toThrow();
  });

  it('should prefer summaryProvider over llmProvider for summarization', async () => {
    const mainLLM = createMockLLMProvider('main summary');
    const summaryLLM = createMockLLMProvider('dedicated summary');
    const compressor = new DefaultContextCompressor(
      {
        strategy: 'summarize',
        threshold: 10,
        keepRecent: 3,
        summaryProvider: summaryLLM,
        summaryModel: 'summary-model',
      },
      mainLLM,
      'main-model'
    );
    const state = createStateWithMessages(10);

    const result = await compressor.compress(state);
    expect(result.summary).toBe('dedicated summary');
    expect(summaryLLM.call).toHaveBeenCalledOnce();
    expect(mainLLM.call).not.toHaveBeenCalled();

    // Verify the dedicated model was used
    const callArgs = (summaryLLM.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.model).toBe('summary-model');
  });
});

// ============================================================
// shouldCompress
// ============================================================
describe('DefaultContextCompressor - shouldCompress', () => {
  it('should return false when below threshold', () => {
    const compressor = new DefaultContextCompressor({ threshold: 20 });
    const state = createStateWithMessages(19);
    expect(compressor.shouldCompress(state)).toBe(false);
  });

  it('should return true when at threshold', () => {
    const compressor = new DefaultContextCompressor({ threshold: 20 });
    const state = createStateWithMessages(20);
    expect(compressor.shouldCompress(state)).toBe(true);
  });

  it('should return true when above threshold', () => {
    const compressor = new DefaultContextCompressor({ threshold: 20 });
    const state = createStateWithMessages(30);
    expect(compressor.shouldCompress(state)).toBe(true);
  });

  it('should skip compression if already compressed and remaining below threshold', () => {
    // anchor=10, messages=25, threshold=50
    // remaining = 25 - 10 = 15 < 50 → skip
    const compressor = new DefaultContextCompressor({ threshold: 50 });
    const state = createStateWithCompression(25, 10);
    expect(compressor.shouldCompress(state)).toBe(false);
  });

  it('should compress again if remaining exceeds threshold', () => {
    // anchor=10, messages=70, threshold=50
    // remaining = 70 - 10 = 60 >= 50 → compress
    const compressor = new DefaultContextCompressor({ threshold: 50 });
    const state = createStateWithCompression(70, 10);
    expect(compressor.shouldCompress(state)).toBe(true);
  });
});

// ============================================================
// compress - truncate strategy
// ============================================================
describe('DefaultContextCompressor - compress (truncate)', () => {
  it('should return anchor for last N messages', async () => {
    const compressor = new DefaultContextCompressor({
      strategy: 'truncate',
      threshold: 10,
      keepRecent: 3,
    });
    const state = createStateWithMessages(10);

    const result = await compressor.compress(state);
    expect(result.anchor).toBe(7); // 10 - 3
    expect(result.summary).toBe('');
    expect(result.removedTokenCount).toBeGreaterThan(0);
    expect(result.compressedAt).toBeGreaterThan(0);
  });

  it('should use default keepRecent (10)', async () => {
    const compressor = new DefaultContextCompressor({
      strategy: 'truncate',
      threshold: 50,
    });
    const state = createStateWithMessages(50);

    const result = await compressor.compress(state);
    expect(result.anchor).toBe(40); // 50 - 10
    expect(result.summary).toBe('');
  });
});

// ============================================================
// compress - summarize strategy
// ============================================================
describe('DefaultContextCompressor - compress (summarize)', () => {
  it('should call LLM to generate summary', async () => {
    const llm = createMockLLMProvider('This is a summary');
    const compressor = new DefaultContextCompressor(
      { strategy: 'summarize', threshold: 10, keepRecent: 3 },
      llm,
      'gpt-4'
    );
    const state = createStateWithMessages(10);

    const result = await compressor.compress(state);
    expect(result.anchor).toBe(7);
    expect(result.summary).toBe('This is a summary');
    expect(result.summaryTokenCount).toBeGreaterThan(0);
    expect(result.removedTokenCount).toBeGreaterThan(0);
    expect(result.compressedAt).toBeGreaterThan(0);
    expect(llm.call).toHaveBeenCalledOnce();
  });

  it('should include previous summary in LLM prompt when re-compressing', async () => {
    const llm = createMockLLMProvider('Updated summary');
    const compressor = new DefaultContextCompressor(
      { strategy: 'summarize', threshold: 5, keepRecent: 2 },
      llm,
      'gpt-4'
    );
    const state = createStateWithCompression(10, 5, 'Old summary');

    const result = await compressor.compress(state);
    expect(result.anchor).toBe(8); // max(5, 10-2) = 8
    expect(result.summary).toBe('Updated summary');

    // Verify LLM was called with previous summary
    const callArgs = (llm.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const prompt = callArgs.messages[0].content as string;
    expect(prompt).toContain('Old summary');
  });

  it('should throw at construction when LLM provider is missing', () => {
    expect(() => new DefaultContextCompressor({ strategy: 'summarize', threshold: 5 })).toThrow(
      'requires an LLM provider'
    );
  });

  it('should use summaryModel when provided', async () => {
    const llm = createMockLLMProvider('Model-specific summary');
    const compressor = new DefaultContextCompressor(
      { strategy: 'summarize', threshold: 10, keepRecent: 3, summaryModel: 'custom-model' },
      llm,
      'gpt-4'
    );
    const state = createStateWithMessages(10);

    const result = await compressor.compress(state);
    expect(result.summary).toBe('Model-specific summary');

    const callArgs = (llm.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.model).toBe('custom-model');
  });
});

// ============================================================
// compress - edge cases
// ============================================================
describe('DefaultContextCompressor - compress edge cases', () => {
  it('should return existing anchor when nothing to compress', async () => {
    const compressor = new DefaultContextCompressor({
      strategy: 'truncate',
      threshold: 10,
      keepRecent: 20,
    });
    // keepRecent > message count → anchor = max(0, 5 - 20) = 0
    // But existing anchor might be 0 too → nothing to compress
    const state = createStateWithMessages(5);

    const result = await compressor.compress(state);
    // anchor = max(0, 5-20) = 0, existingAnchor = 0
    // anchor <= existingAnchor → return existing
    expect(result.anchor).toBe(0);
    expect(result.summary).toBe('');
  });

  it('should return existing summary when anchor unchanged', async () => {
    const compressor = new DefaultContextCompressor({
      strategy: 'truncate',
      threshold: 10,
      keepRecent: 100,
    });
    const state = createStateWithCompression(20, 10, 'Existing summary');

    // anchor = max(10, 20-100) = max(10, -80) = 10
    // 10 <= 10 → return existing
    const result = await compressor.compress(state);
    expect(result.anchor).toBe(10);
    expect(result.summary).toBe('Existing summary');
  });

  it('should respect existing anchor when computing new anchor', async () => {
    const compressor = new DefaultContextCompressor({
      strategy: 'truncate',
      threshold: 10,
      keepRecent: 5,
    });
    const state = createStateWithCompression(20, 8, 'Summary');

    // anchor = max(8, 20-5) = max(8, 15) = 15
    const result = await compressor.compress(state);
    expect(result.anchor).toBe(15);
    expect(result.summary).toBe('');
  });

  it('should use truncate as default strategy when strategy is undefined', async () => {
    const compressor = new DefaultContextCompressor({
      threshold: 5,
      keepRecent: 2,
    });
    const state = createStateWithMessages(8);

    const result = await compressor.compress(state);
    expect(result.anchor).toBe(6);
    expect(result.summary).toBe('');
  });
});

// ============================================================
// generateSummary (indirect through compress)
// ============================================================
describe('DefaultContextCompressor - generateSummary', () => {
  it('should format messages correctly in summary prompt', async () => {
    const llm = createMockLLMProvider('Summary');
    const compressor = new DefaultContextCompressor(
      { strategy: 'summarize', threshold: 5, keepRecent: 1 },
      llm,
      'gpt-4'
    );

    const state = createAgentState({
      name: 'test',
      instructions: 'test',
      tools: [],
    });
    // 4 messages, keepRecent=1 → anchor=3 → compress messages[0..2]
    state.context.messages.push(
      { role: 'user', content: 'Hello', type: 'text' },
      { role: 'assistant', content: 'Hi there', type: 'text' },
      { role: 'tool', content: 'Result: 42', type: 'tool-result' },
      { role: 'user', content: 'Follow up', type: 'text' }
    );

    await compressor.compress(state);

    const callArgs = (llm.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const prompt = callArgs.messages[0].content as string;

    // messages[0..2] are compressed, containing user, assistant, tool
    expect(prompt).toContain('User: Hello');
    expect(prompt).toContain('Assistant: Hi there');
    expect(prompt).toContain('Tool: Result: 42');
    expect(prompt).toContain('Summarize the following conversation');
    // messages[3] is the keepRecent part, not included in summary
    expect(prompt).not.toContain('Follow up');
  });

  it('should include previous summary when re-summarizing', async () => {
    const llm = createMockLLMProvider('Updated');
    const compressor = new DefaultContextCompressor(
      { strategy: 'summarize', threshold: 3, keepRecent: 1 },
      llm,
      'gpt-4'
    );

    const state = createAgentState({
      name: 'test',
      instructions: 'test',
      tools: [],
    });
    state.context.messages.push(
      { role: 'user', content: 'Q1', type: 'text' },
      { role: 'assistant', content: 'A1', type: 'text' },
      { role: 'user', content: 'Q2', type: 'text' },
      { role: 'assistant', content: 'A2', type: 'text' }
    );
    state.context.compression = { summary: 'Previous summary', anchor: 2 };

    await compressor.compress(state);

    const callArgs = (llm.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const prompt = callArgs.messages[0].content as string;
    expect(prompt).toContain('Previous summary');
    expect(prompt).toContain('updated concise summary');
  });
});

// ============================================================
// Integration with different message types
// ============================================================
describe('DefaultContextCompressor - message type formatting', () => {
  it('should handle all message roles in summary generation', async () => {
    const llm = createMockLLMProvider('All types summary');
    const compressor = new DefaultContextCompressor(
      { strategy: 'summarize', threshold: 3, keepRecent: 1 },
      llm,
      'gpt-4'
    );

    const state = createAgentState({
      name: 'test',
      instructions: 'test',
      tools: [],
    });

    state.context.messages.push(
      { role: 'user', content: 'User message', type: 'text' },
      { role: 'assistant', content: 'Thought process', type: 'thought' },
      { role: 'assistant', content: 'Final answer', type: 'text' },
      { role: 'tool', content: 'Tool output', type: 'tool-result', toolCallId: 'tc1' },
      { role: 'user', content: 'Follow up', type: 'text' }
    );

    const result = await compressor.compress(state);
    expect(result.anchor).toBe(4); // 5 - 1

    const callArgs = (llm.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const prompt = callArgs.messages[0].content as string;
    // All roles should be represented in the prompt
    expect(prompt).toContain('User: User message');
    expect(prompt).toContain('Assistant: Thought process');
    expect(prompt).toContain('Assistant: Final answer');
    expect(prompt).toContain('Tool: Tool output');
  });
});
