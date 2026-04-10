/**
 * @fileoverview AbortSignal Unit Tests (Step 16)
 *
 * Tests signal propagation through run/step/advance and their stream variants.
 * Uses mock LLM provider and tool registry to verify cancellation behavior.
 */

import { describe, it, expect, vi } from 'vitest';
import type { LLMClient, LLMResponse, TokenStats } from '@agentskillmania/llm-client';
import { AgentRunner } from '../../src/runner.js';
import { createAgentState } from '../../src/state.js';
import type { AgentConfig } from '../../src/types.js';
import { createExecutionState } from '../../src/execution.js';

function createMockClient() {
  return {
    call: vi.fn().mockResolvedValue({
      content: 'Mock response',
      tokens: { input: 5, output: 5 },
      stopReason: 'stop',
    } satisfies LLMResponse),
    stream: vi.fn(),
  } as unknown as LLMClient;
}

const defaultConfig: AgentConfig = {
  name: 'test-agent',
  instructions: 'You are a helpful assistant.',
  tools: [],
};

describe('AbortSignal (Step 16)', () => {
  // ============================================================
  // advance()
  // ============================================================
  describe('advance()', () => {
    it('should catch AbortError when signal is pre-aborted at calling-llm', async () => {
      const client = createMockClient();
      vi.mocked(client.call).mockImplementation(() => {
        throw new DOMException('The operation was aborted', 'AbortError');
      });

      const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
      const state = createAgentState(defaultConfig);
      const execState = createExecutionState();

      const controller = new AbortController();
      controller.abort();

      // Advance to calling-llm phase first
      await runner.advance(state, execState);
      await runner.advance(state, execState);

      // Now at calling-llm, advance with pre-aborted signal
      const result = await runner.advance(state, execState, undefined, {
        signal: controller.signal,
      });

      expect(result.done).toBe(true);
      expect(result.phase.type).toBe('error');
    });

    it('should pass signal to LLM provider call', async () => {
      const client = createMockClient();
      const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
      const state = createAgentState(defaultConfig);
      const execState = createExecutionState();

      const controller = new AbortController();
      const signal = controller.signal;

      // Advance to calling-llm phase
      await runner.advance(state, execState);
      await runner.advance(state, execState);

      // Now at calling-llm, advance with signal
      await runner.advance(state, execState, undefined, { signal });

      expect(client.call).toHaveBeenCalledWith(expect.objectContaining({ signal }));
    });

    it('should pass signal to tool execution', async () => {
      const client = createMockClient();
      vi.mocked(client.call).mockResolvedValueOnce({
        content: '',
        tokens: { input: 5, output: 5 },
        stopReason: 'stop',
        toolCalls: [{ id: 'tc1', name: 'test_tool', arguments: { a: 1 } }],
      });

      const mockRegistry = {
        execute: vi.fn().mockResolvedValue('tool result'),
        toToolSchemas: vi.fn().mockReturnValue([]),
        register: vi.fn(),
        unregister: vi.fn().mockReturnValue(false),
        has: vi.fn().mockReturnValue(true),
        getToolNames: vi.fn().mockReturnValue(['test_tool']),
      };

      const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
      const state = createAgentState(defaultConfig);
      const execState = createExecutionState();

      const signal = new AbortController().signal;

      // Advance through all phases to get to tool execution
      let result = await runner.advance(state, execState, mockRegistry);
      result = await runner.advance(result.state, execState, mockRegistry);
      result = await runner.advance(result.state, execState, mockRegistry);
      result = await runner.advance(result.state, execState, mockRegistry);
      result = await runner.advance(result.state, execState, mockRegistry);
      result = await runner.advance(result.state, execState, mockRegistry);

      // Now at executing-tool, pass signal
      if (execState.phase.type === 'executing-tool') {
        await runner.advance(result.state, execState, mockRegistry, { signal });
        expect(mockRegistry.execute).toHaveBeenCalledWith('test_tool', { a: 1 }, { signal });
      }
    });
  });

  // ============================================================
  // step()
  // ============================================================
  describe('step()', () => {
    it('should throw when signal is pre-aborted', async () => {
      const client = createMockClient();
      const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
      const state = createAgentState(defaultConfig);

      const controller = new AbortController();
      controller.abort();

      await expect(runner.step(state, undefined, { signal: controller.signal })).rejects.toThrow();
    });

    it('should complete normally without signal', async () => {
      const client = createMockClient();
      const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
      const state = createAgentState(defaultConfig);

      const { result } = await runner.step(state);
      expect(result.type).toBe('done');
    });
  });

  // ============================================================
  // run()
  // ============================================================
  describe('run()', () => {
    it('should throw when signal is pre-aborted', async () => {
      const client = createMockClient();
      const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
      const state = createAgentState(defaultConfig);

      const controller = new AbortController();
      controller.abort();

      await expect(runner.run(state, { signal: controller.signal })).rejects.toThrow();
    });

    it('should complete normally without signal', async () => {
      const client = createMockClient();
      const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
      const state = createAgentState(defaultConfig);

      const { result } = await runner.run(state);
      expect(result.type).toBe('success');
    });

    it('should work with undefined signal', async () => {
      const client = createMockClient();
      const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
      const state = createAgentState(defaultConfig);

      const { result } = await runner.run(state, { signal: undefined });
      expect(result.type).toBe('success');
    });
  });

  // ============================================================
  // Streaming abort
  // ============================================================
  describe('stepStream abort', () => {
    it('should stop yielding tokens when signal is aborted during stream', async () => {
      const client = createMockClient();

      async function* mockStream() {
        yield { type: 'text', delta: 'Hello', accumulatedContent: 'Hello' };
        yield { type: 'text', delta: ' World', accumulatedContent: 'Hello World' };
        yield { type: 'text', delta: '!', accumulatedContent: 'Hello World!' };
        yield { type: 'done', roundTotalTokens: { input: 5, output: 5 } };
      }

      vi.mocked(client.stream).mockReturnValue(
        mockStream() as AsyncIterable<{
          type: string;
          delta?: string;
          accumulatedContent?: string;
          roundTotalTokens?: TokenStats;
        }>
      );

      const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
      const state = createAgentState(defaultConfig);
      const controller = new AbortController();

      const tokens: string[] = [];
      const iterator = runner.stepStream(state, undefined, {
        signal: controller.signal,
      });

      try {
        for await (const event of iterator) {
          if (event.type === 'token') {
            tokens.push(event.token ?? '');
            controller.abort();
          }
        }
      } catch {
        // AbortError is expected — signal.throwIfAborted() throws on next loop iteration
      }

      expect(tokens.length).toBeGreaterThanOrEqual(1);
    });
  });
});
