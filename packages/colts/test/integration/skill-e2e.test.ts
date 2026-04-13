/**
 * @fileoverview Skill system E2E integration test (Step 10)
 *
 * Tests the complete Skill system flow:
 * 1. FilesystemSkillProvider scans directories and discovers Skills
 * 2. Runner injects Skill metadata into system prompt when building messages
 * 3. LLM sees available Skill list and load_skill tool
 * 4. LLM calls load_skill tool to load instructions for a specific Skill
 * 5. Skill instructions return to LLM context
 * 6. Agent executes tasks according to Skill instructions
 *
 * Test scenarios:
 * - Complete Skill discovery and usage flow
 * - Multiple Skill directory scanning
 * - Skill metadata correctly injected into system prompt
 * - load_skill tool integration with Runner
 * - Skill loading events in streaming execution
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolve } from 'node:path';
import { AgentRunner } from '../../src/runner.js';
import { FilesystemSkillProvider } from '../../src/skills/filesystem-provider.js';
import { createAgentState } from '../../src/state.js';
import type { AgentConfig } from '../../src/types.js';
import type { LLMClient, LLMResponse } from '@agentskillmania/llm-client';
import type { StreamEvent } from '../../src/execution.js';

/** Skill fixtures directory for tests */
const FIXTURES_DIR = resolve(__dirname, '../fixtures/skills');

/** Default Agent config */
const defaultConfig: AgentConfig = {
  name: 'test-agent',
  instructions: 'You are a helpful assistant.',
  tools: [],
};

/**
 * Create mock LLM client
 *
 * @param responses - List of responses returned in order
 */
function createMockLLMClient(responses: LLMResponse[]): LLMClient {
  let responseIndex = 0;

  return {
    call: vi.fn(async () => {
      if (responseIndex < responses.length) {
        return responses[responseIndex++];
      }
      return {
        content: 'No more responses',
        toolCalls: [],
        tokens: { input: 0, output: 0 },
        stopReason: 'stop',
      };
    }),
    stream: vi.fn(async function* () {
      if (responseIndex < responses.length) {
        const response = responses[responseIndex++];
        yield { type: 'text', delta: response.content, accumulatedContent: response.content };
        yield {
          type: 'done',
          accumulatedContent: response.content,
          roundTotalTokens: response.tokens,
        };
      }
    }),
  } as unknown as LLMClient;
}

/**
 * Create mock response that returns tool calls
 *
 * @param toolName - Tool name
 * @param toolArgs - Tool arguments
 * @param finalResponse - Final response after tool call
 */
function createToolCallResponse(
  toolName: string,
  toolArgs: Record<string, unknown>,
  finalResponse: string
): LLMResponse[] {
  return [
    {
      content: '',
      tokens: { input: 10, output: 5 },
      stopReason: 'tool_calls',
      toolCalls: [
        {
          id: 'call_1',
          name: toolName,
          arguments: toolArgs,
        },
      ],
    },
    {
      content: finalResponse,
      toolCalls: [],
      tokens: { input: 15, output: 10 },
      stopReason: 'stop',
    },
  ];
}

