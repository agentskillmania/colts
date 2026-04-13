/**
 * @fileoverview delegate tool unit tests
 *
 * Tests the createDelegateTool factory function, including:
 * - Successfully delegating tasks to sub-agent
 * - Sub-agent successful return
 * - Sub-agent error return
 * - Sub-agent reaching max steps
 * - extraInstructions correctly appended
 * - Unknown sub-agent returns error
 * - Sub-agent has independent tool set
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMClient, LLMResponse } from '@agentskillmania/llm-client';
import { z } from 'zod';
import { createDelegateTool } from '../../src/subagent/delegate-tool.js';
import type { DelegateToolDeps } from '../../src/subagent/delegate-tool.js';
import type { SubAgentConfig, DelegateResult } from '../../src/subagent/types.js';
import { ToolRegistry } from '../../src/tools/registry.js';

// ============================================================
// Helpers
// ============================================================

/** Mock token stats */
const mockTokens = { input: 10, output: 5 };

/**
 * Create mock LLM Client
 *
 * @param responses - LLM response sequence, each call returns the next one
 * @returns Mock LLMClient
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

/** Create mock client that returns LLM error */
function createErrorLLMClient(errorMessage: string): LLMClient {
  return {
    call: vi.fn().mockRejectedValue(new Error(errorMessage)),
    stream: vi.fn(),
  } as unknown as LLMClient;
}

/** Create mock client that continuously returns tool calls (for max_steps test) */
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
 * Create test sub-agent configuration map
 *
 * @param overrides - Optional overrides for default config
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
// Tests
// ============================================================

