/**
 * AgentRunner unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMClient, LLMResponse, TokenStats } from '@agentskillmania/llm-client';
import { AgentRunner } from '../../src/runner.js';
import { createAgentState, addUserMessage, addAssistantMessage } from '../../src/state.js';
import type { AgentConfig, IContextCompressor, CompressResult } from '../../src/types.js';
import type { ISkillProvider, SkillManifest } from '../../src/skills/types.js';
import type { SubAgentConfig } from '../../src/subagent/types.js';
import { FilesystemSkillProvider } from '../../src/skills/filesystem-provider.js';

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

    it('should create AgentRunner with optional options', () => {
      const client = createMockClient();
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        systemPrompt: 'Custom system prompt',
        requestTimeout: 30000,
      });

      expect(runner).toBeDefined();
    });

    it('should throw ConfigurationError when both llmClient and llm are provided', () => {
      const client = createMockClient();

      expect(() => {
        new AgentRunner({
          model: 'gpt-4',
          llmClient: client,
          llm: {
            apiKey: 'test-key',
          },
        });
      }).toThrow();

      expect(() => {
        new AgentRunner({
          model: 'gpt-4',
          llmClient: client,
          llm: {
            apiKey: 'test-key',
          },
        });
      }).toThrow('Cannot specify both llmClient and llm');
    });

    it('should throw ConfigurationError when neither llmClient nor llm is provided', () => {
      expect(() => {
        new AgentRunner({
          model: 'gpt-4',
        } as any);
      }).toThrow();

      expect(() => {
        new AgentRunner({
          model: 'gpt-4',
        } as any);
      }).toThrow('Must specify either llmClient or llm');
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
        requestTimeout: 30000,
      });

      const state = createAgentState(defaultConfig);
      // Pass priority in chat options
      await runner.chat(state, 'Hello', { priority: 5 });

      expect(client.call).toHaveBeenCalledWith(
        expect.objectContaining({
          priority: 5,
          requestTimeout: 30000,
        })
      );
    });

    it('should use default priority 0 when not specified', async () => {
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

      const state = createAgentState(defaultConfig);
      await runner.chat(state, 'Hello');

      expect(client.call).toHaveBeenCalledWith(
        expect.objectContaining({
          priority: 0,
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

    it('should accept priority option in chatStream', async () => {
      const client = createMockClient();

      async function* mockStream() {
        yield {
          type: 'done',
          accumulatedContent: 'Response',
          roundTotalTokens: { input: 5, output: 5 },
        };
      }

      vi.mocked(client.stream).mockReturnValue(
        mockStream() as AsyncIterable<{
          type: string;
          accumulatedContent?: string;
          roundTotalTokens?: TokenStats;
        }>
      );

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      const state = createAgentState(defaultConfig);
      // Consume the stream
      for await (const _ of runner.chatStream(state, 'Hello', { priority: 10 })) {
        // Consume
      }

      // Verify priority was passed
      expect(client.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          priority: 10,
        })
      );
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

  // ============================================================
  // Compression integration in Runner
  // ============================================================
  describe('compression', () => {
    it('should throw when calling compress() without compressor configured', async () => {
      const client = createMockClient();
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      const state = createAgentState(defaultConfig);
      await expect(runner.compress(state)).rejects.toThrow('No compressor configured');
    });

    it('should compress state via compress() method', async () => {
      const client = createMockClient();
      const mockCompressor: IContextCompressor = {
        shouldCompress: vi.fn().mockReturnValue(true),
        compress: vi.fn().mockResolvedValue({
          summary: 'Summary of conversation',
          anchor: 5,
        } satisfies CompressResult),
      };

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        compressor: mockCompressor,
      });

      // Create state with messages
      let state = createAgentState(defaultConfig);
      for (let i = 0; i < 10; i++) {
        state = addUserMessage(state, `Message ${i}`);
      }

      const compressed = await runner.compress(state);

      expect(compressed.context.compression).toEqual({
        summary: 'Summary of conversation',
        anchor: 5,
      });
      // Original state unchanged
      expect(state.context.compression).toBeUndefined();
    });

    it('should auto-compress during step() when threshold exceeded', async () => {
      const client = createMockClient();
      vi.mocked(client.call).mockResolvedValue({
        content: 'Final answer',
        tokens: { input: 5, output: 5 },
        stopReason: 'stop',
      });

      const mockCompressor: IContextCompressor = {
        shouldCompress: vi.fn().mockReturnValue(true),
        compress: vi.fn().mockResolvedValue({
          summary: 'Compressed summary',
          anchor: 2,
        } satisfies CompressResult),
      };

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        compressor: mockCompressor,
      });

      const state = createAgentState(defaultConfig);
      const { state: finalState } = await runner.step(state);

      // shouldCompress should be called after step completes
      expect(mockCompressor.shouldCompress).toHaveBeenCalled();
      // If compression is needed, compress should also be called
      if (mockCompressor.shouldCompress({ ...state, context: { ...state.context } })) {
        expect(mockCompressor.compress).toHaveBeenCalled();
      }
    });

    it('should not compress when shouldCompress returns false', async () => {
      const client = createMockClient();
      vi.mocked(client.call).mockResolvedValue({
        content: 'Final answer',
        tokens: { input: 5, output: 5 },
        stopReason: 'stop',
      });

      const mockCompressor: IContextCompressor = {
        shouldCompress: vi.fn().mockReturnValue(false),
        compress: vi.fn(),
      };

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        compressor: mockCompressor,
      });

      const state = createAgentState(defaultConfig);
      const { state: finalState } = await runner.step(state);

      expect(mockCompressor.shouldCompress).toHaveBeenCalled();
      expect(mockCompressor.compress).not.toHaveBeenCalled();
      expect(finalState.context.compression).toBeUndefined();
    });

    it('should build messages with compression summary', async () => {
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

      // Create state with compression metadata
      let state = createAgentState(defaultConfig);
      state = addUserMessage(state, 'Old message 1');
      state = addAssistantMessage(state, 'Old response 1', { type: 'final', visible: true });
      state = addUserMessage(state, 'Old message 2');
      state = addAssistantMessage(state, 'Old response 2', { type: 'final', visible: true });
      state = addUserMessage(state, 'Recent message');
      state = addAssistantMessage(state, 'Recent response', { type: 'final', visible: true });

      // Set compression: anchor=4, meaning messages[0..3] are compressed
      state = {
        ...state,
        context: {
          ...state.context,
          compression: {
            summary: 'Previous conversation about topic X',
            anchor: 4,
          },
        },
      };

      await runner.chat(state, 'Follow up');

      const callArg = vi.mocked(client.call).mock.calls[0][0];
      const allContent = JSON.stringify(callArg.messages);

      // Should contain summary
      expect(allContent).toContain('Previous conversation about topic X');
      // Should contain messages after anchor
      expect(allContent).toContain('Recent message');
      // Should not contain original messages before anchor (they are compressed)
      expect(allContent).not.toContain('Old message 1');
    });

    it('should accept CompressionConfig for built-in compressor', () => {
      const client = createMockClient();

      // Pass CompressionConfig instead of IContextCompressor
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        compressor: {
          strategy: 'truncate',
          threshold: 10,
          keepRecent: 3,
        },
      });

      expect(runner).toBeDefined();
    });
  });

  describe('chatStream edge cases', () => {
    it('should handle chatStream default event type', async () => {
      // Test the default case in chatStream's event handling
      const client = {
        call: vi.fn(),
        stream: vi.fn().mockImplementation(async function* () {
          // Yield an unknown event type to hit default case
          yield { type: 'unknown_event', data: 'test' };
          yield { type: 'done', roundTotalTokens: { input: 10, output: 5 } };
        }),
      } as unknown as LLMClient;

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      const state = createAgentState(defaultConfig);
      const chunks = [];

      for await (const chunk of runner.chatStream(state, 'Hello')) {
        chunks.push(chunk);
        if (chunk.type === 'done') break;
      }

      // Should ignore unknown event and still complete
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[chunks.length - 1].type).toBe('done');
    });
  });

  // ============================================================
  // Skill integration
  // ============================================================
  describe('skill integration', () => {
    /** Create mock ISkillProvider */
    const createMockSkillProvider = (skills: SkillManifest[]): ISkillProvider => {
      const manifestMap = new Map(skills.map((s) => [s.name, s]));
      return {
        getManifest: vi.fn((name: string) => manifestMap.get(name)),
        loadInstructions: vi.fn(async (name: string) => {
          const m = manifestMap.get(name);
          if (!m) throw new Error(`Skill not found: ${name}`);
          return `Instructions for ${name}`;
        }),
        loadResource: vi.fn(async () => ''),
        listSkills: vi.fn(() => Array.from(manifestMap.values())),
        refresh: vi.fn(),
      };
    };

    it('should accept skillProvider option', () => {
      const client = createMockClient();
      const skillProvider = createMockSkillProvider([
        { name: 'code-review', description: 'Review code', source: '/skills/code-review' },
      ]);

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        skillProvider,
      });

      expect(runner).toBeDefined();
      // load_skill tool should be auto-registered
      const tools = runner.getToolRegistry().toToolSchemas();
      const loadSkillTool = tools.find((t) => t.function.name === 'load_skill');
      expect(loadSkillTool).toBeDefined();
    });

    it('should create FilesystemSkillProvider from skillDirectories', () => {
      const client = createMockClient();

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        skillDirectories: ['/nonexistent/skills'],
      });

      expect(runner).toBeDefined();
      // load_skill tool should be registered even if directory doesn't exist (provider exists but has no skills)
      const tools = runner.getToolRegistry().toToolSchemas();
      const loadSkillTool = tools.find((t) => t.function.name === 'load_skill');
      expect(loadSkillTool).toBeDefined();
    });

    it('should prefer skillProvider over skillDirectories when both are provided', () => {
      const client = createMockClient();
      const injectedProvider = createMockSkillProvider([
        { name: 'injected-skill', description: 'From injection', source: '/injected' },
      ]);

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        skillProvider: injectedProvider,
        skillDirectories: ['/nonexistent/skills'],
      });

      expect(runner).toBeDefined();
      // Should use injected provider, skillDirectories is ignored
      const tools = runner.getToolRegistry().toToolSchemas();
      const loadSkillTool = tools.find((t) => t.function.name === 'load_skill');
      expect(loadSkillTool).toBeDefined();
    });

    it('should auto-register load_skill tool when skillProvider exists', async () => {
      const client = createMockClient();
      vi.mocked(client.call).mockResolvedValue({
        content: 'Done',
        tokens: { input: 5, output: 5 },
        stopReason: 'stop',
      });

      const skillProvider = createMockSkillProvider([
        {
          name: 'code-review',
          description: 'Review code for security',
          source: '/skills/code-review',
        },
      ]);

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        skillProvider,
      });

      // Verify load_skill tool is in registry
      const tools = runner.getToolRegistry().toToolSchemas();
      expect(tools.some((t) => t.function.name === 'load_skill')).toBe(true);

      // Execute load_skill tool
      const result = await runner.getToolRegistry().execute('load_skill', { name: 'code-review' });
      expect(result).toMatchObject({
        type: 'SWITCH_SKILL',
        to: 'code-review',
        instructions: 'Instructions for code-review',
      });
    });

    it('should include skill list in system prompt when skillProvider has skills', async () => {
      const client = createMockClient();
      vi.mocked(client.call).mockResolvedValue({
        content: 'Response',
        tokens: { input: 5, output: 5 },
        stopReason: 'stop',
      });

      const skillProvider = createMockSkillProvider([
        {
          name: 'code-review',
          description: 'Review code for security vulnerabilities',
          source: '/skills/code-review',
        },
        { name: 'testing', description: 'Write comprehensive tests', source: '/skills/testing' },
      ]);

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        skillProvider,
      });

      const state = createAgentState(defaultConfig);
      await runner.chat(state, 'Hello');

      const callArg = vi.mocked(client.call).mock.calls[0][0];
      const firstUserMsg = callArg.messages.find((m: { role: string }) => m.role === 'user');

      // System prompt should contain skill list
      expect(firstUserMsg?.content).toContain('Available skills:');
      expect(firstUserMsg?.content).toContain(
        'code-review: Review code for security vulnerabilities'
      );
      expect(firstUserMsg?.content).toContain('testing: Write comprehensive tests');
      expect(firstUserMsg?.content).toContain(
        'Use the load_skill tool to load detailed instructions'
      );
    });

    it('should not include skill section when skillProvider has no skills', async () => {
      const client = createMockClient();
      vi.mocked(client.call).mockResolvedValue({
        content: 'Response',
        tokens: { input: 5, output: 5 },
        stopReason: 'stop',
      });

      // Empty skill provider
      const skillProvider = createMockSkillProvider([]);

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        skillProvider,
      });

      const state = createAgentState(defaultConfig);
      await runner.chat(state, 'Hello');

      const callArg = vi.mocked(client.call).mock.calls[0][0];
      const firstUserMsg = callArg.messages.find((m: { role: string }) => m.role === 'user');

      // Should not contain skill-related content when no skills exist
      expect(firstUserMsg?.content).not.toContain('Available skills:');
    });

    it('should not register load_skill tool when no skillProvider is configured', () => {
      const client = createMockClient();

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      const tools = runner.getToolRegistry().toToolSchemas();
      expect(tools.some((t) => t.function.name === 'load_skill')).toBe(false);
    });
  });

  // ============================================================
  // SubAgent integration
  // ============================================================
  describe('subagent integration', () => {
    /** Mock token stats */
    const mockTokens = { input: 10, output: 5 };

    /** Create mock LLM Client (supports multiple response sequences) */
    const createMultiResponseClient = (responses: LLMResponse[]): LLMClient => {
      let callIndex = 0;
      return {
        call: vi.fn().mockImplementation(() => {
          if (callIndex >= responses.length) {
            throw new Error(`No more mock responses (index ${callIndex})`);
          }
          return Promise.resolve(responses[callIndex++]);
        }),
        stream: vi.fn(),
      } as unknown as LLMClient;
    };

    /** Create test sub-agent configs */
    const createTestSubAgents = (): SubAgentConfig[] => [
      {
        name: 'researcher',
        description: 'Information research specialist',
        config: {
          name: 'researcher',
          instructions: 'You are a research specialist.',
          tools: [{ name: 'search', description: 'Search the web', parameters: {} }],
        },
        maxSteps: 5,
      },
      {
        name: 'writer',
        description: 'Content writing specialist',
        config: {
          name: 'writer',
          instructions: 'You are a writing specialist.',
          tools: [],
        },
      },
    ];

    it('should auto-register delegate tool when subAgents are provided', () => {
      const client = createMockClient();
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        subAgents: createTestSubAgents(),
      });

      const tools = runner.getToolRegistry().toToolSchemas();
      const delegateTool = tools.find((t) => t.function.name === 'delegate');
      expect(delegateTool).toBeDefined();
      expect(delegateTool!.function.description).toBeTruthy();
    });

    it('should not register delegate tool when subAgents are not provided', () => {
      const client = createMockClient();
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      const tools = runner.getToolRegistry().toToolSchemas();
      expect(tools.some((t) => t.function.name === 'delegate')).toBe(false);
    });

    it('should not register delegate tool for empty subAgents array', () => {
      const client = createMockClient();
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        subAgents: [],
      });

      const tools = runner.getToolRegistry().toToolSchemas();
      expect(tools.some((t) => t.function.name === 'delegate')).toBe(false);
    });

    it('should inject sub-agent list into system prompt', async () => {
      const client = createMockClient();
      vi.mocked(client.call).mockResolvedValue({
        content: 'Response',
        tokens: { input: 5, output: 5 },
        stopReason: 'stop',
      });

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        subAgents: createTestSubAgents(),
      });

      const state = createAgentState(defaultConfig);
      await runner.chat(state, 'Hello');

      const callArg = vi.mocked(client.call).mock.calls[0][0];
      const firstUserMsg = callArg.messages.find((m: { role: string }) => m.role === 'user');

      // System prompt should contain sub-agent list
      expect(firstUserMsg?.content).toContain('Available sub-agents:');
      expect(firstUserMsg?.content).toContain('researcher: Information research specialist');
      expect(firstUserMsg?.content).toContain('writer: Content writing specialist');
      expect(firstUserMsg?.content).toContain('Use the delegate tool');
    });

    it('should not include sub-agent related content in system prompt when no sub-agents are configured', async () => {
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

      const state = createAgentState(defaultConfig);
      await runner.chat(state, 'Hello');

      const callArg = vi.mocked(client.call).mock.calls[0][0];
      const firstUserMsg = callArg.messages.find((m: { role: string }) => m.role === 'user');

      expect(firstUserMsg?.content).not.toContain('Available sub-agents:');
    });

    it('delegate tool should be executable through registry', async () => {
      // Main agent calls LLM and returns delegate tool call
      // Sub-agent LLM call (inside delegate tool) also needs a response
      const client = createMultiResponseClient([
        {
          // Sub-agent LLM response
          content: 'Research complete: found 3 relevant papers.',
          toolCalls: [],
          tokens: mockTokens,
          stopReason: 'stop',
        },
      ]);

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        subAgents: createTestSubAgents(),
      });

      // Execute delegate tool directly through registry
      const result = await runner.getToolRegistry().execute('delegate', {
        agent: 'researcher',
        task: 'Research TypeScript',
      });

      expect(result).toBeDefined();
      const delegateResult = result as { answer: string; totalSteps: number };
      expect(delegateResult.answer).toBe('Research complete: found 3 relevant papers.');
      expect(delegateResult.totalSteps).toBe(1);
    });

    it('delegate tool should handle unknown sub-agent', async () => {
      const client = createMockClient();
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        subAgents: createTestSubAgents(),
      });

      const result = await runner.getToolRegistry().execute('delegate', {
        agent: 'unknown_agent',
        task: 'Do something',
      });

      const delegateResult = result as { answer: string; totalSteps: number };
      expect(delegateResult.answer).toContain('Error');
      expect(delegateResult.totalSteps).toBe(0);
    });

    it('subAgents should coexist with other options (skills, tools)', () => {
      const client = createMockClient();
      const skillProvider = {
        getManifest: vi.fn(),
        loadInstructions: vi.fn(),
        loadResource: vi.fn(),
        listSkills: vi.fn(() => []),
        refresh: vi.fn(),
      } as unknown as ISkillProvider;

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        subAgents: createTestSubAgents(),
        skillProvider,
        tools: [
          {
            name: 'custom_tool',
            description: 'A custom tool',
            parameters: { _def: {} },
            execute: async () => 'ok',
          },
        ],
      });

      const tools = runner.getToolRegistry().toToolSchemas();
      const toolNames = tools.map((t) => t.function.name);

      // delegate, load_skill, custom_tool should all be registered
      expect(toolNames).toContain('delegate');
      expect(toolNames).toContain('load_skill');
      expect(toolNames).toContain('custom_tool');
    });

    it('should correctly handle allowDelegation in sub-agent config', () => {
      const client = createMockClient();
      const subAgents: SubAgentConfig[] = [
        {
          name: 'delegator',
          description: 'Can delegate to others',
          config: {
            name: 'delegator',
            instructions: 'You can delegate.',
            tools: [],
          },
          allowDelegation: true,
        },
      ];

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        subAgents,
      });

      const tools = runner.getToolRegistry().toToolSchemas();
      expect(tools.some((t) => t.function.name === 'delegate')).toBe(true);
    });
  });
});
