/**
 * runner-setup.ts unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRunnerFromConfig, createInitialStateFromConfig } from '../../src/runner-setup.js';
import type { AppConfig } from '../../src/config.js';

// Capture the options passed to AgentRunner constructor
let capturedOptions: unknown = null;

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
    skillDirectories: ['./skills', '/absolute/skills'],
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

    it('should pass skillDirectories to runner options', () => {
      createRunnerFromConfig(validConfig);
      expect((capturedOptions as Record<string, unknown>).skillDirectories).toEqual([
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
      expect((capturedOptions as Record<string, unknown>).skillDirectories).toBeUndefined();
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