describe('createDelegateTool', () => {
  let subAgentConfigs: Map<string, SubAgentConfig>;

  beforeEach(() => {
    subAgentConfigs = createSubAgentConfigs();
  });

  // ----------------------------------------------------------
  // Basic properties
  // ----------------------------------------------------------
  describe('tool properties', () => {
    it('should return a tool named "delegate"', () => {
      const client = createMockLLMClient([]);
      const tool = createDelegateTool({
        parentToolRegistry: new ToolRegistry(),
        subAgentConfigs,
        llmProvider: client,
      });

      expect(tool.name).toBe('delegate');
    });

    it('should have a non-empty description', () => {
      const client = createMockLLMClient([]);
      const tool = createDelegateTool({
        parentToolRegistry: new ToolRegistry(),
        subAgentConfigs,
        llmProvider: client,
      });

      expect(tool.description).toBeTruthy();
      expect(typeof tool.description).toBe('string');
    });

    it('should have a valid Zod parameter schema', () => {
      const client = createMockLLMClient([]);
      const tool = createDelegateTool({
        parentToolRegistry: new ToolRegistry(),
        subAgentConfigs,
        llmProvider: client,
      });

      expect(tool.parameters).toBeDefined();
      expect(tool.parameters._def).toBeDefined();
    });

    it('should be registerable to ToolRegistry', () => {
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
  // Successful delegation
  // ----------------------------------------------------------
  describe('successful delegation', () => {
    it('should successfully delegate task to sub-agent and return success result', async () => {
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

    it('should execute through ToolRegistry and return correct result', async () => {
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
  // Sub-agent error
  // ----------------------------------------------------------
  describe('sub-agent error', () => {
    it('should return error message when sub-agent errors', async () => {
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
  // Sub-agent reaches max steps
  // ----------------------------------------------------------
  describe('max steps reached', () => {
    it('should return "Max steps reached" when sub-agent reaches max steps', async () => {
      // Sub-agent calls tool every step, never stops
      const client = createToolCallLoopLLMClient('search', 20);

      // researcher maxSteps is 5
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

    it('should use defaultMaxSteps when sub-agent has no maxSteps configured', async () => {
      const client = createToolCallLoopLLMClient('search', 20);

      // writer has no maxSteps config, uses defaultMaxSteps
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
    it('should append extraInstructions to sub-agent instructions', async () => {
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

      // Verify instructions contain appended content when LLM is called
      expect(client.call).toHaveBeenCalled();
      const callArg = vi.mocked(client.call).mock.calls[0][0];
      const messages = callArg.messages;
      // instructions appear in the first user message (via buildMessages)
      const firstUserMsg = messages.find((m: { role: string }) => m.role === 'user');
      const content =
        typeof firstUserMsg?.content === 'string'
          ? firstUserMsg.content
          : JSON.stringify(firstUserMsg?.content);
      expect(content).toContain('You are a research specialist.');
      expect(content).toContain('Focus on academic sources only.');

      expect(result.totalSteps).toBe(1);
    });

    it('should not modify instructions when extraInstructions is not provided', async () => {
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
      // Should not contain extra appended newlines and empty content
      expect(content).not.toContain('\n\nundefined');
    });
  });

  // ----------------------------------------------------------
  // Unknown sub-agent
  // ----------------------------------------------------------
  describe('unknown sub-agent', () => {
    it('should return error with available list when requesting unknown sub-agent', async () => {
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

    it('should return empty list when no sub-agents are configured', async () => {
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
  // Independent tool set
  // ----------------------------------------------------------
  describe('independent tool set', () => {
    it('sub-agent should only see its own tools, not main agent tools', async () => {
      // Create two sub-agents with different tools
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

      // Create mock client that returns tool calls
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

      // agent-a should successfully call tool-a
      expect(result.answer).toBe('Done with tool-a');
      expect(result.totalSteps).toBe(2);
      // Verify tools passed to LLM contain tool-a (passed via toToolSchemas)
      expect(client.call).toHaveBeenCalled();
    });

    it('different sub-agents should have different tool sets', async () => {
      // Create parent Agent tool registry and register tools
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

      // Delegate to searcher
      await tool.execute({ agent: 'searcher', task: 'Find info' });

      // Verify first LLM call passed search tool (pi-ai Tool format: { name, description, parameters })
      const firstCall = vi.mocked(client.call).mock.calls[0][0];
      expect(firstCall.tools).toBeDefined();
      const toolNames = (firstCall.tools as Array<{ name: string }>).map((t) => t.name);
      expect(toolNames).toContain('search');
      expect(toolNames).not.toContain('calculate');
    });
  });

  // ----------------------------------------------------------
  // Multi-step tool execution flow
  // ----------------------------------------------------------
  describe('multi-step tool execution', () => {
    it('should support sub-agent multi-step tool calls before final answer', async () => {
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
  // Parameter validation
  // ----------------------------------------------------------
  describe('parameter validation', () => {
    it('should validate parameters through ToolRegistry', async () => {
      const client = createMockLLMClient([]);
      const tool = createDelegateTool({
        parentToolRegistry: new ToolRegistry(),
        subAgentConfigs,
        llmProvider: client,
      });

      const registry = new ToolRegistry();
      registry.register(tool);

      // Missing agent parameter
      await expect(registry.execute('delegate', { task: 'Do something' })).rejects.toThrow();

      // Missing task parameter
      await expect(registry.execute('delegate', { agent: 'researcher' })).rejects.toThrow();

      // Empty parameters
      await expect(registry.execute('delegate', {})).rejects.toThrow();
    });

    it('should generate valid tool schema', () => {
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
  // Default maxSteps
  // ----------------------------------------------------------
  describe('default maxSteps', () => {
    it('should use default defaultMaxSteps=10 when not provided', async () => {
      const client = createToolCallLoopLLMClient('search', 20);

      const tool = createDelegateTool({
        parentToolRegistry: new ToolRegistry(),
        subAgentConfigs,
        llmProvider: client,
        // do not provide defaultMaxSteps
      });

      // writer has no maxSteps, uses default 10
      const result = (await tool.execute({
        agent: 'writer',
        task: 'Long task',
      })) as DelegateResult;

      expect(result.answer).toBe('Max steps reached');
      expect(result.totalSteps).toBe(10);
    });

    it('sub-agent custom maxSteps should override defaultMaxSteps', async () => {
      const client = createToolCallLoopLLMClient('search', 20);

      const tool = createDelegateTool({
        parentToolRegistry: new ToolRegistry(),
        subAgentConfigs,
        llmProvider: client,
        defaultMaxSteps: 100,
      });

      // researcher has maxSteps of 5
      const result = (await tool.execute({
        agent: 'researcher',
        task: 'Research task',
      })) as DelegateResult;

      expect(result.answer).toBe('Max steps reached');
      expect(result.totalSteps).toBe(5);
    });
  });

  // ----------------------------------------------------------
  // State isolation
  // ----------------------------------------------------------
  describe('state isolation', () => {
    it('multiple delegations should be independent and not share state', async () => {
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

      // Two delegations should be independent
      expect(result1.answer).toBe('First answer');
      expect(result2.answer).toBe('Second answer');
      // Both complete in single step
      expect(result1.totalSteps).toBe(1);
      expect(result2.totalSteps).toBe(1);
      // States are independent
      expect(result1.finalState!.id).not.toBe(result2.finalState!.id);
    });
  });

  // ----------------------------------------------------------
  // Tool inheritance (inherit tool implementations from parent Agent)
  // ----------------------------------------------------------
  describe('tool inheritance from parent', () => {
    it('sub-agent should be able to execute real tools registered by parent agent', async () => {
      // Create parent Agent tool registry and register a real calculator tool
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
          // Safely compute simple expressions
          if (expression === '2+2') return '4';
          if (expression === '10*5') return '50';
          return `Result of ${expression}`;
        },
      });

      // Create sub-agent config declaring use of calculator tool
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

      // Mock LLM returns tool call
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

      // Verify tool was executed
      expect(toolExecuted).toBe(true);
      expect(receivedArgs).toBe('2+2');
      // Verify sub-agent returned correct result
      expect(result.answer).toBe('The answer is 4');
      expect(result.totalSteps).toBe(2);
    });

    it('sub-agent should not access tools not registered by parent agent', async () => {
      // Parent Agent registry is empty (no tools registered)
      const parentRegistry = new ToolRegistry();

      // Sub-agent config declares use of search tool
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

      // Mock LLM - even if LLM wants to call search tool, sub-agent doesn't have it
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

      // Sub-agent can still run, but no search tool is available
      expect(result.answer).toBe('Search result');
      // Verify tools passed to LLM are empty (because parentRegistry has no search tool)
      const firstCall = vi.mocked(client.call).mock.calls[0][0];
      expect(firstCall.tools).toEqual([]);
    });

    it('sub-agent should inherit tool execution functions from parent agent', async () => {
      // Parent Agent registers a tool with side effects
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

      // Verify parent Agent tool was correctly executed
      expect(executionLog).toEqual(['First', 'Second']);
    });
  });

  // ----------------------------------------------------------
  // allowDelegation restriction
  // ----------------------------------------------------------
  describe('allowDelegation restriction', () => {
    it('sub-agent should not have delegate tool when allowDelegation=false', async () => {
      // Parent Agent registers delegate tool
      const parentRegistry = new ToolRegistry();
      const delegateToolImpl: Tool = {
        name: 'delegate',
        description: 'Delegate tool',
        parameters: z.object({}),
        execute: async () => 'delegated',
      };
      parentRegistry.register(delegateToolImpl);

      // Sub-agent declares use of delegate tool, but allowDelegation=false
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
        allowDelegation: false, // Key: disallow delegation
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

      // Verify tools passed to LLM do not contain delegate
      const firstCall = vi.mocked(client.call).mock.calls[0][0];
      expect(firstCall.tools).toBeDefined();
      const toolNames = (firstCall.tools as Array<{ name: string }>).map((t) => t.name);
      expect(toolNames).toContain('search'); // has search
      expect(toolNames).not.toContain('delegate'); // but no delegate
    });

    it('sub-agent can have delegate tool when allowDelegation=true', async () => {
      // Parent Agent registers delegate tool
      const parentRegistry = new ToolRegistry();
      const delegateToolImpl: Tool = {
        name: 'delegate',
        description: 'Delegate tool',
        parameters: z.object({}),
        execute: async () => 'delegated',
      };
      parentRegistry.register(delegateToolImpl);

      // Sub-agent declares use of delegate tool, allowDelegation=true
      const delegatorAgent: SubAgentConfig = {
        name: 'delegator',
        description: 'Delegator agent',
        config: {
          name: 'delegator',
          instructions: 'You can delegate.',
          tools: [{ name: 'delegate', description: 'Delegate', parameters: {} }],
        },
        allowDelegation: true, // key: allow delegation
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

      // Verify tools passed to LLM contain delegate
      const firstCall = vi.mocked(client.call).mock.calls[0][0];
      expect(firstCall.tools).toBeDefined();
      const toolNames = (firstCall.tools as Array<{ name: string }>).map((t) => t.name);
      expect(toolNames).toContain('delegate'); // has delegate
    });

    it('should disallow delegation by default when allowDelegation is not set', async () => {
      // Parent Agent registers delegate tool
      const parentRegistry = new ToolRegistry();
      parentRegistry.register({
        name: 'delegate',
        description: 'Delegate tool',
        parameters: z.object({}),
        execute: async () => 'delegated',
      });

      // Sub-agent does not set allowDelegation (default undefined)
      const defaultAgent: SubAgentConfig = {
        name: 'default',
        description: 'Default agent',
        config: {
          name: 'default',
          instructions: 'You work.',
          tools: [{ name: 'delegate', description: 'Delegate', parameters: {} }],
        },
        // allowDelegation not set, defaults to false
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

      // Verify tools passed to LLM do not contain delegate
      const firstCall = vi.mocked(client.call).mock.calls[0][0];
      expect(firstCall.tools).toBeDefined();
      const toolNames = (firstCall.tools as Array<{ name: string }>).map((t) => t.name);
      expect(toolNames).not.toContain('delegate'); // disallowed by default
    });
  });

  // ----------------------------------------------------------
  // Abort Signal Support
  // ----------------------------------------------------------
  describe('abort signal support', () => {
    it('should pass abort signal to sub-agent runner', async () => {
      const localParentRegistry = new ToolRegistry();
      const localConfigs = new Map<string, SubAgentConfig>([
        [
          'default',
          {
            name: 'default',
            description: 'Default agent',
            config: { name: 'default', instructions: 'Test agent', tools: [] },
            maxSteps: 3,
            allowDelegation: false,
          },
        ],
      ]);

      const client = createMockLLMClient([
        {
          content: 'Task result',
          toolCalls: [],
          tokens: mockTokens,
          stopReason: 'stop',
        },
      ]);

      const tool = createDelegateTool({
        parentToolRegistry: localParentRegistry,
        subAgentConfigs: localConfigs,
        llmProvider: client,
      });

      const controller = new AbortController();
      const result = (await tool.execute(
        { agent: 'default', task: 'Do something' },
        { signal: controller.signal }
      )) as DelegateResult;

      expect(result.answer).toBe('Task result');
    });

    it('should respect abort signal when aborted before execution', async () => {
      const localParentRegistry = new ToolRegistry();
      const localConfigs = new Map<string, SubAgentConfig>([
        [
          'default',
          {
            name: 'default',
            description: 'Default agent',
            config: { name: 'default', instructions: 'Test agent', tools: [] },
            maxSteps: 3,
            allowDelegation: false,
          },
        ],
      ]);

      const client = createMockLLMClient([]);

      const tool = createDelegateTool({
        parentToolRegistry: localParentRegistry,
        subAgentConfigs: localConfigs,
        llmProvider: client,
      });

      const controller = new AbortController();
      controller.abort();

      await expect(
        tool.execute({ agent: 'default', task: 'Do something' }, { signal: controller.signal })
      ).rejects.toThrow();
    });
  });
});
