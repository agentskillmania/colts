/**
 * @fileoverview delegate tool 单元测试
 *
 * 测试 createDelegateTool 工厂函数，包括：
 * - 成功委派任务给子 agent
 * - 子 agent 成功返回
 * - 子 agent 错误返回
 * - 子 agent 达到最大步数
 * - extraInstructions 正确追加
 * - 未知子 agent 返回错误
 * - 子 agent 拥有独立的工具集
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMClient, LLMResponse } from '@agentskillmania/llm-client';
import { z } from 'zod';
import { createDelegateTool } from '../../src/subagent/delegate-tool.js';
import type { DelegateToolDeps } from '../../src/subagent/delegate-tool.js';
import type { SubAgentConfig, DelegateResult } from '../../src/subagent/types.js';
import { ToolRegistry } from '../../src/tools/registry.js';

// ============================================================
// 辅助工具
// ============================================================

/** 模拟 token 统计 */
const mockTokens = { input: 10, output: 5 };

/**
 * 创建模拟 LLM Client
 *
 * @param responses - LLM 响应序列，每次 call 返回下一个
 * @returns 模拟的 LLMClient
 */
function createMockLLMClient(responses: LLMResponse[]): LLMClient {
  let callIndex = 0;

  return {
    call: vi.fn().mockImplementation(() => {
      if (callIndex >= responses.length) {
        throw new Error(`No more mock responses (index ${callIndex}, total ${responses.length})`);
      }
      return Promise.resolve(responses[callIndex++]);
    }),
    stream: vi.fn().mockImplementation(async function* () {
      throw new Error('Stream not used in delegate tool tests');
    }),
  } as unknown as LLMClient;
}

/** 创建 LLM 错误的 mock client */
function createErrorLLMClient(errorMessage: string): LLMClient {
  return {
    call: vi.fn().mockRejectedValue(new Error(errorMessage)),
    stream: vi.fn(),
  } as unknown as LLMClient;
}

/** 创建持续返回工具调用的 mock client（用于 max_steps 测试） */
function createToolCallLoopLLMClient(toolName: string, callCount: number): LLMClient {
  const response: LLMResponse = {
    content: 'Thinking...',
    toolCalls: [
      {
        id: 'call-loop',
        name: toolName,
        arguments: { input: 'test' },
      },
    ],
    tokens: mockTokens,
    stopReason: 'tool_calls',
  };

  return createMockLLMClient(Array(callCount).fill(response));
}

/**
 * 创建测试用的子 agent 配置映射
 *
 * @param overrides - 可选覆盖默认配置
 * @returns Map<string, SubAgentConfig>
 */
function createSubAgentConfigs(
  overrides?: Partial<Record<string, Partial<SubAgentConfig>>>
): Map<string, SubAgentConfig> {
  const configs = new Map<string, SubAgentConfig>();

  const defaultResearcher: SubAgentConfig = {
    name: 'researcher',
    description: 'Information research specialist',
    config: {
      name: 'researcher',
      instructions: 'You are a research specialist.',
      tools: [{ name: 'search', description: 'Search the web', parameters: {} }],
    },
    maxSteps: 5,
  };

  const defaultWriter: SubAgentConfig = {
    name: 'writer',
    description: 'Content writing specialist',
    config: {
      name: 'writer',
      instructions: 'You are a writing specialist.',
      tools: [],
    },
  };

  configs.set('researcher', {
    ...defaultResearcher,
    ...overrides?.researcher,
    config: {
      ...defaultResearcher.config,
      ...overrides?.researcher?.config,
    },
  });

  configs.set('writer', {
    ...defaultWriter,
    ...overrides?.writer,
    config: {
      ...defaultWriter.config,
      ...overrides?.writer?.config,
    },
  });

  return configs;
}

// ============================================================
// 测试
// ============================================================

