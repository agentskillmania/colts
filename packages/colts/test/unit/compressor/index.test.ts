/**
 * @fileoverview DefaultContextCompressor Unit Tests
 *
 * Coverage: constructor, shouldCompress (token-based + message-count fallback),
 * compress (prune → summarize → truncate pipeline), edge cases
 */

import { describe, it, expect, vi } from 'vitest';
import { DefaultContextCompressor } from '../../../src/compressor/index.js';
import { createAgentState } from '../../../src/state/index.js';
import type { AgentState, ILLMProvider, CompressionConfig, Message } from '../../../src/types.js';

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

// Helper: create state with tool messages of specific sizes
function createStateWithToolMessages(toolSizes: number[]): AgentState {
  const state = createAgentState({
    name: 'test',
    instructions: 'test',
    tools: [],
  });

  // Create alternating user+tool messages, then a final user message
  let msgIndex = 0;
  for (const size of toolSizes) {
    // User message
    state.context.messages.push({
      role: 'user',
      content: `User query ${msgIndex}`,
      type: 'text',
      timestamp: Date.now(),
    });

    // Tool message with approximate target token count
    // Using ~4 chars per token as rough approximation
    const toolContent = 'x'.repeat(size * 4);
    state.context.messages.push({
      role: 'tool',
      content: toolContent,
      type: 'tool-result',
      toolName: 'test_tool',
      toolCallId: `tc_${msgIndex}`,
      timestamp: Date.now(),
      tokenCount: size,
    });

    msgIndex++;
  }

  // Final user message
  state.context.messages.push({
    role: 'user',
    content: 'Final question',
    type: 'text',
    timestamp: Date.now(),
  });

  return state;
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

  it('should accept contextWindowSize and pruneThreshold config', () => {
    const compressor = new DefaultContextCompressor({
      contextWindowSize: 128000,
      pruneThreshold: 200,
    });
    expect(compressor).toBeInstanceOf(DefaultContextCompressor);
  });
});

// ============================================================
// shouldCompress (token-based triggering)
// ============================================================
describe('DefaultContextCompressor - shouldCompress (token-based)', () => {
  it('should trigger at 80% of contextWindowSize', () => {
    // contextWindowSize=1000, 80%=800
    const compressor = new DefaultContextCompressor({
      contextWindowSize: 1000,
      threshold: 100, // message count fallback
    });
    const state = createStateWithMessages(10);

    // Set up messages with ~100 tokens each
    state.context.messages.forEach((msg) => {
      msg.content = 'x'.repeat(400); // ~100 tokens
      msg.tokenCount = 100;
    });

    // 10 messages * 100 tokens = 1000 tokens >= 800 (80%)
    expect(compressor.shouldCompress(state)).toBe(true);
  });

  it('should not trigger below 80% of contextWindowSize', () => {
    // contextWindowSize=1000, 80%=800
    const compressor = new DefaultContextCompressor({
      contextWindowSize: 1000,
      threshold: 100,
    });
    const state = createStateWithMessages(5);

    // Set up messages with ~100 tokens each
    state.context.messages.forEach((msg) => {
      msg.content = 'x'.repeat(400);
      msg.tokenCount = 100;
    });

    // 5 messages * 100 tokens = 500 tokens < 800 (80%)
    expect(compressor.shouldCompress(state)).toBe(false);
  });

  it('should include summary tokens when estimating effective tokens', () => {
    const compressor = new DefaultContextCompressor({
      contextWindowSize: 1000,
      threshold: 100,
    });
    const state = createStateWithMessages(5);

    // Set up messages with ~100 tokens each
    state.context.messages.forEach((msg) => {
      msg.content = 'x'.repeat(400);
      msg.tokenCount = 100;
    });

    // Add existing compression with 300-token summary
    state.context.compression = {
      summary: 'x'.repeat(1200), // ~300 tokens
      anchor: 0,
      summaryTokenCount: 300,
    };

    // 5 messages * 100 + 300 summary = 800 tokens >= 800 (80%)
    expect(compressor.shouldCompress(state)).toBe(true);
  });

  it('should only count tokens from anchor onwards', () => {
    const compressor = new DefaultContextCompressor({
      contextWindowSize: 1000,
      threshold: 100,
    });
    const state = createStateWithMessages(10);

    // Set up messages with ~100 tokens each
    state.context.messages.forEach((msg) => {
      msg.content = 'x'.repeat(400);
      msg.tokenCount = 100;
    });

    // Set anchor at 5 (only count messages[5..9])
    state.context.compression = {
      summary: 'x'.repeat(400), // ~100 tokens
      anchor: 5,
      summaryTokenCount: 100,
    };

    // 5 messages * 100 + 100 summary = 600 tokens < 800 (80%)
    expect(compressor.shouldCompress(state)).toBe(false);
  });
});

