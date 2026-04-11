/**
 * @fileoverview User Story: Runner Configuration and Dependency Inversion
 *
 * As a developer
 * I want to configure the AgentRunner with different initialization patterns
 * So that I can use it flexibly in production, testing, and prototyping scenarios
 *
 * Acceptance Criteria:
 * 1. Can inject existing LLMClient and ToolRegistry (production mode)
 * 2. Can use quick initialization with llm config and tools array (prototyping mode)
 * 3. Can mix injection and quick initialization (hybrid mode)
 * 4. ConfigurationError is thrown for invalid configurations
 * 5. Can dynamically register and unregister tools at runtime
 * 6. maxSteps configuration follows the hierarchy: run param > RunnerOptions > default
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { LLMClient } from '@agentskillmania/llm-client';
import { testConfig, itif } from './config.js';
import { AgentRunner, ConfigurationError, ToolRegistry, calculatorTool } from '../../src/index.js';
import { createAgentState } from '../../src/state.js';
import type { AgentConfig } from '../../src/types.js';
import { z } from 'zod';

describe('User Story: Runner Configuration and Dependency Inversion', () => {
  let existingClient: LLMClient;
  let existingRegistry: ToolRegistry;

  beforeAll(() => {
    if (testConfig.enabled) {
      existingClient = new LLMClient({
        baseUrl: testConfig.baseUrl,
      });
      existingClient.registerProvider({
        name: testConfig.provider,
        maxConcurrency: 5,
      });
      existingClient.registerApiKey({
        key: testConfig.apiKey,
        provider: testConfig.provider,
        maxConcurrency: 3,
        models: [
          {
            modelId: testConfig.testModel,
            maxConcurrency: 2,
          },
        ],
      });

      existingRegistry = new ToolRegistry();
      existingRegistry.register(calculatorTool);
    }
  });

  const defaultConfig: AgentConfig = {
    name: 'TestAgent',
    instructions: 'You are a helpful assistant. Use tools when needed.',
    tools: [],
  };

  describe('Scenario 1: Full Injection Mode', () => {
    itif(testConfig.enabled)(
      'should accept injected LLMClient and ToolRegistry',
      async () => {
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: existingClient,
          toolRegistry: existingRegistry,
        });

        const state = createAgentState(defaultConfig);
        const { state: newState, response } = await runner.chat(state, 'What is 2+2?');

        // ChatResult doesn't have 'type' field, check response instead
        expect(response).toBeTruthy();
        expect(response.length).toBeGreaterThan(0);
        expect(newState.context.messages).toHaveLength(2);
      },
      30000
    );

    itif(testConfig.enabled)(
      'should use only injected dependencies without quick init',
      async () => {
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: existingClient,
        });

        const state = createAgentState(defaultConfig);
        const { result } = await runner.run(state, { maxSteps: 1 });

        expect(result.type).toBe('success');
      },
      30000
    );
  });

  describe('Scenario 2: Quick Initialization Mode', () => {
    itif(testConfig.enabled)(
      'should create LLMClient from quick init config',
      async () => {
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llm: {
            apiKey: testConfig.apiKey,
            provider: testConfig.provider,
            baseUrl: testConfig.baseUrl,
            maxConcurrency: 3,
          },
        });

        const state = createAgentState(defaultConfig);
        const { state: newState, response } = await runner.chat(state, 'Hello!');

        expect(response).toBeTruthy();
        expect(response.length).toBeGreaterThan(0);
        expect(newState.context.messages).toHaveLength(2);
      },
      30000
    );

    itif(testConfig.enabled)('should create ToolRegistry from tools array', async () => {
      const customTool = {
        name: 'greet',
        description: 'Greet someone by name',
        parameters: z.object({ name: z.string() }),
        execute: async ({ name }: { name: string }) => `Hello, ${name}!`,
      };

      const runner = new AgentRunner({
        model: testConfig.testModel,
        llmClient: existingClient,
        tools: [customTool],
      });

      const registry = runner.getToolRegistry();
      expect(registry.has('greet')).toBe(true);
      expect(registry.has('calculator')).toBe(false);
    });

    itif(testConfig.enabled)(
      'should work with both llm and tools quick init',
      async () => {
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llm: {
            apiKey: testConfig.apiKey,
            provider: testConfig.provider,
            baseUrl: testConfig.baseUrl,
          },
          tools: [calculatorTool],
        });

        const state = createAgentState({
          ...defaultConfig,
          instructions: 'Use calculator tool for math.',
        });
        const { result } = await runner.step(state);

        expect(result).toBeDefined();
      },
      30000
    );
  });

  describe('Scenario 3: Hybrid Mode', () => {
    itif(testConfig.enabled)('should merge injected registry with quick init tools', async () => {
      const customTool = {
        name: 'reverse',
        description: 'Reverse a string',
        parameters: z.object({ text: z.string() }),
        execute: async ({ text }: { text: string }) => text.split('').reverse().join(''),
      };

      const runner = new AgentRunner({
        model: testConfig.testModel,
        llmClient: existingClient,
        toolRegistry: existingRegistry,
        tools: [customTool],
      });

      const registry = runner.getToolRegistry();
      expect(registry.has('calculate')).toBe(true);
      expect(registry.has('reverse')).toBe(true);
    });

    itif(testConfig.enabled)('should work when only tools are provided', async () => {
      const runner = new AgentRunner({
        model: testConfig.testModel,
        llmClient: existingClient,
        tools: [calculatorTool],
      });

      const registry = runner.getToolRegistry();
      expect(registry.has('calculate')).toBe(true);
    });
  });

  describe('Scenario 4: Configuration Error Handling', () => {
    it('should throw ConfigurationError when both llmClient and llm are provided', () => {
      // 创建一个独立的 mock LLMClient，不依赖集成测试配置
      const mockClient = new LLMClient({ baseUrl: 'http://localhost:8080' });

      expect(() => {
        new AgentRunner({
          model: 'gpt-4',
          llmClient: mockClient,
          llm: {
            apiKey: 'test-key',
          },
        });
      }).toThrow(ConfigurationError);

      expect(() => {
        new AgentRunner({
          model: 'gpt-4',
          llmClient: mockClient,
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
      }).toThrow(ConfigurationError);

      expect(() => {
        new AgentRunner({
          model: 'gpt-4',
        } as any);
      }).toThrow('Must specify either llmClient or llm');
    });
  });

  describe('Scenario 5: Runtime Tool Management', () => {
    itif(testConfig.enabled)('should register tools at runtime', async () => {
      const runner = new AgentRunner({
        model: testConfig.testModel,
        llmClient: existingClient,
      });

      const newTool = {
        name: 'double',
        description: 'Double a number',
        parameters: z.object({ n: z.number() }),
        execute: async ({ n }: { n: number }) => n * 2,
      };
      runner.registerTool(newTool);

      const registry = runner.getToolRegistry();
      expect(registry.has('double')).toBe(true);

      const result = await registry.execute('double', { n: 5 });
      expect(result).toBe(10);
    });

    itif(testConfig.enabled)('should unregister tools at runtime', async () => {
      const runner = new AgentRunner({
        model: testConfig.testModel,
        llmClient: existingClient,
        tools: [calculatorTool],
      });

      expect(runner.getToolRegistry().has('calculate')).toBe(true);

      const removed = runner.unregisterTool('calculate');

      expect(removed).toBe(true);
      expect(runner.getToolRegistry().has('calculate')).toBe(false);
    });

    itif(testConfig.enabled)(
      'should return false when unregistering non-existent tool',
      async () => {
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: existingClient,
        });

        const removed = runner.unregisterTool('nonexistent');

        expect(removed).toBe(false);
      }
    );
  });

  describe('Scenario 6: maxSteps Configuration Hierarchy', () => {
    itif(testConfig.enabled)(
      'should use run() parameter maxSteps over RunnerOptions',
      async () => {
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: existingClient,
          maxSteps: 5,
        });

        const state = createAgentState(defaultConfig);
        const { result } = await runner.run(state, { maxSteps: 1 });

        // Note: When maxSteps=1, LLM might answer directly (success) or hit limit (max_steps)
        // We verify that maxSteps is respected by checking totalSteps <= maxSteps
        expect(result.totalSteps).toBeLessThanOrEqual(1);
      },
      30000
    );

    itif(testConfig.enabled)(
      'should use RunnerOptions maxSteps over default',
      async () => {
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: existingClient,
          maxSteps: 1,
        });

        const state = createAgentState(defaultConfig);
        const { result } = await runner.run(state);

        // Note: When maxSteps=1, LLM might answer directly (success) or hit limit (max_steps)
        // We verify that maxSteps is respected by checking totalSteps <= maxSteps
        expect(result.totalSteps).toBeLessThanOrEqual(1);
      },
      30000
    );

    itif(testConfig.enabled)(
      'should use default maxSteps when not configured',
      async () => {
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: existingClient,
        });

        const state = createAgentState(defaultConfig);
        const { result } = await runner.run(state);

        expect(result.type).toBe('success');
      },
      30000
    );
  });

  describe('Scenario 7: Interface Compliance', () => {
    itif(testConfig.enabled)('should expose LLM provider through getLLMProvider()', async () => {
      const runner = new AgentRunner({
        model: testConfig.testModel,
        llmClient: existingClient,
      });

      const provider = runner.getLLMProvider();

      expect(provider).toBeDefined();
      expect(typeof provider.call).toBe('function');
      expect(typeof provider.stream).toBe('function');
    });

    itif(testConfig.enabled)('should expose tool registry through getToolRegistry()', async () => {
      const runner = new AgentRunner({
        model: testConfig.testModel,
        llmClient: existingClient,
        toolRegistry: existingRegistry,
      });

      const registry = runner.getToolRegistry();

      expect(registry).toBeDefined();
      expect(typeof registry.execute).toBe('function');
      expect(typeof registry.toToolSchemas).toBe('function');
    });
  });
});
