/**
 * AgentRunner unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMClient, LLMResponse, TokenStats } from '@agentskillmania/llm-client';
import { AgentRunner } from '../../src/runner.js';
import { createAgentState, addUserMessage, addAssistantMessage } from '../../src/state.js';
import type { AgentConfig, IContextCompressor, CompressResult } from '../../src/types.js';
import type { ISkillProvider, SkillManifest } from '../../src/skills/types.js';
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

      // 创建带有消息的 state
      let state = createAgentState(defaultConfig);
      for (let i = 0; i < 10; i++) {
        state = addUserMessage(state, `Message ${i}`);
      }

      const compressed = await runner.compress(state);

      expect(compressed.context.compression).toEqual({
        summary: 'Summary of conversation',
        anchor: 5,
      });
      // 原始 state 不变
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

      // step 完成后 shouldCompress 应被调用
      expect(mockCompressor.shouldCompress).toHaveBeenCalled();
      // 如果需要压缩，compress 也应被调用
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

      // 创建带有 compression 元数据的 state
      let state = createAgentState(defaultConfig);
      state = addUserMessage(state, 'Old message 1');
      state = addAssistantMessage(state, 'Old response 1', { type: 'final', visible: true });
      state = addUserMessage(state, 'Old message 2');
      state = addAssistantMessage(state, 'Old response 2', { type: 'final', visible: true });
      state = addUserMessage(state, 'Recent message');
      state = addAssistantMessage(state, 'Recent response', { type: 'final', visible: true });

      // 设置 compression：anchor=4，意味着 messages[0..3] 被压缩
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

      // 应包含 summary
      expect(allContent).toContain('Previous conversation about topic X');
      // 应包含 anchor 之后的消息
      expect(allContent).toContain('Recent message');
      // 不应包含 anchor 之前的原始消息（它们被压缩了）
      expect(allContent).not.toContain('Old message 1');
    });

    it('should accept CompressionConfig for built-in compressor', () => {
      const client = createMockClient();

      // 传入 CompressionConfig 而非 IContextCompressor
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
    /** 创建 mock ISkillProvider */
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
      // load_skill 工具应该被自动注册
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
      // 即使目录不存在，load_skill 工具也应注册（provider 存在但没有 skills）
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
      // 应使用注入的 provider，skillDirectories 被忽略
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

      // 验证 load_skill 工具在 registry 中
      const tools = runner.getToolRegistry().toToolSchemas();
      expect(tools.some((t) => t.function.name === 'load_skill')).toBe(true);

      // 执行 load_skill 工具
      const result = await runner.getToolRegistry().execute('load_skill', { name: 'code-review' });
      expect(result).toBe('Instructions for code-review');
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

      // 系统提示应包含 skill 列表
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

      // 空 skill provider
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

      // 没有 skills 时不应该包含 skill 相关内容
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
});
