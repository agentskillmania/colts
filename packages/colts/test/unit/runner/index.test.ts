/**
 * AgentRunner unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMClient, LLMResponse, TokenStats } from '@agentskillmania/llm-client';
import { AgentRunner } from '../../../src/runner/index.js';
import { z } from 'zod';
import { createAgentState, addUserMessage, addAssistantMessage } from '../../../src/state/index.js';
import type { AgentConfig, IContextCompressor, CompressResult } from '../../../src/types.js';
import type { ISkillProvider, SkillManifest } from '../../../src/skills/types.js';
import { FilesystemSkillProvider } from '../../../src/skills/filesystem-provider.js';
import type { IMessageAssembler } from '../../../src/message-assembler/types.js';
import { createCallOnlyMockLLMClient } from '../../helpers/mock-llm.js';

describe('AgentRunner', () => {
  // Mock LLMClient. `stream` is the active path used by CallingLLMHandler.
  // Tests seed the stream response with `mockStreamResponse(client, response)`.
  const createMockClient = () => {
    return {
      call: vi.fn(),
      stream: vi.fn(),
      getModelMeta: vi.fn().mockReturnValue({ contextWindow: 128000, maxTokens: 4096 }),
    } as unknown as LLMClient;
  };

  /** Configure a mock client's `stream()` to yield a single response. */
  function mockStreamResponse(client: LLMClient, response: LLMResponse) {
    vi.mocked(client.stream).mockImplementation(async function* () {
      if (response.thinking) {
        yield { type: 'thinking', delta: response.thinking };
      }
      if (response.content) {
        yield {
          type: 'text',
          delta: response.content,
          accumulatedContent: response.content,
        };
      }
      if (response.toolCalls?.length) {
        for (const toolCall of response.toolCalls) {
          yield { type: 'tool_call', toolCall };
        }
      }
      yield { type: 'done', roundTotalTokens: response.tokens };
    });
  }

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

      expect(runner).toBeInstanceOf(AgentRunner);
    });

    it('should create AgentRunner with optional options', () => {
      const client = createMockClient();
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        systemPrompt: 'Custom system prompt',
        requestTimeout: 30000,
      });

      expect(runner).toBeInstanceOf(AgentRunner);
    });

    it('should throw ConfigurationError when llmClient is not provided', () => {
      expect(() => {
        new AgentRunner({
          model: 'gpt-4',
        } as any);
      }).toThrow();

      expect(() => {
        new AgentRunner({
          model: 'gpt-4',
        } as any);
      }).toThrow('Must specify llmClient');
    });

    it('should use injected messageAssembler', async () => {
      const client = createMockClient();
      const mockResponse: LLMResponse = {
        content: 'Hello!',
        tokens: { input: 1, output: 1 },
        stopReason: 'stop',
      };
      mockStreamResponse(client, mockResponse);

      const customAssembler: IMessageAssembler = {
        build: vi.fn().mockResolvedValue([
          { role: 'user', content: 'custom-system', timestamp: Date.now() },
          { role: 'user', content: 'Hi there!', timestamp: Date.now() },
        ]),
      };

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        messageAssembler: customAssembler,
      });

      const state = createAgentState(defaultConfig);
      await runner.run(addUserMessage(state, 'Hi there!'));

      expect(customAssembler.build).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ systemPrompt: undefined })
      );
      const callArg = vi.mocked(client.stream).mock.calls[0][0];
      expect(callArg.messages[0].content).toBe('custom-system');
    });
  });

  describe('message building', () => {
    it('should include all assistant messages in LLM context', async () => {
      const client = createMockClient();
      mockStreamResponse(client, {
        content: 'Response',
        tokens: { input: 5, output: 5 },
        stopReason: 'stop',
      });

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      // Create state with thought and final assistant messages
      let state = createAgentState(defaultConfig);
      state = {
        ...state,
        context: {
          ...state.context,
          messages: [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Thinking about it', type: 'thought' },
            { role: 'assistant', content: 'Final response', type: 'text' },
          ],
        },
      };

      await runner.run(addUserMessage(state, 'Next message'));

      const callArg = vi.mocked(client.stream).mock.calls[0][0];
      const userMsgs = callArg.messages.filter((m: { role: string }) => m.role === 'user');
      const assistantMsgs = callArg.messages.filter(
        (m: { role: string }) => m.role === 'assistant'
      );
      const assistantContents = assistantMsgs.map((m: { content: unknown }) =>
        Array.isArray(m.content) ? m.content[0]?.text : m.content
      );

      // Should include user messages
      expect(userMsgs).toContainEqual(expect.objectContaining({ content: 'Hello' }));
      // Thought messages are skipped by the assembler — only action messages appear
      expect(assistantContents).toEqual([
        'Understood. I will follow these instructions.',
        'Final response',
      ]);
    });

    it('should include tool results in context', async () => {
      const client = createMockClient();
      mockStreamResponse(client, {
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
            { role: 'assistant', content: 'Action: calculate', type: 'action' },
            { role: 'tool', content: '42', toolCallId: 'calc-1' },
          ],
        },
      };

      await runner.run(addUserMessage(state, 'What is the result?'));

      // Then: Tool result is included as toolResult message
      const callArg = vi.mocked(client.stream).mock.calls[0][0];
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
      mockStreamResponse(client, {
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
      expect(mockCompressor.shouldCompress).toHaveBeenCalledWith(expect.any(Object));
      // If compression is needed, compress should also be called
      if (mockCompressor.shouldCompress({ ...state, context: { ...state.context } })) {
        expect(mockCompressor.compress).toHaveBeenCalledWith(expect.any(Object));
      }
    });

    it('should not compress when shouldCompress returns false', async () => {
      const client = createMockClient();
      mockStreamResponse(client, {
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

      expect(mockCompressor.shouldCompress).toHaveBeenCalledWith(expect.any(Object));
      expect(mockCompressor.compress).not.toHaveBeenCalledWith(expect.any(Object));
      expect(finalState.context.compression).toBeUndefined();
    });

    it('should build messages with compression summary', async () => {
      const client = createMockClient();
      mockStreamResponse(client, {
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
      state = addAssistantMessage(state, 'Old response 1', { type: 'text' });
      state = addUserMessage(state, 'Old message 2');
      state = addAssistantMessage(state, 'Old response 2', { type: 'text' });
      state = addUserMessage(state, 'Recent message');
      state = addAssistantMessage(state, 'Recent response', { type: 'text' });

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

      await runner.run(addUserMessage(state, 'Follow up'));

      const callArg = vi.mocked(client.stream).mock.calls[0][0];
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

      expect(runner).toBeInstanceOf(AgentRunner);
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
        getManifest: vi.fn(async (name: string) => manifestMap.get(name)),
        loadInstructions: vi.fn(async (name: string) => {
          const m = manifestMap.get(name);
          if (!m) throw new Error(`Skill not found: ${name}`);
          return `Instructions for ${name}`;
        }),
        loadResource: vi.fn(async () => ''),
        listSkills: vi.fn(async () => Array.from(manifestMap.values())),
        refresh: vi.fn(async () => {}),
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

      expect(runner).toBeInstanceOf(AgentRunner);
      // load_skill tool should be auto-registered
      const tools = runner.getToolRegistry().toToolSchemas();
      expect(tools.map((t) => t.function.name)).toContain('load_skill');
    });

    it('should create FilesystemSkillProvider from skillDirs', () => {
      const client = createMockClient();

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        skillDirs: ['/nonexistent/skills'],
      });

      expect(runner).toBeInstanceOf(AgentRunner);
      // load_skill tool should be registered even if directory doesn't exist (provider exists but has no skills)
      const tools = runner.getToolRegistry().toToolSchemas();
      expect(tools.map((t) => t.function.name)).toContain('load_skill');
    });

    it('should prefer skillProvider over skillDirs when both are provided', () => {
      const client = createMockClient();
      const injectedProvider = createMockSkillProvider([
        { name: 'injected-skill', description: 'From injection', source: '/injected' },
      ]);

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        skillProvider: injectedProvider,
        skillDirs: ['/nonexistent/skills'],
      });

      expect(runner).toBeInstanceOf(AgentRunner);
      // Should use injected provider, skillDirs is ignored
      const tools = runner.getToolRegistry().toToolSchemas();
      expect(tools.map((t) => t.function.name)).toContain('load_skill');
    });

    it('should auto-register load_skill tool when skillProvider exists', async () => {
      const client = createMockClient();
      mockStreamResponse(client, {
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
      expect(tools).toContainEqual(
        expect.objectContaining({ function: expect.objectContaining({ name: 'load_skill' }) })
      );

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
      mockStreamResponse(client, {
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
      await runner.run(addUserMessage(state, 'Hello'));

      const callArg = vi.mocked(client.stream).mock.calls[0][0];
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
      mockStreamResponse(client, {
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
      await runner.run(addUserMessage(state, 'Hello'));

      const callArg = vi.mocked(client.stream).mock.calls[0][0];
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

  describe('todo:list events', () => {
    // Minimal inline todo list on agent context (same convention as wrangler's
    // todolist middleware: context.todoList = { items, nextId }).
    const readTodo = (state: { context: Record<string, unknown> }) =>
      (state.context.todoList as { items: unknown[] })?.items ?? [];
    const withTodo = (state: { context: Record<string, unknown> }, items: unknown[]) => ({
      ...state,
      context: { ...state.context, todoList: { items, nextId: items.length + 1 } },
    });

    it('emits todo:list only when the list changed during a step', async () => {
      const client = createMockClient();
      let stepNo = 0;
      vi.mocked(client.stream).mockImplementation(async function* () {
        stepNo++;
        // Step 1-2: tool call (continue the loop); step 3: final answer (stop).
        if (stepNo < 3) {
          yield {
            type: 'tool_call',
            toolCall: { id: `c${stepNo}`, name: 'fake_todo', arguments: {} },
          };
        }
        yield { type: 'done', roundTotalTokens: { input: 5, output: 5 } };
      });

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        tools: [
          {
            name: 'fake_todo',
            description: 'fake todo tool',
            parameters: z.object({}),
            execute: async () => ({ ok: true }),
          } as never,
        ],
        middleware: [
          {
            name: 'todo-stub',
            beforeStep: async (ctx: { state: { context: Record<string, unknown> } }) => {
              if (!ctx.state.context.todoList) {
                return { state: withTodo(ctx.state, []) };
              }
              return;
            },
            afterStep: async (ctx: { state: { context: Record<string, unknown> } }) => {
              // Add one item on the first step only; later steps leave the
              // list unchanged so we can assert no duplicate emission.
              const items = readTodo(ctx.state);
              if (items.length === 0) {
                return {
                  state: withTodo(ctx.state, [{ id: 1, subject: 'item-1', status: 'pending' }]),
                };
              }
              return;
            },
          },
        ],
      });

      const emitted: Array<{ items: unknown[] }> = [];
      runner.on('todo:list', (e) => emitted.push(e));

      await runner.run(createAgentState(defaultConfig));

      // Step 1: list 0 → 1 item, emit once. Steps 2-3: unchanged, no emission.
      expect(emitted).toHaveLength(1);
      expect(emitted[0].items).toEqual([{ id: 1, subject: 'item-1', status: 'pending' }]);
    });

    it('emits updated snapshots as the list grows', async () => {
      const client = createMockClient();
      let stepNo = 0;
      vi.mocked(client.stream).mockImplementation(async function* () {
        stepNo++;
        if (stepNo < 3) {
          yield {
            type: 'tool_call',
            toolCall: { id: `c${stepNo}`, name: 'fake_todo', arguments: {} },
          };
        }
        yield { type: 'done', roundTotalTokens: { input: 5, output: 5 } };
      });

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        tools: [
          {
            name: 'fake_todo',
            description: 'fake todo tool',
            parameters: z.object({}),
            execute: async () => ({ ok: true }),
          } as never,
        ],
        middleware: [
          {
            name: 'todo-stub',
            afterStep: async (ctx: { state: { context: Record<string, unknown> } }) => {
              const items = readTodo(ctx.state);
              return {
                state: withTodo(ctx.state, [
                  ...items,
                  { id: items.length + 1, subject: `item-${items.length + 1}`, status: 'pending' },
                ]),
              };
            },
          },
        ],
      });

      const emitted: Array<{ items: unknown[] }> = [];
      runner.on('todo:list', (e) => emitted.push(e));

      await runner.run(createAgentState(defaultConfig));

      // Step 1 emits [item-1]; step 2 emits [item-1, item-2]; the final
      // step's afterStep adds item-3, so a last [item-1, item-2, item-3]
      // snapshot is emitted before the run stops.
      expect(emitted.map((e) => e.items.length)).toEqual([1, 2, 3]);
    });
  });
});
