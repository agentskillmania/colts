/**
 * AgentRunner unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMClient, LLMResponse, TokenStats } from '@agentskillmania/llm-client';
import { AgentRunner } from '../../../src/runner/index.js';
import { createAgentState, addUserMessage, addAssistantMessage } from '../../../src/state/index.js';
import type { AgentConfig, IContextCompressor, CompressResult } from '../../../src/types.js';
import type { ISkillProvider, SkillManifest } from '../../../src/skills/types.js';
import type { SubAgentConfig } from '../../../src/subagent/types.js';
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

    it('should throw ConfigurationError when both llmClient and llm are provided', () => {
      const client = createMockClient();
      const providers = [{ name: 'openai', apiKey: 'test-key', models: [{ modelId: 'gpt-4' }] }];

      expect(() => {
        new AgentRunner({
          model: 'gpt-4',
          llmClient: client,
          llm: { providers },
        });
      }).toThrow();

      expect(() => {
        new AgentRunner({
          model: 'gpt-4',
          llmClient: client,
          llm: { providers },
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

    it('should use injected messageAssembler', async () => {
      const client = createMockClient();
      const mockResponse: LLMResponse = {
        content: 'Hello!',
        tokens: { input: 1, output: 1 },
        stopReason: 'stop',
      };
      mockStreamResponse(client,mockResponse);

      const customAssembler: IMessageAssembler = {
        build: vi.fn().mockReturnValue([
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
      mockStreamResponse(client,{
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
      mockStreamResponse(client,{
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
      mockStreamResponse(client,{
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
      mockStreamResponse(client,{
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
      mockStreamResponse(client,{
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
      mockStreamResponse(client,{
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
      mockStreamResponse(client,{
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
      mockStreamResponse(client,{
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

  // ============================================================
  // SubAgent integration
  // ============================================================
  describe('subagent integration', () => {
    /** Mock token stats */
    const mockTokens = { input: 10, output: 5 };

    /** Create mock LLM Client (supports multiple response sequences) */
    const createMultiResponseClient = createCallOnlyMockLLMClient;

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
      expect(delegateTool).toEqual(
        expect.objectContaining({
          function: expect.objectContaining({
            description:
              'Delegate a task to a specialized sub-agent. Use when a task requires specific expertise or tools that a sub-agent possesses.',
          }),
        })
      );
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
      mockStreamResponse(client,{
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
      await runner.run(addUserMessage(state, 'Hello'));

      const callArg = vi.mocked(client.stream).mock.calls[0][0];
      const firstUserMsg = callArg.messages.find((m: { role: string }) => m.role === 'user');

      // System prompt should contain sub-agent list
      expect(firstUserMsg?.content).toContain('Available sub-agents:');
      expect(firstUserMsg?.content).toContain('researcher: Information research specialist');
      expect(firstUserMsg?.content).toContain('writer: Content writing specialist');
      expect(firstUserMsg?.content).toContain('Use the delegate tool');
    });

    it('should not include sub-agent related content in system prompt when no sub-agents are configured', async () => {
      const client = createMockClient();
      mockStreamResponse(client,{
        content: 'Response',
        tokens: { input: 5, output: 5 },
        stopReason: 'stop',
      });

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
      });

      const state = createAgentState(defaultConfig);
      await runner.run(addUserMessage(state, 'Hello'));

      const callArg = vi.mocked(client.stream).mock.calls[0][0];
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

      expect(result).toEqual(
        expect.objectContaining({
          status: 'success',
          answer: 'Research complete: found 3 relevant papers.',
          totalSteps: 1,
        })
      );
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

      const delegateResult = result as { status: string; error: string; totalSteps: number };
      expect(delegateResult.status).toBe('error');
      expect(delegateResult.error).toContain('Unknown sub-agent');
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
      expect(tools.map((t) => t.function.name)).toContain('delegate');
    });
  });
});
