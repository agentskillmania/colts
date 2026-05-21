/**
 * runner-setup.ts unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRunnerFromConfig, createInitialStateFromConfig } from '../../src/runner-setup.js';
import type { AppConfig } from '../../src/config.js';

// Capture the options passed to AgentRunner constructor
let capturedOptions: unknown = null;
let capturedConfirmableOptions: Array<{ confirm: (...args: unknown[]) => unknown }> = [];

vi.mock('@agentskillmania/colts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentskillmania/colts')>();
  return {
    ...actual,
    AgentRunner: vi.fn().mockImplementation((options: unknown) => {
      capturedOptions = options;
      return {
        registerTool: vi.fn(),
      };
    }),
    ConfirmableRegistry: vi.fn().mockImplementation((inner, options) => {
      capturedConfirmableOptions.push(options);
      return {
        execute: vi.fn(),
        register: vi.fn(),
        getTool: vi.fn(),
        listTools: vi.fn(),
        getToolSchema: vi.fn(),
        getToolSchemaFormatter: vi.fn(),
        setToolSchemaFormatter: vi.fn(),
      };
    }),
  };
});

describe('runner-setup', () => {
  beforeEach(() => {
    capturedOptions = null;
  });

  const validConfig: AppConfig = {
    hasValidConfig: true,
    configPath: '/tmp/test.yaml',
    llm: {
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4',
      baseUrl: 'https://api.openai.com/v1',
      thinkingEnabled: true,
      enablePromptThinking: false,
      maxConcurrency: 10,
    },
    agent: {
      name: 'test-agent',
      instructions: 'Test instructions',
    },
    maxSteps: 50,
    requestTimeout: 60000,
    skillDirs: ['./skills', '/absolute/skills'],
    subAgents: [
      {
        name: 'research-agent',
        description: 'Research assistant',
        config: {
          name: 'research-agent',
          instructions: 'You are a research assistant.',
          tools: [{ name: 'web_search', description: 'Search the web' }],
        },
        maxSteps: 10,
        allowDelegation: false,
      },
    ],
    confirmTools: ['dangerous_tool'],
  };

  describe('createRunnerFromConfig', () => {
    it('should return null for invalid config', () => {
      const invalidConfig: AppConfig = {
        hasValidConfig: false,
        configPath: '/tmp/test.yaml',
      };
      expect(createRunnerFromConfig(invalidConfig)).toBeNull();
    });

    it('should return null when llm is missing', () => {
      const noLlmConfig: AppConfig = {
        hasValidConfig: true,
        configPath: '/tmp/test.yaml',
      };
      expect(createRunnerFromConfig(noLlmConfig)).toBeNull();
    });

    it('should pass model to runner options', () => {
      createRunnerFromConfig(validConfig);
      expect((capturedOptions as Record<string, unknown>).model).toBe('gpt-4');
    });

    it('should pass llm config with apiKey, provider, baseUrl, maxConcurrency', () => {
      createRunnerFromConfig(validConfig);
      const llm = (capturedOptions as Record<string, unknown>).llm as Record<string, unknown>;
      expect(llm.apiKey).toBe('sk-test');
      expect(llm.provider).toBe('openai');
      expect(llm.baseUrl).toBe('https://api.openai.com/v1');
      expect(llm.maxConcurrency).toBe(10);
    });

    it('should pass skillDirs to runner options', () => {
      createRunnerFromConfig(validConfig);
      expect((capturedOptions as Record<string, unknown>).skillDirs).toEqual([
        './skills',
        '/absolute/skills',
      ]);
    });

    it('should pass subAgents to runner options', () => {
      createRunnerFromConfig(validConfig);
      const subAgents = (capturedOptions as Record<string, unknown>).subAgents as Array<{
        name: string;
      }>;
      expect(subAgents).toHaveLength(1);
      expect(subAgents[0].name).toBe('research-agent');
    });

    it('should pass thinkingEnabled to runner options', () => {
      createRunnerFromConfig(validConfig);
      expect((capturedOptions as Record<string, unknown>).thinkingEnabled).toBe(true);
    });

    it('should pass enablePromptThinking to runner options', () => {
      createRunnerFromConfig(validConfig);
      expect((capturedOptions as Record<string, unknown>).enablePromptThinking).toBe(false);
    });

    it('should pass maxSteps and requestTimeout', () => {
      createRunnerFromConfig(validConfig);
      expect((capturedOptions as Record<string, unknown>).maxSteps).toBe(50);
      expect((capturedOptions as Record<string, unknown>).requestTimeout).toBe(60000);
    });

    it('should pass custom confirm callback to ConfirmableRegistry', async () => {
      const callbacks = { askHuman: vi.fn(), confirm: vi.fn().mockResolvedValue(true) };
      createRunnerFromConfig(validConfig, callbacks);

      const registryOpts = capturedConfirmableOptions[capturedConfirmableOptions.length - 1];
      await registryOpts.confirm('dangerous_tool', { x: 1 });
      expect(callbacks.confirm).toHaveBeenCalledWith('dangerous_tool', { x: 1 });
    });

    it('should isolate callbacks between instances', async () => {
      capturedConfirmableOptions = [];
      const callbacksA = { askHuman: vi.fn(), confirm: vi.fn().mockResolvedValue(true) };
      const callbacksB = { askHuman: vi.fn(), confirm: vi.fn().mockResolvedValue(false) };

      createRunnerFromConfig(validConfig, callbacksA);
      createRunnerFromConfig(validConfig, callbacksB);

      expect(capturedConfirmableOptions).toHaveLength(2);
      await capturedConfirmableOptions[0].confirm('tool', {});
      await capturedConfirmableOptions[1].confirm('tool', {});

      expect(callbacksA.confirm).toHaveBeenCalledTimes(1);
      expect(callbacksB.confirm).toHaveBeenCalledTimes(1);
    });

    it('should handle undefined optional fields gracefully', () => {
      const minimalConfig: AppConfig = {
        hasValidConfig: true,
        configPath: '/tmp/test.yaml',
        llm: {
          provider: 'openai',
          apiKey: 'sk-test',
          model: 'gpt-4',
        },
      };
      const runner = createRunnerFromConfig(minimalConfig);
      expect(runner).not.toBeNull();
      expect((capturedOptions as Record<string, unknown>).skillDirs).toBeUndefined();
      expect((capturedOptions as Record<string, unknown>).subAgents).toBeUndefined();
      expect((capturedOptions as Record<string, unknown>).thinkingEnabled).toBeUndefined();
      expect((capturedOptions as Record<string, unknown>).enablePromptThinking).toBeUndefined();
    });
  });

  describe('createInitialStateFromConfig', () => {
    it('should return null for invalid config', () => {
      const invalidConfig: AppConfig = {
        hasValidConfig: false,
        configPath: '/tmp/test.yaml',
      };
      expect(createInitialStateFromConfig(invalidConfig)).toBeNull();
    });

    it('should return null when llm is missing', () => {
      const noLlmConfig: AppConfig = {
        hasValidConfig: true,
        configPath: '/tmp/test.yaml',
      };
      expect(createInitialStateFromConfig(noLlmConfig)).toBeNull();
    });

    it('should create state with agent name and instructions', () => {
      const state = createInitialStateFromConfig(validConfig);
      expect(state).not.toBeNull();
      expect(state!.config.name).toBe('test-agent');
    });

    it('should use default name and instructions when agent is not provided', () => {
      const noAgentConfig: AppConfig = {
        hasValidConfig: true,
        configPath: '/tmp/test.yaml',
        llm: {
          provider: 'openai',
          apiKey: 'sk-test',
          model: 'gpt-4',
        },
      };
      const state = createInitialStateFromConfig(noAgentConfig);
      expect(state).not.toBeNull();
      expect(state!.config.name).toBe('colts-agent');
    });
  });
});
