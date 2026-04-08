/**
 * AgentRunner unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMClient, LLMResponse, TokenStats } from '@agentskillmania/llm-client';
import { AgentRunner } from '../../src/runner.js';
import { createAgentState } from '../../src/state.js';
import type { AgentConfig } from '../../src/types.js';

describe('AgentRunner', () => {
  // Mock LLMClient
  const createMockClient = () => {
    return {
      call: vi.fn(),
      stream: vi.fn(),
    } as unknown as LLMClient;
  };

  const defaultConfig: AgentConfig = {
    name: 'test-agent',
    instructions: 'You are a helpful assistant.',
    tools: [],
  };

  describe('constructor', () => {
    it('should create AgentRunner instance with required options', () => {
      const client = createMockClient();
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      expect(runner).toBeDefined();
    });

    it('should create AgentRunner with all options', () => {
      const client = createMockClient();
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        systemPrompt: 'Custom system prompt',
        priority: 1,
        requestTimeout: 30000,
      });

      expect(runner).toBeDefined();
    });
  });

  describe('chat', () => {
    it('should call LLM and return response with updated state', async () => {
      const client = createMockClient();
      const mockResponse: LLMResponse = {
        content: 'Hello! How can I help you?',
        tokens: { input: 10, output: 8 },
        stopReason: 'stop',
      };
      vi.mocked(client.call).mockResolvedValue(mockResponse);

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      const state = createAgentState(defaultConfig);
      const result = await runner.chat(state, 'Hi there!');

      // Verify LLM was called with messages containing instructions
      expect(client.call).toHaveBeenCalledWith({
        model: 'gpt-4',
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user' }),
          expect.objectContaining({ role: 'user', content: 'Hi there!' }),
        ]),
        priority: 0,
        requestTimeout: undefined,
      });

      // Verify instructions are in first user message
      const callArg = vi.mocked(client.call).mock.calls[0][0];
      const firstUserMsg = callArg.messages.find((m: { role: string }) => m.role === 'user');
      expect(firstUserMsg?.content).toContain('[System Instructions]');
      expect(firstUserMsg?.content).toContain('You are a helpful assistant');

      // Verify result
      expect(result.response).toBe('Hello! How can I help you?');
      expect(result.tokens).toEqual({ input: 10, output: 8 });
      expect(result.stopReason).toBe('stop');

      // Verify state updated
      expect(result.state.context.messages).toHaveLength(2);
      expect(result.state.context.messages[0].role).toBe('user');
      expect(result.state.context.messages[1].role).toBe('assistant');
      expect(result.state.context.stepCount).toBe(1);
    });

    it('should include system prompt if provided', async () => {
      const client = createMockClient();
      vi.mocked(client.call).mockResolvedValue({
        content: 'Response',
        tokens: { input: 5, output: 5 },
        stopReason: 'stop',
      });

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        systemPrompt: 'Custom system instruction',
      });

      const state = createAgentState(defaultConfig);
      await runner.chat(state, 'Hello');

      const callArg = vi.mocked(client.call).mock.calls[0][0];
      const userMessages = callArg.messages.filter((m: { role: string }) => m.role === 'user');
      expect(userMessages[0].content).toContain('Custom system instruction');
    });

    it('should preserve conversation history', async () => {
      const client = createMockClient();
      vi.mocked(client.call)
        .mockResolvedValueOnce({
          content: 'First response',
          tokens: { input: 5, output: 5 },
          stopReason: 'stop',
        })
        .mockResolvedValueOnce({
          content: 'Second response',
          tokens: { input: 10, output: 5 },
          stopReason: 'stop',
        });

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      let state = createAgentState(defaultConfig);

      // First turn
      const result1 = await runner.chat(state, 'Message 1');
      state = result1.state;

      // Second turn
      const result2 = await runner.chat(state, 'Message 2');
      state = result2.state;

      // Verify conversation history
      expect(state.context.messages).toHaveLength(4);
      expect(state.context.messages[0].content).toBe('Message 1');
      expect(state.context.messages[1].content).toBe('First response');
      expect(state.context.messages[2].content).toBe('Message 2');
      expect(state.context.messages[3].content).toBe('Second response');
      expect(state.context.stepCount).toBe(2);
    });

    it('should pass priority and timeout to LLM call', async () => {
      const client = createMockClient();
      vi.mocked(client.call).mockResolvedValue({
        content: 'Response',
        tokens: { input: 5, output: 5 },
        stopReason: 'stop',
      });

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        priority: 5,
        requestTimeout: 30000,
      });

      const state = createAgentState(defaultConfig);
      await runner.chat(state, 'Hello');

      expect(client.call).toHaveBeenCalledWith(
        expect.objectContaining({
          priority: 5,
          requestTimeout: 30000,
        })
      );
    });

    it('should not modify original state', async () => {
      const client = createMockClient();
      vi.mocked(client.call).mockResolvedValue({
        content: 'Response',
        tokens: { input: 5, output: 5 },
        stopReason: 'stop',
      });

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      const originalState = createAgentState(defaultConfig);
      const originalMessageCount = originalState.context.messages.length;

      await runner.chat(originalState, 'Hello');

      // Original state unchanged
      expect(originalState.context.messages).toHaveLength(originalMessageCount);
    });
  });

  describe('chatStream', () => {
    it('should stream text chunks and return final state', async () => {
      const client = createMockClient();

      // Mock async iterable for stream
      async function* mockStream() {
        yield { type: 'text', delta: 'Hello', accumulatedContent: 'Hello' };
        yield { type: 'text', delta: ' there', accumulatedContent: 'Hello there' };
        yield {
          type: 'done',
          accumulatedContent: 'Hello there',
          roundTotalTokens: { input: 5, output: 5 },
        };
      }

      vi.mocked(client.stream).mockReturnValue(
        mockStream() as AsyncIterable<{
          type: string;
          delta?: string;
          accumulatedContent?: string;
          roundTotalTokens?: TokenStats;
        }>
      );

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      const state = createAgentState(defaultConfig);
      const chunks: Array<{ type: string; delta?: string; state: unknown }> = [];

      for await (const chunk of runner.chatStream(state, 'Hi')) {
        chunks.push(chunk);
      }

      // Verify chunks
      expect(chunks).toHaveLength(3);
      expect(chunks[0].type).toBe('text');
      expect(chunks[0].delta).toBe('Hello');
      expect(chunks[1].type).toBe('text');
      expect(chunks[1].delta).toBe(' there');
      expect(chunks[2].type).toBe('done');

      // Verify final state has assistant message
      const finalChunk = chunks[2];
      expect(finalChunk.state).toBeDefined();
      if (
        finalChunk.state &&
        typeof finalChunk.state === 'object' &&
        'context' in finalChunk.state
      ) {
        const finalState = finalChunk.state as { context: { messages: Array<{ role: string }> } };
        expect(finalState.context.messages).toHaveLength(2);
        expect(finalState.context.messages[1].role).toBe('assistant');
      }
    });

    it('should handle stream errors', async () => {
      const client = createMockClient();

      async function* mockStream() {
        yield { type: 'text', delta: 'Partial', accumulatedContent: 'Partial' };
        yield { type: 'error', error: 'Stream interrupted' };
      }

      vi.mocked(client.stream).mockReturnValue(
        mockStream() as AsyncIterable<{
          type: string;
          delta?: string;
          accumulatedContent?: string;
          error?: string;
        }>
      );

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      const state = createAgentState(defaultConfig);
      const chunks = [];

      for await (const chunk of runner.chatStream(state, 'Hi')) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[1].type).toBe('error');
      expect(chunks[1].error).toBe('Stream interrupted');
    });

    it('should handle exceptions during streaming', async () => {
      const client = createMockClient();

      async function* mockStream() {
        yield { type: 'text', delta: 'Start', accumulatedContent: 'Start' };
        throw new Error('Network error');
      }

      vi.mocked(client.stream).mockReturnValue(
        mockStream() as AsyncIterable<{
          type: string;
          delta?: string;
          accumulatedContent?: string;
        }>
      );

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      const state = createAgentState(defaultConfig);
      const chunks = [];

      for await (const chunk of runner.chatStream(state, 'Hi')) {
        chunks.push(chunk);
      }

      // Should have text chunk and error chunk
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.type).toBe('error');
      expect(lastChunk.error).toContain('Network error');
    });

    it('should not modify original state during streaming', async () => {
      const client = createMockClient();

      async function* mockStream() {
        yield { type: 'text', delta: 'Response', accumulatedContent: 'Response' };
        yield {
          type: 'done',
          accumulatedContent: 'Response',
          roundTotalTokens: { input: 5, output: 5 },
        };
      }

      vi.mocked(client.stream).mockReturnValue(
        mockStream() as AsyncIterable<{
          type: string;
          delta?: string;
          accumulatedContent?: string;
          roundTotalTokens?: TokenStats;
        }>
      );

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      const originalState = createAgentState(defaultConfig);
      const originalMessageCount = originalState.context.messages.length;

      for await (const _ of runner.chatStream(originalState, 'Hello')) {
        // Consume stream
      }

      // Original state unchanged
      expect(originalState.context.messages).toHaveLength(originalMessageCount);
    });
  });

  describe('message building', () => {
    it('should filter out invisible messages from LLM context', async () => {
      const client = createMockClient();
      vi.mocked(client.call).mockResolvedValue({
        content: 'Response',
        tokens: { input: 5, output: 5 },
        stopReason: 'stop',
      });

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      // Create state with invisible assistant message
      let state = createAgentState(defaultConfig);
      state = {
        ...state,
        context: {
          ...state.context,
          messages: [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hidden thought', type: 'thought', visible: false },
            { role: 'assistant', content: 'Visible response', type: 'final', visible: true },
          ],
        },
      };

      await runner.chat(state, 'Next message');

      const callArg = vi.mocked(client.call).mock.calls[0][0];
      const userMsgs = callArg.messages.filter((m: { role: string }) => m.role === 'user');
      const assistantMsgs = callArg.messages.filter(
        (m: { role: string }) => m.role === 'assistant'
      );
      const assistantContents = assistantMsgs.map((m: { content: unknown }) =>
        Array.isArray(m.content) ? m.content[0]?.text : m.content
      );

      // Should include user messages
      expect(userMsgs.some((m: { content: string }) => m.content === 'Hello')).toBe(true);
      // Should include visible assistant message
      expect(assistantContents).toContain('Visible response');
      // Should NOT include invisible message
      expect(assistantContents).not.toContain('Hidden thought');
    });

    it('should include tool results in context', async () => {
      const client = createMockClient();
      vi.mocked(client.call).mockResolvedValue({
        content: 'Response',
        tokens: { input: 10, output: 5 },
        stopReason: 'stop',
      });

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      let state = createAgentState(defaultConfig);
      state = {
        ...state,
        context: {
          ...state.context,
          messages: [
            { role: 'user', content: 'Calculate' },
            { role: 'assistant', content: 'Action: calculate', type: 'action', visible: false },
            { role: 'tool', content: '42', toolCallId: 'calc-1' },
          ],
        },
      };

      await runner.chat(state, 'What is the result?');

      // Then: Tool result is included as toolResult message
      const callArg = vi.mocked(client.call).mock.calls[0][0];
      const toolMessages = callArg.messages.filter(
        (m: { role: string }) => m.role === 'toolResult'
      );
      expect(toolMessages).toHaveLength(1);
      expect(toolMessages[0]).toMatchObject({
        role: 'toolResult',
        toolCallId: 'calc-1',
      });
    });
  });
});
