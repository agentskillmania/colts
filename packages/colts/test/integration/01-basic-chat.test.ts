/**
 * @fileoverview User Story: Basic LLM Chat
 *
 * As a developer
 * I want to have conversations with an LLM through an Agent
 * So that I can build interactive applications with streaming support
 *
 * Acceptance Criteria:
 * 1. Can send a message and receive a complete response
 * 2. Can receive streaming responses for real-time display
 * 3. Conversation history is maintained across turns
 * 4. System prompts and instructions are properly included
 * 5. Invisible messages (thoughts) are filtered from LLM context
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMClient, LLMResponse, TokenStats } from '@agentskillmania/llm-client';
import { AgentRunner } from '../../src/runner.js';
import { createAgentState, addAssistantMessage } from '../../src/state.js';
import type { AgentConfig } from '../../src/types.js';

describe('User Story: Basic LLM Chat', () => {
  // Mock LLMClient factory
  const createMockClient = () => {
    return {
      call: vi.fn(),
      stream: vi.fn(),
    } as unknown as LLMClient;
  };

  const defaultConfig: AgentConfig = {
    name: 'chat-agent',
    instructions: 'You are a helpful assistant.',
    tools: [],
  };

  // Scenario 1: Basic blocking chat
  describe('Scenario 1: Send Message and Receive Complete Response', () => {
    it('should complete a simple greeting conversation', async () => {
      // Given: A configured AgentRunner
      const client = createMockClient();
      vi.mocked(client.call).mockResolvedValue({
        content: 'Hello! Nice to meet you. How can I help you today?',
        tokens: { input: 15, output: 12 },
        stopReason: 'stop',
      });

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      // When: User sends a greeting
      const state = createAgentState(defaultConfig);
      const result = await runner.chat(state, 'Hello!');

      // Then: Receive complete response
      expect(result.response).toBe('Hello! Nice to meet you. How can I help you today?');
      expect(result.tokens.input).toBeGreaterThan(0);
      expect(result.tokens.output).toBeGreaterThan(0);
      expect(result.stopReason).toBe('stop');

      // And: State is updated with both messages
      expect(result.state.context.messages).toHaveLength(2);
      expect(result.state.context.messages[0]).toMatchObject({
        role: 'user',
        content: 'Hello!',
      });
      expect(result.state.context.messages[1]).toMatchObject({
        role: 'assistant',
        content: 'Hello! Nice to meet you. How can I help you today?',
        type: 'final',
        visible: true,
      });
    });

    it('should answer a coding question', async () => {
      // Given: Runner ready for technical questions
      const client = createMockClient();
      vi.mocked(client.call).mockResolvedValue({
        content: 'To reverse a string in JavaScript, you can use: str.split("").reverse().join("")',
        tokens: { input: 20, output: 25 },
        stopReason: 'stop',
      });

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      // When: User asks a technical question
      const state = createAgentState({
        ...defaultConfig,
        instructions: 'You are a coding expert. Provide concise code examples.',
      });
      const result = await runner.chat(state, 'How do I reverse a string in JavaScript?');

      // Then: Receive code explanation
      expect(result.response).toContain('reverse');
      expect(result.response).toContain('split');

      // And: Instructions were passed to LLM
      const callArgs = vi.mocked(client.call).mock.calls[0][0];
      const userMessages = callArgs.messages.filter((m: { role: string }) => m.role === 'user');
      expect(userMessages[0].content).toContain('You are a coding expert');
    });
  });

  // Scenario 2: Streaming chat
  describe('Scenario 2: Receive Streaming Response for Real-Time Display', () => {
    it('should stream a poem word by word', async () => {
      // Given: A streaming-capable runner
      const client = createMockClient();

      async function* mockStream() {
        yield { type: 'text', delta: 'The', accumulatedContent: 'The' };
        yield { type: 'text', delta: ' quick', accumulatedContent: 'The quick' };
        yield { type: 'text', delta: ' brown', accumulatedContent: 'The quick brown' };
        yield { type: 'text', delta: ' fox', accumulatedContent: 'The quick brown fox' };
        yield {
          type: 'done',
          accumulatedContent: 'The quick brown fox',
          roundTotalTokens: { input: 10, output: 4 },
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

      // When: Request a streaming response
      const state = createAgentState(defaultConfig);
      const chunks = [];

      for await (const chunk of runner.chatStream(state, 'Say something')) {
        chunks.push(chunk);
      }

      // Then: Receive multiple text chunks
      const textChunks = chunks.filter((c) => c.type === 'text');
      expect(textChunks.length).toBe(4);

      // And: Accumulated content builds up
      expect(textChunks[0].accumulatedContent).toBe('The');
      expect(textChunks[1].accumulatedContent).toBe('The quick');
      expect(textChunks[3].accumulatedContent).toBe('The quick brown fox');

      // And: Final done chunk has complete state
      const doneChunk = chunks.find((c) => c.type === 'done');
      expect(doneChunk).toBeDefined();
      expect(doneChunk?.tokens).toEqual({ input: 10, output: 4 });
    });

    it('should allow real-time display of code generation', async () => {
      // Given: A coding assistant
      const client = createMockClient();

      const codeLines = [
        'function',
        ' fibonacci',
        '(n)',
        ' {',
        '\n  ',
        'if',
        ' (n',
        ' <=',
        ' 1)',
        ' return',
        ' n;',
        '\n  ',
        'return',
        ' fibonacci',
        '(n-1)',
        ' +',
        ' fibonacci',
        '(n-2);',
        '\n}',
      ];

      async function* mockStream() {
        let accumulated = '';
        for (const line of codeLines) {
          accumulated += line;
          yield { type: 'text', delta: line, accumulatedContent: accumulated };
        }
        yield {
          type: 'done',
          accumulatedContent: accumulated,
          roundTotalTokens: { input: 15, output: 50 },
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

      // When: Request code generation
      const state = createAgentState(defaultConfig);
      let displayedCode = '';

      for await (const chunk of runner.chatStream(state, 'Write a fibonacci function')) {
        if (chunk.type === 'text') {
          displayedCode += chunk.delta;
        }
      }

      // Then: Code is built up progressively
      expect(displayedCode).toContain('function fibonacci');
      expect(displayedCode).toContain('return fibonacci(n-1)');
    });
  });

  // Scenario 3: Multi-turn conversation
  describe('Scenario 3: Maintain Conversation History Across Turns', () => {
    it('should remember context from previous messages', async () => {
      // Given: A runner with conversation memory
      const client = createMockClient();

      vi.mocked(client.call)
        .mockResolvedValueOnce({
          content: 'Your name is Alice. Nice to meet you, Alice!',
          tokens: { input: 10, output: 12 },
          stopReason: 'stop',
        })
        .mockResolvedValueOnce({
          content: 'You just told me your name is Alice.',
          tokens: { input: 25, output: 10 },
          stopReason: 'stop',
        });

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      let state = createAgentState(defaultConfig);

      // When: First turn - introduce name
      const result1 = await runner.chat(state, 'My name is Alice.');
      state = result1.state;

      // When: Second turn - ask what was said
      const result2 = await runner.chat(state, 'What is my name?');
      state = result2.state;

      // Then: Response references previous context
      expect(result2.response).toContain('Alice');

      // And: Full conversation history preserved
      expect(state.context.messages).toHaveLength(4);
      expect(state.context.messages[0].content).toBe('My name is Alice.');
      expect(state.context.messages[2].content).toBe('What is my name?');
      expect(state.context.stepCount).toBe(2);
    });

    it('should accumulate messages over multiple turns', async () => {
      // Given: Mock that counts messages
      const client = createMockClient();
      const messageCounts: number[] = [];

      vi.mocked(client.call).mockImplementation(async (options) => {
        messageCounts.push(options.messages.length);
        return {
          content: `Received ${options.messages.length} messages`,
          tokens: { input: 5, output: 5 },
          stopReason: 'stop',
        };
      });

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      let state = createAgentState(defaultConfig);

      // Execute multiple turns
      for (let i = 0; i < 3; i++) {
        const result = await runner.chat(state, `Message ${i + 1}`);
        state = result.state;
      }

      // Then: Message count increases with each turn
      // Turn 1: system(user) + system(fake assistant) + instructions + user1 = 3
      // Turn 2: + assistant1 + user2 = 5
      // Turn 3: + assistant2 + user3 = 7
      expect(messageCounts).toEqual([3, 5, 7]);
    });
  });

  // Scenario 4: System configuration
  describe('Scenario 4: System Prompts and Instructions', () => {
    it('should combine runner system prompt with agent instructions', async () => {
      // Given: Runner with system prompt + Agent with instructions
      const client = createMockClient();
      vi.mocked(client.call).mockResolvedValue({
        content: 'Response',
        tokens: { input: 20, output: 5 },
        stopReason: 'stop',
      });

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        systemPrompt: 'You are a professional customer service agent.',
      });

      const state = createAgentState({
        name: 'support-agent',
        instructions: 'Be polite and helpful. Always thank the customer.',
        tools: [],
      });

      // When: Send a message
      await runner.chat(state, 'I need help');

      // Then: Both system prompts included in first user message
      const callArgs = vi.mocked(client.call).mock.calls[0][0];
      const firstUserMsg = callArgs.messages.find((m: { role: string }) => m.role === 'user');
      expect(firstUserMsg?.content).toContain('You are a professional customer service agent');
      expect(firstUserMsg?.content).toContain('Be polite and helpful');
    });
  });

  // Scenario 5: Invisible messages (thoughts)
  describe('Scenario 5: Filter Invisible Messages from LLM Context', () => {
    it('should not include thought messages in LLM context', async () => {
      // Given: State with internal thought and visible response
      const client = createMockClient();
      vi.mocked(client.call).mockResolvedValue({
        content: 'Final answer: 42',
        tokens: { input: 15, output: 5 },
        stopReason: 'stop',
      });

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      let state = createAgentState(defaultConfig);

      // Simulate a previous turn with thought
      state = addAssistantMessage(state, 'Let me think about this...', {
        type: 'thought',
        visible: false,
      });
      state = addAssistantMessage(state, 'The answer is 42', {
        type: 'final',
        visible: true,
      });

      // When: Send next message
      await runner.chat(state, 'Why is that the answer?');

      // Then: Thought not in LLM context, but visible message is
      const callArgs = vi.mocked(client.call).mock.calls[0][0];
      const assistantMsgs = callArgs.messages.filter(
        (m: { role: string }) => m.role === 'assistant'
      );
      const assistantContents = assistantMsgs.map((m: { content: unknown }) =>
        Array.isArray(m.content) ? m.content[0]?.text : m.content
      );

      expect(assistantContents).not.toContain('Let me think about this...');
      expect(assistantContents).toContain('The answer is 42');
    });

    it('should include tool results in context for the agent', async () => {
      // Given: State with tool execution history
      const client = createMockClient();
      vi.mocked(client.call).mockResolvedValue({
        content: 'Based on the weather data, it is sunny today.',
        tokens: { input: 25, output: 10 },
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
            { role: 'user', content: 'What is the weather?' },
            {
              role: 'assistant',
              content: 'weather_api({"city": "Beijing"})',
              type: 'action',
              visible: false,
            },
            {
              role: 'tool',
              content: '{"temp": 25, "condition": "sunny"}',
              toolCallId: 'weather-1',
            },
          ],
        },
      };

      // When: Ask follow-up question
      await runner.chat(state, 'Tell me more');

      // Then: Tool result is included in LLM context as toolResult
      const callArgs = vi.mocked(client.call).mock.calls[0][0];
      const toolMsgs = callArgs.messages.filter((m: { role: string }) => m.role === 'toolResult');
      expect(toolMsgs).toHaveLength(1);
      expect(toolMsgs[0]).toMatchObject({
        role: 'toolResult',
        toolCallId: 'weather-1',
      });
    });
  });

  // Scenario 6: Error handling
  describe('Scenario 6: Handle Errors Gracefully', () => {
    it('should propagate LLM errors in chat', async () => {
      // Given: LLM that throws error
      const client = createMockClient();
      vi.mocked(client.call).mockRejectedValue(new Error('Rate limit exceeded'));

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      const state = createAgentState(defaultConfig);

      // When/Then: Error should propagate
      await expect(runner.chat(state, 'Hello')).rejects.toThrow('Rate limit exceeded');
    });

    it('should yield error chunk on stream failure', async () => {
      // Given: LLM stream that errors
      const client = createMockClient();

      async function* mockStream() {
        yield { type: 'text', delta: 'Partial', accumulatedContent: 'Partial' };
        throw new Error('Connection reset');
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

      // When: Stream with error
      for await (const chunk of runner.chatStream(state, 'Hello')) {
        chunks.push(chunk);
      }

      // Then: Error chunk yielded
      const errorChunk = chunks.find((c) => c.type === 'error');
      expect(errorChunk).toBeDefined();
      expect(errorChunk?.error).toContain('Connection reset');
    });
  });
});