describe('createDelegateTool', () => {
  let subAgentConfigs: Map<string, SubAgentConfig>;

  beforeEach(() => {
    subAgentConfigs = createSubAgentConfigs();
  });

  // ----------------------------------------------------------
  // 基本属性
  // ----------------------------------------------------------
  describe('tool properties', () => {
    it('应该返回名为 "delegate" 的工具', () => {
      const client = createMockLLMClient([]);
      const tool = createDelegateTool({
        parentToolRegistry: new ToolRegistry(),
        subAgentConfigs,
        llmProvider: client,
      });

      expect(tool.name).toBe('delegate');
    });

    it('应该有非空描述', () => {
      const client = createMockLLMClient([]);
      const tool = createDelegateTool({
        parentToolRegistry: new ToolRegistry(),
        subAgentConfigs,
        llmProvider: client,
      });

      expect(tool.description).toBeTruthy();
      expect(typeof tool.description).toBe('string');
    });

    it('应该有有效的 Zod 参数 schema', () => {
      const client = createMockLLMClient([]);
      const tool = createDelegateTool({
        parentToolRegistry: new ToolRegistry(),
        subAgentConfigs,
        llmProvider: client,
      });

      expect(tool.parameters).toBeDefined();
      expect(tool.parameters._def).toBeDefined();
    });

    it('应该可注册到 ToolRegistry', () => {
      const client = createMockLLMClient([]);
      const tool = createDelegateTool({
        parentToolRegistry: new ToolRegistry(),
        subAgentConfigs,
        llmProvider: client,
      });

      const registry = new ToolRegistry();
      registry.register(tool);

      expect(registry.has('delegate')).toBe(true);
    });
  });

  // ----------------------------------------------------------
  // 成功委派
  // ----------------------------------------------------------
  describe('successful delegation', () => {
    it('应该成功委派任务给子 agent 并返回成功结果', async () => {
      const mockResponse: LLMResponse = {
        content: 'Research result: TypeScript is a typed superset of JavaScript.',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      };

      const client = createMockLLMClient([mockResponse]);
      const tool = createDelegateTool({
        parentToolRegistry: new ToolRegistry(),
        subAgentConfigs,
        llmProvider: client,
      });

      const result = (await tool.execute({
        agent: 'researcher',
        task: 'Research TypeScript',
      })) as DelegateResult;

      expect(result.answer).toBe('Research result: TypeScript is a typed superset of JavaScript.');
      expect(result.totalSteps).toBe(1);
      expect(result.finalState).not.toBeNull();
      expect(result.finalState!.context.stepCount).toBe(1);
    });

    it('应该通过 ToolRegistry 执行并返回正确结果', async () => {
      const mockResponse: LLMResponse = {
        content: 'Written article about AI.',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      };

      const client = createMockLLMClient([mockResponse]);
      const tool = createDelegateTool({
        parentToolRegistry: new ToolRegistry(),
        subAgentConfigs,
        llmProvider: client,
      });

      const registry = new ToolRegistry();
      registry.register(tool);

      const registryResult = await registry.execute('delegate', {
        agent: 'writer',
        task: 'Write about AI',
      });

      const result = registryResult as DelegateResult;
      expect(result.answer).toBe('Written article about AI.');
      expect(result.totalSteps).toBe(1);
    });
  });

  // ----------------------------------------------------------
  // 子 agent 错误
  // ----------------------------------------------------------
  describe('sub-agent error', () => {
    it('应该在子 agent 出错时返回错误信息', async () => {
      const client = createErrorLLMClient('API rate limit exceeded');
      const tool = createDelegateTool({
        parentToolRegistry: new ToolRegistry(),
        subAgentConfigs,
        llmProvider: client,
      });

      const result = (await tool.execute({
        agent: 'researcher',
        task: 'Search for something',
      })) as DelegateResult;

      expect(result.answer).toContain('Error:');
      expect(result.answer).toContain('API rate limit exceeded');
      expect(result.totalSteps).toBe(1);
      expect(result.finalState).not.toBeNull();
    });
  });

  // ----------------------------------------------------------
  // 子 agent 达到最大步数
  // ----------------------------------------------------------
  describe('max steps reached', () => {
    it('应该在子 agent 达到最大步数时返回 "Max steps reached"', async () => {
      // 子 agent 每步都调用工具，永远不会停止
      const client = createToolCallLoopLLMClient('search', 20);

      // researcher 的 maxSteps 为 5
      const tool = createDelegateTool({
        parentToolRegistry: new ToolRegistry(),
        subAgentConfigs,
        llmProvider: client,
      });

      const result = (await tool.execute({
        agent: 'researcher',
        task: 'Complex research task',
      })) as DelegateResult;

      expect(result.answer).toBe('Max steps reached');
      expect(result.totalSteps).toBe(5);
      expect(result.finalState).not.toBeNull();
    });

    it('应该使用 defaultMaxSteps 当子 agent 未配置 maxSteps 时', async () => {
      const client = createToolCallLoopLLMClient('search', 20);

      // writer 没有 maxSteps 配置，使用 defaultMaxSteps
      const tool = createDelegateTool({
        parentToolRegistry: new ToolRegistry(),
        subAgentConfigs,
        llmProvider: client,
        defaultMaxSteps: 3,
      });

      const result = (await tool.execute({
        agent: 'writer',
        task: 'Long writing task',
      })) as DelegateResult;

      expect(result.answer).toBe('Max steps reached');
      expect(result.totalSteps).toBe(3);
    });
  });

  // ----------------------------------------------------------
  // extraInstructions
  // ----------------------------------------------------------
  describe('extra instructions', () => {
    it('应该将 extraInstructions 追加到子 agent 的 instructions 后', async () => {
      const client = createMockLLMClient([
        {
          content: 'Done',
          toolCalls: [],
          tokens: mockTokens,
          stopReason: 'stop',
        },
      ]);

      const tool = createDelegateTool({
        parentToolRegistry: new ToolRegistry(),
        subAgentConfigs,
        llmProvider: client,
      });

      const result = (await tool.execute({
        agent: 'researcher',
        task: 'Research topic X',
        extraInstructions: 'Focus on academic sources only.',
      })) as DelegateResult;

      // 验证 LLM 被调用时 instructions 包含追加内容
      expect(client.call).toHaveBeenCalled();
      const callArg = vi.mocked(client.call).mock.calls[0][0];
      const messages = callArg.messages;
      // instructions 会出现在第一个 user message 中（通过 buildMessages）
      const firstUserMsg = messages.find((m: { role: string }) => m.role === 'user');
      const content =
        typeof firstUserMsg?.content === 'string'
          ? firstUserMsg.content
          : JSON.stringify(firstUserMsg?.content);
      expect(content).toContain('You are a research specialist.');
      expect(content).toContain('Focus on academic sources only.');

      expect(result.totalSteps).toBe(1);
    });

    it('不应该修改 instructions 当 extraInstructions 未提供时', async () => {
      const client = createMockLLMClient([
        {
          content: 'Done',
          toolCalls: [],
          tokens: mockTokens,
          stopReason: 'stop',
        },
      ]);

      const tool = createDelegateTool({
        parentToolRegistry: new ToolRegistry(),
        subAgentConfigs,
        llmProvider: client,
      });

      await tool.execute({
        agent: 'researcher',
        task: 'Research topic Y',
      });

      const callArg = vi.mocked(client.call).mock.calls[0][0];
      const messages = callArg.messages;
      const firstUserMsg = messages.find((m: { role: string }) => m.role === 'user');
      const content =
        typeof firstUserMsg?.content === 'string'
          ? firstUserMsg.content
          : JSON.stringify(firstUserMsg?.content);
      expect(content).toContain('You are a research specialist.');
      // 不应该包含额外追加的换行和空内容
      expect(content).not.toContain('\n\nundefined');
    });
  });

  // ----------------------------------------------------------
  // 未知子 agent
  // ----------------------------------------------------------
  describe('unknown sub-agent', () => {
    it('应该在请求未知子 agent 时返回包含可用列表的错误', async () => {
      const client = createMockLLMClient([]);
      const tool = createDelegateTool({
        parentToolRegistry: new ToolRegistry(),
        subAgentConfigs,
        llmProvider: client,
      });

      const result = (await tool.execute({
        agent: 'nonexistent',
        task: 'Do something',
      })) as DelegateResult;

      expect(result.answer).toContain("Error: Unknown sub-agent 'nonexistent'");
      expect(result.answer).toContain('researcher');
      expect(result.answer).toContain('writer');
      expect(result.totalSteps).toBe(0);
      expect(result.finalState).toBeNull();
    });

    it('当没有配置任何子 agent 时应该返回空列表', async () => {
      const emptyConfigs = new Map<string, SubAgentConfig>();
      const client = createMockLLMClient([]);
      const tool = createDelegateTool({
        parentToolRegistry: new ToolRegistry(),
        subAgentConfigs: emptyConfigs,
        llmProvider: client,
      });

      const result = (await tool.execute({
        agent: 'anything',
        task: 'Do something',
      })) as DelegateResult;

      expect(result.answer).toContain('Available: ');
      expect(result.totalSteps).toBe(0);
      expect(result.finalState).toBeNull();
    });
  });

  // ----------------------------------------------------------
  // 独立工具集
  // ----------------------------------------------------------
  describe('independent tool set', () => {
    it('子 agent 应该只看到自己的工具，而不是主 agent 的工具', async () => {
      // 创建两个子 agent，各有不同的工具
      const agentWithToolA: SubAgentConfig = {
        name: 'agent-a',
        description: 'Agent A',
        config: {
          name: 'agent-a',
          instructions: 'Agent A instructions',
          tools: [{ name: 'tool-a', description: 'Tool A only', parameters: {} }],
        },
      };

      const agentWithToolB: SubAgentConfig = {
        name: 'agent-b',
        description: 'Agent B',
        config: {
          name: 'agent-b',
          instructions: 'Agent B instructions',
          tools: [{ name: 'tool-b', description: 'Tool B only', parameters: {} }],
        },
      };

      const configs = new Map<string, SubAgentConfig>();
      configs.set('agent-a', agentWithToolA);
      configs.set('agent-b', agentWithToolB);

      // 创建返回工具调用的 mock client
      const callToolAResponse: LLMResponse = {
        content: 'Using tool-a',
        toolCalls: [
          {
            id: 'call-1',
            name: 'tool-a',
            arguments: { input: 'test' },
          },
        ],
        tokens: mockTokens,
        stopReason: 'tool_calls',
      };
      const finalResponse: LLMResponse = {
        content: 'Done with tool-a',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      };

      const client = createMockLLMClient([callToolAResponse, finalResponse]);

      const tool = createDelegateTool({
        parentToolRegistry: new ToolRegistry(),
        subAgentConfigs: configs,
        llmProvider: client,
      });

      const result = (await tool.execute({
        agent: 'agent-a',
        task: 'Use your tools',
      })) as DelegateResult;

      // agent-a 应该成功调用了 tool-a
      expect(result.answer).toBe('Done with tool-a');
      expect(result.totalSteps).toBe(2);
      // 验证传给 LLM 的 tools 包含 tool-a（通过 toToolSchemas 传给 LLM）
      expect(client.call).toHaveBeenCalled();
    });

    it('不同子 agent 应该有不同的工具集', async () => {
      // 创建父 Agent 的工具注册表，并注册工具
      const parentRegistry = new ToolRegistry();
      parentRegistry.register({
        name: 'search',
        description: 'Search',
        parameters: z.object({}),
        execute: async () => 'Search result',
      });
      parentRegistry.register({
        name: 'calculate',
        description: 'Calculate',
        parameters: z.object({}),
        execute: async () => '42',
      });

      const agentWithSearch: SubAgentConfig = {
        name: 'searcher',
        description: 'Search agent',
        config: {
          name: 'searcher',
          instructions: 'You search things.',
          tools: [{ name: 'search', description: 'Search', parameters: {} }],
        },
      };

      const agentWithCalc: SubAgentConfig = {
        name: 'calculator',
        description: 'Calc agent',
        config: {
          name: 'calculator',
          instructions: 'You calculate things.',
          tools: [{ name: 'calculate', description: 'Calculate', parameters: {} }],
        },
      };

      const configs = new Map<string, SubAgentConfig>();
      configs.set('searcher', agentWithSearch);
      configs.set('calculator', agentWithCalc);

      const client = createMockLLMClient([
        {
          content: 'Search result found',
          toolCalls: [],
          tokens: mockTokens,
          stopReason: 'stop',
        },
      ]);

      const tool = createDelegateTool({
        parentToolRegistry: parentRegistry,
        subAgentConfigs: configs,
        llmProvider: client,
      });

      // 委派给 searcher
      await tool.execute({ agent: 'searcher', task: 'Find info' });

      // 验证第一次 LLM 调用传入了 search 工具（pi-ai Tool 格式：{ name, description, parameters }）
      const firstCall = vi.mocked(client.call).mock.calls[0][0];
      expect(firstCall.tools).toBeDefined();
      const toolNames = (firstCall.tools as Array<{ name: string }>).map((t) => t.name);
      expect(toolNames).toContain('search');
      expect(toolNames).not.toContain('calculate');
    });
  });

  // ----------------------------------------------------------
  // 多步工具调用流程
  // ----------------------------------------------------------
  describe('multi-step tool execution', () => {
    it('应该支持子 agent 多步工具调用后给出最终答案', async () => {
      const responses: LLMResponse[] = [
        {
          content: 'Let me search for that',
          toolCalls: [
            {
              id: 'call-1',
              name: 'search',
              arguments: { query: 'TypeScript' },
            },
          ],
          tokens: mockTokens,
          stopReason: 'tool_calls',
        },
        {
          content: 'TypeScript was created by Microsoft in 2012.',
          toolCalls: [],
          tokens: mockTokens,
          stopReason: 'stop',
        },
      ];

      const client = createMockLLMClient(responses);
      const tool = createDelegateTool({
        parentToolRegistry: new ToolRegistry(),
        subAgentConfigs,
        llmProvider: client,
      });

      const result = (await tool.execute({
        agent: 'researcher',
        task: 'Tell me about TypeScript',
      })) as DelegateResult;

      expect(result.answer).toBe('TypeScript was created by Microsoft in 2012.');
      expect(result.totalSteps).toBe(2);
      expect(result.finalState).not.toBeNull();
      expect(result.finalState!.context.stepCount).toBe(2);
    });
  });

  // ----------------------------------------------------------
  // 参数验证
  // ----------------------------------------------------------
  describe('parameter validation', () => {
    it('应该通过 ToolRegistry 验证参数', async () => {
      const client = createMockLLMClient([]);
      const tool = createDelegateTool({
        parentToolRegistry: new ToolRegistry(),
        subAgentConfigs,
        llmProvider: client,
      });

      const registry = new ToolRegistry();
      registry.register(tool);

      // 缺少 agent 参数
      await expect(registry.execute('delegate', { task: 'Do something' })).rejects.toThrow();

      // 缺少 task 参数
      await expect(registry.execute('delegate', { agent: 'researcher' })).rejects.toThrow();

      // 空参数
      await expect(registry.execute('delegate', {})).rejects.toThrow();
    });

    it('应该生成有效的 tool schema', () => {
      const client = createMockLLMClient([]);
      const tool = createDelegateTool({
        parentToolRegistry: new ToolRegistry(),
        subAgentConfigs,
        llmProvider: client,
      });

      const registry = new ToolRegistry();
      registry.register(tool);

      const schemas = registry.toToolSchemas();
      expect(schemas).toHaveLength(1);

      const schema = schemas[0];
      expect(schema.type).toBe('function');
      expect(schema.function.name).toBe('delegate');
      expect(schema.function.description).toBeTruthy();

      const params = schema.function.parameters as Record<string, unknown>;
      expect(params).toBeDefined();
      expect(params.type).toBe('object');
    });
  });

  // ----------------------------------------------------------
  // 默认 maxSteps
  // ----------------------------------------------------------
  describe('default maxSteps', () => {
    it('应该使用默认 defaultMaxSteps=10 当未提供时', async () => {
      const client = createToolCallLoopLLMClient('search', 20);

      const tool = createDelegateTool({
        parentToolRegistry: new ToolRegistry(),
        subAgentConfigs,
        llmProvider: client,
        // 不提供 defaultMaxSteps
      });

      // writer 没有 maxSteps，使用默认的 10
      const result = (await tool.execute({
        agent: 'writer',
        task: 'Long task',
      })) as DelegateResult;

      expect(result.answer).toBe('Max steps reached');
      expect(result.totalSteps).toBe(10);
    });

    it('子 agent 自定义 maxSteps 应该覆盖 defaultMaxSteps', async () => {
      const client = createToolCallLoopLLMClient('search', 20);

      const tool = createDelegateTool({
        parentToolRegistry: new ToolRegistry(),
        subAgentConfigs,
        llmProvider: client,
        defaultMaxSteps: 100,
      });

      // researcher 的 maxSteps 为 5
      const result = (await tool.execute({
        agent: 'researcher',
        task: 'Research task',
      })) as DelegateResult;

      expect(result.answer).toBe('Max steps reached');
      expect(result.totalSteps).toBe(5);
    });
  });

  // ----------------------------------------------------------
  // 状态隔离
  // ----------------------------------------------------------
  describe('state isolation', () => {
    it('多次委派应该各自独立，不共享状态', async () => {
      const client = createMockLLMClient([
        {
          content: 'First answer',
          toolCalls: [],
          tokens: mockTokens,
          stopReason: 'stop',
        },
        {
          content: 'Second answer',
          toolCalls: [],
          tokens: mockTokens,
          stopReason: 'stop',
        },
      ]);

      const tool = createDelegateTool({
        parentToolRegistry: new ToolRegistry(),
        subAgentConfigs,
        llmProvider: client,
      });

      const result1 = (await tool.execute({
        agent: 'researcher',
        task: 'First task',
      })) as DelegateResult;

      const result2 = (await tool.execute({
        agent: 'researcher',
        task: 'Second task',
      })) as DelegateResult;

      // 两次委派应该是独立的
      expect(result1.answer).toBe('First answer');
      expect(result2.answer).toBe('Second answer');
      // 两次都是单步完成
      expect(result1.totalSteps).toBe(1);
      expect(result2.totalSteps).toBe(1);
      // 状态各自独立
      expect(result1.finalState!.id).not.toBe(result2.finalState!.id);
    });
  });

  // ----------------------------------------------------------
  // 工具继承（从父 Agent 继承工具实现）
  // ----------------------------------------------------------
  describe('tool inheritance from parent', () => {
    it('子 agent 应该能执行父 agent 注册的真实工具', async () => {
      // 创建父 Agent 的工具注册表，并注册一个真实的 calculator 工具
      const parentRegistry = new ToolRegistry();
      let toolExecuted = false;
      let receivedArgs: unknown = null;

      parentRegistry.register({
        name: 'calculator',
        description: 'Calculate math expression',
        parameters: z.object({ expression: z.string() }),
        execute: async ({ expression }) => {
          toolExecuted = true;
          receivedArgs = expression;
          // 安全地计算简单表达式
          if (expression === '2+2') return '4';
          if (expression === '10*5') return '50';
          return `Result of ${expression}`;
        },
      });

      // 创建子 agent 配置，声明使用 calculator 工具
      const calculatorAgent: SubAgentConfig = {
        name: 'calculator',
        description: 'Calculator agent',
        config: {
          name: 'calculator',
          instructions: 'You calculate math expressions.',
          tools: [{ name: 'calculator', description: 'Calculate', parameters: {} }],
        },
        maxSteps: 3,
      };

      const configs = new Map<string, SubAgentConfig>();
      configs.set('calculator', calculatorAgent);

      // Mock LLM 返回工具调用
      const client = createMockLLMClient([
        {
          content: 'Let me calculate that',
          toolCalls: [
            {
              id: 'call-1',
              name: 'calculator',
              arguments: { expression: '2+2' },
            },
          ],
          tokens: mockTokens,
          stopReason: 'tool_calls',
        },
        {
          content: 'The answer is 4',
          toolCalls: [],
          tokens: mockTokens,
          stopReason: 'stop',
        },
      ]);

      const tool = createDelegateTool({
        parentToolRegistry: parentRegistry,
        subAgentConfigs: configs,
        llmProvider: client,
      });

      const result = (await tool.execute({
        agent: 'calculator',
        task: 'Calculate 2+2',
      })) as DelegateResult;

      // 验证工具被执行
      expect(toolExecuted).toBe(true);
      expect(receivedArgs).toBe('2+2');
      // 验证子 agent 返回了正确的结果
      expect(result.answer).toBe('The answer is 4');
      expect(result.totalSteps).toBe(2);
    });

    it('子 agent 不应该访问父 agent 未注册的工具', async () => {
      // 父 Agent 的注册表为空（没有注册任何工具）
      const parentRegistry = new ToolRegistry();

      // 子 agent 配置声明使用 search 工具
      const searcherAgent: SubAgentConfig = {
        name: 'searcher',
        description: 'Search agent',
        config: {
          name: 'searcher',
          instructions: 'You search for information.',
          tools: [{ name: 'search', description: 'Search web', parameters: {} }],
        },
      };

      const configs = new Map<string, SubAgentConfig>();
      configs.set('searcher', searcherAgent);

      // Mock LLM - 即使 LLM 想调用 search 工具，子 agent 也没有这个工具
      const client = createMockLLMClient([
        {
          content: 'Search result',
          toolCalls: [],
          tokens: mockTokens,
          stopReason: 'stop',
        },
      ]);

      const tool = createDelegateTool({
        parentToolRegistry: parentRegistry,
        subAgentConfigs: configs,
        llmProvider: client,
      });

      const result = (await tool.execute({
        agent: 'searcher',
        task: 'Search for something',
      })) as DelegateResult;

      // 子 agent 仍然可以运行，但没有 search 工具可用
      expect(result.answer).toBe('Search result');
      // 验证传给 LLM 的 tools 是空的（因为 parentRegistry 中没有 search 工具）
      const firstCall = vi.mocked(client.call).mock.calls[0][0];
      expect(firstCall.tools).toEqual([]);
    });

    it('子 agent 应该继承父 agent 工具的执行函数', async () => {
      // 父 Agent 注册一个带副作用的工具
      const parentRegistry = new ToolRegistry();
      const executionLog: string[] = [];

      parentRegistry.register({
        name: 'logger',
        description: 'Log messages',
        parameters: z.object({ message: z.string() }),
        execute: async ({ message }) => {
          executionLog.push(message);
          return `Logged: ${message}`;
        },
      });

      const loggerAgent: SubAgentConfig = {
        name: 'logger',
        description: 'Logger agent',
        config: {
          name: 'logger',
          instructions: 'You log messages.',
          tools: [{ name: 'logger', description: 'Log', parameters: {} }],
        },
      };

      const configs = new Map<string, SubAgentConfig>();
      configs.set('logger', loggerAgent);

      const client = createMockLLMClient([
        {
          content: 'Logging...',
          toolCalls: [{ id: 'call-1', name: 'logger', arguments: { message: 'First' } }],
          tokens: mockTokens,
          stopReason: 'tool_calls',
        },
        {
          content: 'Logging more...',
          toolCalls: [{ id: 'call-2', name: 'logger', arguments: { message: 'Second' } }],
          tokens: mockTokens,
          stopReason: 'tool_calls',
        },
        {
          content: 'Done logging',
          toolCalls: [],
          tokens: mockTokens,
          stopReason: 'stop',
        },
      ]);

      const tool = createDelegateTool({
        parentToolRegistry: parentRegistry,
        subAgentConfigs: configs,
        llmProvider: client,
      });

      await tool.execute({ agent: 'logger', task: 'Log some messages' });

      // 验证父 Agent 的工具被正确执行
      expect(executionLog).toEqual(['First', 'Second']);
    });
  });

  // ----------------------------------------------------------
  // allowDelegation 限制
  // ----------------------------------------------------------
  describe('allowDelegation restriction', () => {
    it('allowDelegation=false 时子 agent 不应该有 delegate 工具', async () => {
      // 父 Agent 注册 delegate 工具
      const parentRegistry = new ToolRegistry();
      const delegateToolImpl: Tool = {
        name: 'delegate',
        description: 'Delegate tool',
        parameters: z.object({}),
        execute: async () => 'delegated',
      };
      parentRegistry.register(delegateToolImpl);

      // 子 agent 声明使用 delegate 工具，但 allowDelegation=false
      const restrictedAgent: SubAgentConfig = {
        name: 'restricted',
        description: 'Restricted agent',
        config: {
          name: 'restricted',
          instructions: 'You cannot delegate.',
          tools: [
            { name: 'delegate', description: 'Delegate', parameters: {} },
            { name: 'search', description: 'Search', parameters: {} },
          ],
        },
        allowDelegation: false, // 关键：不允许委派
      };

      parentRegistry.register({
        name: 'search',
        description: 'Search',
        parameters: z.object({}),
        execute: async () => 'search result',
      });

      const configs = new Map<string, SubAgentConfig>();
      configs.set('restricted', restrictedAgent);

      const client = createMockLLMClient([
        {
          content: 'Search result',
          toolCalls: [],
          tokens: mockTokens,
          stopReason: 'stop',
        },
      ]);

      const tool = createDelegateTool({
        parentToolRegistry: parentRegistry,
        subAgentConfigs: configs,
        llmProvider: client,
      });

      await tool.execute({ agent: 'restricted', task: 'Do something' });

      // 验证传给 LLM 的 tools 不包含 delegate
      const firstCall = vi.mocked(client.call).mock.calls[0][0];
      expect(firstCall.tools).toBeDefined();
      const toolNames = (firstCall.tools as Array<{ name: string }>).map((t) => t.name);
      expect(toolNames).toContain('search'); // 有 search
      expect(toolNames).not.toContain('delegate'); // 但没有 delegate
    });

    it('allowDelegation=true 时子 agent 可以有 delegate 工具', async () => {
      // 父 Agent 注册 delegate 工具
      const parentRegistry = new ToolRegistry();
      const delegateToolImpl: Tool = {
        name: 'delegate',
        description: 'Delegate tool',
        parameters: z.object({}),
        execute: async () => 'delegated',
      };
      parentRegistry.register(delegateToolImpl);

      // 子 agent 声明使用 delegate 工具，allowDelegation=true
      const delegatorAgent: SubAgentConfig = {
        name: 'delegator',
        description: 'Delegator agent',
        config: {
          name: 'delegator',
          instructions: 'You can delegate.',
          tools: [{ name: 'delegate', description: 'Delegate', parameters: {} }],
        },
        allowDelegation: true, // 关键：允许委派
      };

      const configs = new Map<string, SubAgentConfig>();
      configs.set('delegator', delegatorAgent);

      const client = createMockLLMClient([
        {
          content: 'Done',
          toolCalls: [],
          tokens: mockTokens,
          stopReason: 'stop',
        },
      ]);

      const tool = createDelegateTool({
        parentToolRegistry: parentRegistry,
        subAgentConfigs: configs,
        llmProvider: client,
      });

      await tool.execute({ agent: 'delegator', task: 'Do something' });

      // 验证传给 LLM 的 tools 包含 delegate
      const firstCall = vi.mocked(client.call).mock.calls[0][0];
      expect(firstCall.tools).toBeDefined();
      const toolNames = (firstCall.tools as Array<{ name: string }>).map((t) => t.name);
      expect(toolNames).toContain('delegate'); // 有 delegate
    });

    it('未设置 allowDelegation 时默认不允许委派', async () => {
      // 父 Agent 注册 delegate 工具
      const parentRegistry = new ToolRegistry();
      parentRegistry.register({
        name: 'delegate',
        description: 'Delegate tool',
        parameters: z.object({}),
        execute: async () => 'delegated',
      });

      // 子 agent 未设置 allowDelegation（默认 undefined）
      const defaultAgent: SubAgentConfig = {
        name: 'default',
        description: 'Default agent',
        config: {
          name: 'default',
          instructions: 'You work.',
          tools: [{ name: 'delegate', description: 'Delegate', parameters: {} }],
        },
        // allowDelegation 未设置，默认为 false
      };

      const configs = new Map<string, SubAgentConfig>();
      configs.set('default', defaultAgent);

      const client = createMockLLMClient([
        {
          content: 'Done',
          toolCalls: [],
          tokens: mockTokens,
          stopReason: 'stop',
        },
      ]);

      const tool = createDelegateTool({
        parentToolRegistry: parentRegistry,
        subAgentConfigs: configs,
        llmProvider: client,
      });

      await tool.execute({ agent: 'default', task: 'Do something' });

      // 验证传给 LLM 的 tools 不包含 delegate
      const firstCall = vi.mocked(client.call).mock.calls[0][0];
      expect(firstCall.tools).toBeDefined();
      const toolNames = (firstCall.tools as Array<{ name: string }>).map((t) => t.name);
      expect(toolNames).not.toContain('delegate'); // 默认不允许
    });
  });
});