// ============================================================
// shouldCompress (message-count fallback)
// ============================================================
describe('DefaultContextCompressor - shouldCompress (message-count fallback)', () => {
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
// compress - prune step
// ============================================================
describe('DefaultContextCompressor - compress (prune)', () => {
  it('should stub out tool outputs over threshold', async () => {
    const compressor = new DefaultContextCompressor({
      strategy: 'truncate',
      pruneThreshold: 100,
      keepRecent: 2,
    });

    // Create state with tool messages of varying sizes
    const state = createStateWithToolMessages([50, 150, 200]);

    const result = await compressor.compress(state);

    // Should have 2 pruned messages (150 and 200 token tools)
    expect(result.prunedMessages).toHaveLength(2);
    expect(result.prunedMessages?.[0].newContent).toContain('150 tokens, pruned');
    expect(result.prunedMessages?.[1].newContent).toContain('200 tokens, pruned');
  });

  it('should not prune tool outputs below threshold', async () => {
    const compressor = new DefaultContextCompressor({
      strategy: 'truncate',
      pruneThreshold: 200,
      keepRecent: 2,
    });

    // Create state with tool messages below threshold
    const state = createStateWithToolMessages([50, 100, 150]);

    const result = await compressor.compress(state);

    // Should have no pruned messages
    expect(result.prunedMessages).toHaveLength(0);
  });

  it('should skip already-pruned stubs', async () => {
    const compressor = new DefaultContextCompressor({
      strategy: 'truncate',
      pruneThreshold: 100,
      keepRecent: 2,
    });

    const state = createStateWithToolMessages([150]);

    // Manually mark the tool message as already pruned
    state.context.messages[1].content = '[Tool result for test_tool: 150 tokens, pruned]';

    const result = await compressor.compress(state);

    // Should skip the already-pruned message
    expect(result.prunedMessages).toHaveLength(0);
  });
});

// ============================================================
// compress - structured summarize
// ============================================================
describe('DefaultContextCompressor - compress (structured summarize)', () => {
  it('should call LLM with structured prompt', async () => {
    const llm = createMockLLMProvider(
      '## Key Findings\nFound the bug in line 42\n\n## Decisions & Rationale\nDecided to refactor\n\n## User Preferences'
    );
    const compressor = new DefaultContextCompressor(
      { strategy: 'summarize', threshold: 10, keepRecent: 3 },
      llm,
      'gpt-4'
    );
    const state = createStateWithMessages(10);

    await compressor.compress(state);

    const callArgs = (llm.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const prompt = callArgs.messages[0].content as string;

    // Verify structured format is in prompt
    expect(prompt).toContain('## Key Findings');
    expect(prompt).toContain('## Decisions & Rationale');
    expect(prompt).toContain('## User Preferences');
  });

  it('should include previous summary on re-compress', async () => {
    const llm = createMockLLMProvider('Updated summary');
    const compressor = new DefaultContextCompressor(
      { strategy: 'summarize', threshold: 5, keepRecent: 2 },
      llm,
      'gpt-4'
    );
    const state = createStateWithCompression(
      10,
      5,
      '## Key Findings\nPrevious finding\n\n## Decisions & Rationale\nPrevious decision\n\n## User Preferences'
    );

    await compressor.compress(state);

    const callArgs = (llm.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const prompt = callArgs.messages[0].content as string;

    expect(prompt).toContain('Previous context:');
    expect(prompt).toContain('Previous finding');
    expect(prompt).toContain('Preserve ALL key points');
  });

  it('should prefer summaryProvider over llmProvider', async () => {
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

    await compressor.compress(state);

    expect(summaryLLM.call).toHaveBeenCalledOnce();
    expect(mainLLM.call).not.toHaveBeenCalled();
  });
});

// ============================================================
// compress - truncate step
// ============================================================
describe('DefaultContextCompressor - compress (truncate)', () => {
  it('should anchor for last N messages', async () => {
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
// compress - edge cases
// ============================================================
describe('DefaultContextCompressor - compress edge cases', () => {
  it('should handle nothing to compress', async () => {
    const compressor = new DefaultContextCompressor({
      strategy: 'truncate',
      threshold: 10,
      keepRecent: 20,
    });
    const state = createStateWithMessages(5);

    const result = await compressor.compress(state);
    // keepRecent > message count → anchor = max(0, 5-20) = 0
    // anchor <= existingAnchor (0) → return existing
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

    const result = await compressor.compress(state);
    // anchor = max(10, 20-100) = max(10, -80) = 10
    // 10 <= 10 → return existing
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

    const result = await compressor.compress(state);
    // anchor = max(8, 20-5) = max(8, 15) = 15
    expect(result.anchor).toBe(15);
    expect(result.summary).toBe('');
  });

  it('should handle summarize strategy with existing anchor', async () => {
    const llm = createMockLLMProvider('New summary');
    const compressor = new DefaultContextCompressor(
      { strategy: 'summarize', threshold: 10, keepRecent: 5 },
      llm,
      'gpt-4'
    );
    const state = createStateWithCompression(20, 8, 'Old summary');

    const result = await compressor.compress(state);
    // anchor = max(8, 20-5) = 15
    expect(result.anchor).toBe(15);
    expect(result.summary).toBe('New summary');

    // Verify LLM received previous summary
    const callArgs = (llm.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const prompt = callArgs.messages[0].content as string;
    expect(prompt).toContain('Old summary');
  });
});

// ============================================================
// compressState - batch state update
// ============================================================
describe('compressState - batch state update', () => {
  it('should apply prunedMessages and compression metadata in one update', async () => {
    const { compressState } = await import('../../../src/runner/compression.js');
    const compressor = new DefaultContextCompressor({
      strategy: 'truncate',
      threshold: 5,
      keepRecent: 2,
      pruneThreshold: 50,
    });

    // Create state with tool messages (using the createStateWithToolMessages helper if it exists, or create inline)
    const state = createAgentState({
      name: 'test',
      instructions: 'test',
      tools: [],
    });
    // user, tool(200 tokens), user, tool(30 tokens), user = 5 messages
    state.context.messages.push(
      { role: 'user', content: 'Q1', type: 'text', timestamp: Date.now() },
      {
        role: 'tool',
        content: 'x '.repeat(200).trim(),
        type: 'tool-result',
        toolName: 'big_tool',
        toolCallId: 'tc1',
        timestamp: Date.now(),
      },
      { role: 'user', content: 'Q2', type: 'text', timestamp: Date.now() },
      {
        role: 'tool',
        content: 'small result',
        type: 'tool-result',
        toolName: 'small_tool',
        toolCallId: 'tc2',
        timestamp: Date.now(),
      },
      { role: 'user', content: 'Final', type: 'text', timestamp: Date.now() }
    );
    const originalContent = state.context.messages[1].content;

    const newState = await compressState(compressor, state);

    // Pruned message should have new content
    expect(newState.context.messages[1].content).not.toBe(originalContent);
    expect(newState.context.messages[1].content).toContain('pruned');
    expect(typeof newState.context.messages[1].tokenCount).toBe('number');
    expect(newState.context.messages[1].tokenCount!).toBeLessThan(200);

    // Compression metadata should be set
    expect(newState.context.compression).toEqual(expect.any(Object));
    expect(newState.context.compression!.anchor).toBeGreaterThan(0);
  });

  it('should not modify original state', async () => {
    const { compressState } = await import('../../../src/runner/compression.js');
    const compressor = new DefaultContextCompressor({
      strategy: 'truncate',
      threshold: 5,
      keepRecent: 2,
      pruneThreshold: 50,
    });

    const state = createAgentState({
      name: 'test',
      instructions: 'test',
      tools: [],
    });
    state.context.messages.push(
      { role: 'user', content: 'Q1', type: 'text', timestamp: Date.now() },
      {
        role: 'tool',
        content: 'x '.repeat(200).trim(),
        type: 'tool-result',
        toolName: 'tool1',
        toolCallId: 'tc1',
        timestamp: Date.now(),
      },
      { role: 'user', content: 'Q2', type: 'text', timestamp: Date.now() },
      {
        role: 'tool',
        content: 'small',
        type: 'tool-result',
        toolName: 'tool2',
        toolCallId: 'tc2',
        timestamp: Date.now(),
      },
      { role: 'user', content: 'Final', type: 'text', timestamp: Date.now() }
    );
    const originalContent = state.context.messages[1].content;

    await compressState(compressor, state);

    // Original state should be unchanged (Immer immutability)
    expect(state.context.messages[1].content).toBe(originalContent);
    expect(state.context.compression).toBeUndefined();
  });
});