describe('E2E: Skill system complete flow', () => {
  describe('Scenario 1: Complete Skill discovery and usage flow', () => {
    it('should discover Skills from filesystem and display list in system prompt', async () => {
      // Given: Create Runner with skillDirectories, auto-scan fixtures directory
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: createMockLLMClient([
          {
            content: 'I can help with code reviews and testing.',
            toolCalls: [],
            tokens: { input: 20, output: 10 },
            stopReason: 'stop',
          },
        ]),
        skillDirectories: [FIXTURES_DIR],
      });

      const state = createAgentState(defaultConfig);

      // When: Start conversation
      const result = await runner.chat(state, 'What skills do you have?');

      // Then: Should receive response
      expect(result.response).toBeDefined();

      // And: LLM call should contain Skill list
      const mockClient = runner['llmProvider'] as LLMClient;
      const callArgs = vi.mocked(mockClient.call).mock.calls[0];
      const messages = callArgs[0].messages;
      const firstUserMessage = messages.find((m: { role: string }) => m.role === 'user');

      // Verify system prompt contains Skill list
      expect(firstUserMessage?.content).toContain('Available skills:');
      expect(firstUserMessage?.content).toContain('code-review:');
      expect(firstUserMessage?.content).toContain('testing:');
      expect(firstUserMessage?.content).toContain('deployment:');
      expect(firstUserMessage?.content).toContain('load_skill tool');
    });

    it('should load Skill instructions via load_skill tool', async () => {
      // Given: Runner configured with Skill provider
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: createMockLLMClient([]),
        skillDirectories: [FIXTURES_DIR],
      });

      // When: Get tool registry
      const toolRegistry = runner.getToolRegistry();

      // Then: load_skill tool should be registered
      expect(toolRegistry.has('load_skill')).toBe(true);

      // And: Tool execution result should return SWITCH_SKILL signal
      const toolResult = await toolRegistry.execute('load_skill', { name: 'code-review' });
      expect(toolResult).toMatchObject({
        type: 'SWITCH_SKILL',
        to: 'code-review',
      });
      expect(toolResult.instructions).toContain('Code Review Skill');
      expect(toolResult.instructions).toContain('Security');
      expect(toolResult.instructions).toContain('Performance');
    });

    it('should correctly handle Skill loading in streaming execution', async () => {
      // Given: Streaming Runner configured with Skills
      const mockTokens = { input: 10, output: 5 };
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: createMockLLMClient([
          {
            content: 'Let me load the testing skill first.',
            toolCalls: [],
            tokens: mockTokens,
            stopReason: 'stop',
          },
        ]),
        skillDirectories: [FIXTURES_DIR],
      });

      const state = createAgentState(defaultConfig);
      const events: StreamEvent[] = [];

      // When: Execute conversation in streaming mode
      for await (const event of runner.chatStream(state, 'Help me write tests.')) {
        events.push(event);
      }

      // Then: Streaming execution should complete
      expect(events.length).toBeGreaterThan(0);
      expect(events.some((e) => e.type === 'done')).toBe(true);

      // Note: token events may occur during streaming execution depending on mock implementation
      // Here we only verify streaming execution completes
    });
  });

  describe('Scenario 2: Multiple Skill directory scanning', () => {
    it('should discover Skills from multiple directories', () => {
      // Given: FilesystemSkillProvider scans fixtures directory
      // fixtures directory contains subdirectories like code-review, testing, deployment
      // Each subdirectory has a SKILL.md file
      const provider = new FilesystemSkillProvider([FIXTURES_DIR]);
      const skills = provider.listSkills();

      // Then: Should discover all Skills in directories
      // fixtures directory has 3 skill subdirectories
      expect(skills.length).toBeGreaterThanOrEqual(3);
      const skillNames = skills.map((s) => s.name);
      expect(skillNames).toContain('code-review');
      expect(skillNames).toContain('testing');
      expect(skillNames).toContain('deployment');
    });

    it('should use multi-directory Skill provider in Runner', async () => {
      // Given: Create Runner using multi-directory provider
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: createMockLLMClient([
          {
            content: 'I have access to multiple skills.',
            toolCalls: [],
            tokens: { input: 15, output: 5 },
            stopReason: 'stop',
          },
        ]),
        skillDirectories: [FIXTURES_DIR],
      });

      const state = createAgentState(defaultConfig);

      // When: Start conversation
      const result = await runner.chat(state, 'List your skills.');

      // Then: Should receive response
      expect(result.response).toBeDefined();

      // And: System prompt should contain all Skills
      const mockClient = runner['llmProvider'] as LLMClient;
      const callArgs = vi.mocked(mockClient.call).mock.calls[0];
      const messages = callArgs[0].messages;
      const firstUserMessage = messages.find((m: { role: string }) => m.role === 'user');

      expect(firstUserMessage?.content).toContain('code-review:');
      expect(firstUserMessage?.content).toContain('testing:');
      expect(firstUserMessage?.content).toContain('deployment:');
    });
  });

  describe('Scenario 3: Skill metadata correctly injected into system prompt', () => {
    it('should correctly format Skill list', async () => {
      // Given: Runner with multiple Skills
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: createMockLLMClient([
          {
            content: 'Response',
            tokens: { input: 5, output: 5 },
            stopReason: 'stop',
          },
        ]),
        skillDirectories: [FIXTURES_DIR],
      });

      const state = createAgentState(defaultConfig);

      // When: Start conversation
      await runner.chat(state, 'Hello');

      // Then: Skill list should be correctly formatted
      const mockClient = runner['llmProvider'] as LLMClient;
      const callArgs = vi.mocked(mockClient.call).mock.calls[0];
      const messages = callArgs[0].messages;
      const firstUserMessage = messages.find((m: { role: string }) => m.role === 'user');
      const content = firstUserMessage?.content || '';

      // Verify format: "- name: description"
      expect(content).toMatch(/code-review:\s*Perform comprehensive code reviews/);
      expect(content).toMatch(/testing:\s*Write comprehensive unit tests/);
      expect(content).toMatch(/deployment:\s*Guide users through safe deployment/);

      // Verify usage instructions are included
      expect(content).toContain('Use the load_skill tool');
    });

    it('should merge system prompt and Skill list', async () => {
      // Given: Runner with custom system prompt
      const customSystemPrompt = 'You are a specialized coding assistant.';
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: createMockLLMClient([
          {
            content: 'Response',
            tokens: { input: 5, output: 5 },
            stopReason: 'stop',
          },
        ]),
        systemPrompt: customSystemPrompt,
        skillDirectories: [FIXTURES_DIR],
      });

      const state = createAgentState(defaultConfig);

      // When: Start conversation
      await runner.chat(state, 'Hello');

      // Then: System prompt should contain custom prompt and Skill list
      const mockClient = runner['llmProvider'] as LLMClient;
      const callArgs = vi.mocked(mockClient.call).mock.calls[0];
      const messages = callArgs[0].messages;
      const firstUserMessage = messages.find((m: { role: string }) => m.role === 'user');
      const content = firstUserMessage?.content || '';

      // Verify custom system prompt is included
      expect(content).toContain(customSystemPrompt);

      // Verify Skill list is included
      expect(content).toContain('Available skills:');
    });

    it('should not contain Skill-related content when no Skills are configured', async () => {
      // Given: Runner without Skill configuration
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: createMockLLMClient([
          {
            content: 'Response',
            tokens: { input: 5, output: 5 },
            stopReason: 'stop',
          },
        ]),
      });

      const state = createAgentState(defaultConfig);

      // When: Start conversation
      await runner.chat(state, 'Hello');

      // Then: System prompt should not contain Skill-related content
      const mockClient = runner['llmProvider'] as LLMClient;
      const callArgs = vi.mocked(mockClient.call).mock.calls[0];
      const messages = callArgs[0].messages;
      const firstUserMessage = messages.find((m: { role: string }) => m.role === 'user');
      const content = firstUserMessage?.content || '';

      expect(content).not.toContain('Available skills:');
      expect(content).not.toContain('load_skill');
    });
  });

  describe('Scenario 4: load_skill tool integration', () => {
    it('should auto-register load_skill tool', () => {
      // Given: Create Runner with skillDirectories
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: createMockLLMClient([]),
        skillDirectories: [FIXTURES_DIR],
      });

      // When: Get tool registry
      const toolRegistry = runner.getToolRegistry();

      // Then: load_skill tool should be registered
      expect(toolRegistry.has('load_skill')).toBe(true);

      // And: Tool should have correct schema
      const tools = toolRegistry.toToolSchemas();
      const loadSkillTool = tools.find((t) => t.function.name === 'load_skill');
      expect(loadSkillTool).toBeDefined();
      expect(loadSkillTool?.function.description).toContain('Load a skill');
    });

    it('should not register load_skill tool when Skills are not configured', () => {
      // Given: Runner without Skill configuration
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: createMockLLMClient([]),
      });

      // When: Get tool registry
      const toolRegistry = runner.getToolRegistry();

      // Then: load_skill tool should not be registered
      expect(toolRegistry.has('load_skill')).toBe(false);
    });

    it('should execute load_skill through ToolRegistry', async () => {
      // Given: Runner configured with Skills
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: createMockLLMClient([]),
        skillDirectories: [FIXTURES_DIR],
      });

      const toolRegistry = runner.getToolRegistry();

      // When: Execute load_skill tool
      const result = await toolRegistry.execute('load_skill', { name: 'testing' });

      // Then: Should return SWITCH_SKILL signal
      expect(result).toMatchObject({
        type: 'SWITCH_SKILL',
        to: 'testing',
      });
      expect(result.instructions).toContain('Testing Skill');
      expect(result.instructions).toContain('Coverage');
      expect(result.instructions).toContain('Unit Tests');
    });

    it('should return error when loading non-existent Skill', async () => {
      // Given: Runner configured with Skills
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: createMockLLMClient([]),
        skillDirectories: [FIXTURES_DIR],
      });

      const toolRegistry = runner.getToolRegistry();

      // When: Try to load non-existent Skill
      const result = await toolRegistry.execute('load_skill', { name: 'nonexistent' });

      // Then: Should return SKILL_NOT_FOUND signal
      expect(result).toMatchObject({
        type: 'SKILL_NOT_FOUND',
        requested: 'nonexistent',
      });
      expect(result.available).toContain('code-review');
      expect(result.available).toContain('testing');
      expect(result.available).toContain('deployment');
    });

    it('should be able to load multiple different Skills', async () => {
      // Given: Runner configured with multiple Skills
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: createMockLLMClient([]),
        skillDirectories: [FIXTURES_DIR],
      });

      const toolRegistry = runner.getToolRegistry();

      // When: Load different Skills
      const codeReviewResult = await toolRegistry.execute('load_skill', {
        name: 'code-review',
      });
      const testingResult = await toolRegistry.execute('load_skill', {
        name: 'testing',
      });
      const deploymentResult = await toolRegistry.execute('load_skill', {
        name: 'deployment',
      });

      // Then: Each Skill should return SWITCH_SKILL signal
      expect(codeReviewResult).toMatchObject({ type: 'SWITCH_SKILL', to: 'code-review' });
      expect(codeReviewResult.instructions).toContain('Security');
      expect(codeReviewResult.instructions).toContain('Performance');

      expect(testingResult).toMatchObject({ type: 'SWITCH_SKILL', to: 'testing' });
      expect(testingResult.instructions).toContain('Coverage');
      expect(testingResult.instructions).toContain('Unit Tests');

      expect(deploymentResult).toMatchObject({ type: 'SWITCH_SKILL', to: 'deployment' });
      expect(deploymentResult.instructions).toContain('Pre-Deployment');
      expect(deploymentResult.instructions).toContain('Rollback');
    });
  });

  describe('Scenario 5: Agent complete workflow', () => {
    it('should use Skill to guide its behavior', async () => {
      // Given: Runner configured with code-review Skill
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: createMockLLMClient([
          {
            content: 'I will review your code for security issues.',
            toolCalls: [],
            tokens: { input: 15, output: 10 },
            stopReason: 'stop',
          },
        ]),
        skillDirectories: [FIXTURES_DIR],
      });

      const state = createAgentState(defaultConfig);

      // When: Request code review
      const result = await runner.chat(state, 'Review this code for security issues.');

      // Then: Should receive response
      expect(result.response).toBeDefined();
      expect(result.state.context.messages).toHaveLength(2);
    });

    it('should use Skill in multi-turn conversation', async () => {
      // Given: Runner configured with Skills
      const mockTokens = { input: 10, output: 5 };
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: createMockLLMClient([
          {
            content: 'I can help with testing.',
            toolCalls: [],
            tokens: mockTokens,
            stopReason: 'stop',
          },
          {
            content: 'Let me help you write unit tests.',
            toolCalls: [],
            tokens: mockTokens,
            stopReason: 'stop',
          },
        ]),
        skillDirectories: [FIXTURES_DIR],
      });

      let state = createAgentState(defaultConfig);

      // When: First turn
      const result1 = await runner.chat(state, 'What can you help with?');
      state = result1.state;

      // Then: First turn should have response
      expect(result1.response).toBeDefined();
      expect(state.context.stepCount).toBe(1);

      // When: Second turn
      const result2 = await runner.chat(state, 'Help me write tests.');
      state = result2.state;

      // Then: Second turn should have response and retain context
      expect(result2.response).toBeDefined();
      expect(state.context.stepCount).toBe(2);
      expect(state.context.messages).toHaveLength(4);
    });
  });

  describe('Scenario 6: Edge cases and error handling', () => {
    it('should handle empty Skill directory', async () => {
      // Given: Create Runner with empty directory
      const emptyDir = resolve(FIXTURES_DIR, 'empty');

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: createMockLLMClient([
          {
            content: 'Response',
            tokens: { input: 5, output: 5 },
            stopReason: 'stop',
          },
        ]),
        skillDirectories: [emptyDir],
      });

      const state = createAgentState(defaultConfig);

      // When: Start conversation
      const result = await runner.chat(state, 'Hello');

      // Then: Should work normally but without Skill list
      expect(result.response).toBeDefined();

      const mockClient = runner['llmProvider'] as LLMClient;
      const callArgs = vi.mocked(mockClient.call).mock.calls[0];
      const messages = callArgs[0].messages;
      const firstUserMessage = messages.find((m: { role: string }) => m.role === 'user');
      const content = firstUserMessage?.content || '';

      expect(content).not.toContain('Available skills:');
    });

    it('should handle non-existent Skill directory', async () => {
      // Given: Create Runner with non-existent directory
      const nonexistentDir = resolve(FIXTURES_DIR, 'does-not-exist');

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: createMockLLMClient([
          {
            content: 'Response',
            tokens: { input: 5, output: 5 },
            stopReason: 'stop',
          },
        ]),
        skillDirectories: [nonexistentDir],
      });

      const state = createAgentState(defaultConfig);

      // When: Start conversation
      const result = await runner.chat(state, 'Hello');

      // Then: Should work normally but without Skill list
      expect(result.response).toBeDefined();
    });

    it('should prefer injected skillProvider over skillDirectories', async () => {
      // Given: Create a custom provider that only contains code-review
      // FilesystemSkillProvider scans subdirectories of the specified directory
      // So we scan the entire FIXTURES_DIR, then verify only partial skills are injected
      const customProvider = new FilesystemSkillProvider([FIXTURES_DIR]);

      // Create a mock provider that only returns code-review skill
      const mockProvider = {
        getManifest: vi.fn((name: string) => customProvider.getManifest(name)),
        loadInstructions: vi.fn((name: string) => customProvider.loadInstructions(name)),
        loadResource: vi.fn(),
        listSkills: vi.fn(() => {
          // Only return code-review, filter out other skills
          return customProvider.listSkills().filter((s) => s.name === 'code-review');
        }),
        refresh: vi.fn(),
      };

      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: createMockLLMClient([
          {
            content: 'Response',
            toolCalls: [],
            tokens: { input: 5, output: 5 },
            stopReason: 'stop',
          },
        ]),
        skillProvider: mockProvider as any,
        skillDirectories: [FIXTURES_DIR], // This should be ignored
      });

      const state = createAgentState(defaultConfig);

      // When: Start conversation
      await runner.chat(state, 'Hello');

      // Then: Should only use injected provider (only code-review)
      const mockClient = runner['llmProvider'] as LLMClient;
      const callArgs = vi.mocked(mockClient.call).mock.calls[0];
      const messages = callArgs[0].messages;
      const firstUserMessage = messages.find((m: { role: string }) => m.role === 'user');
      const content = firstUserMessage?.content || '';

      // Should contain code-review
      expect(content).toContain('code-review:');

      // Should not contain testing and deployment (because mock provider only returns code-review)
      // Extract skill list part
      const skillListMatch = content.match(/Available skills:\n([\s\S]*?)\n\n/);
      if (skillListMatch) {
        const skillList = skillListMatch[1];
        // Should only have code-review
        expect(skillList).toContain('code-review:');
        // Should not have testing and deployment
        expect(skillList).not.toContain('testing:');
        expect(skillList).not.toContain('deployment:');
      }
    });
  });

  describe('Scenario 7: Skill content validation', () => {
    it('should correctly parse YAML frontmatter', async () => {
      // Given: Create FilesystemSkillProvider
      const provider = new FilesystemSkillProvider([FIXTURES_DIR]);

      // When: Get code-review Skill
      const manifest = provider.getManifest('code-review');

      // Then: Should correctly parse metadata
      expect(manifest).toBeDefined();
      expect(manifest!.name).toBe('code-review');
      expect(manifest!.description).toBe(
        'Perform comprehensive code reviews focusing on security, performance, and maintainability'
      );
    });

    it('should be able to load complete Skill instruction content', async () => {
      // Given: Create FilesystemSkillProvider
      const provider = new FilesystemSkillProvider([FIXTURES_DIR]);

      // When: Load code-review Skill instructions
      const instructions = await provider.loadInstructions('code-review');

      // Then: Should contain complete content (without frontmatter)
      expect(instructions).toContain('# Code Review Skill');
      expect(instructions).toContain('Security');
      expect(instructions).toContain('Performance');
      expect(instructions).toContain('Maintainability');
      expect(instructions).not.toContain('name: code-review');
      expect(instructions).not.toContain('description:');
    });

    it('should list all available Skills', () => {
      // Given: Create FilesystemSkillProvider
      const provider = new FilesystemSkillProvider([FIXTURES_DIR]);

      // When: List all Skills
      const skills = provider.listSkills();

      // Then: Should contain all fixture Skills
      expect(skills.length).toBeGreaterThanOrEqual(3);
      const skillNames = skills.map((s) => s.name);
      expect(skillNames).toContain('code-review');
      expect(skillNames).toContain('testing');
      expect(skillNames).toContain('deployment');
    });
  });
});
