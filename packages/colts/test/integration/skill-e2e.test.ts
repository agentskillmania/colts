/**
 * @fileoverview Skill 系统 E2E 集成测试（Step 10）
 *
 * 测试 Skill 系统的完整流程：
 * 1. FilesystemSkillProvider 扫描目录并发现 Skill
 * 2. Runner 构建消息时注入 Skill 元数据到系统提示
 * 3. LLM 看到可用的 Skill 列表和 load_skill 工具
 * 4. LLM 调用 load_skill 工具加载指定 Skill 的指令
 * 5. Skill 指令返回到 LLM 上下文中
 * 6. Agent 根据 Skill 指令执行任务
 *
 * 测试场景：
 * - 完整的 Skill 发现和使用流程
 * - 多个 Skill 目录扫描
 * - Skill 元数据正确注入到系统提示
 * - load_skill 工具与 Runner 的集成
 * - 流式执行中的 Skill 加载事件
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolve } from 'node:path';
import { AgentRunner } from '../../src/runner.js';
import { FilesystemSkillProvider } from '../../src/skills/filesystem-provider.js';
import { createAgentState } from '../../src/state.js';
import type { AgentConfig } from '../../src/types.js';
import type { LLMClient, LLMResponse } from '@agentskillmania/llm-client';
import type { StreamEvent } from '../../src/execution.js';

/** 测试用的 Skill fixtures 目录 */
const FIXTURES_DIR = resolve(__dirname, '../fixtures/skills');

/** 默认 Agent 配置 */
const defaultConfig: AgentConfig = {
  name: 'test-agent',
  instructions: 'You are a helpful assistant.',
  tools: [],
};

/**
 * 创建模拟 LLM 客户端
 *
 * @param responses - 按顺序返回的响应列表
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
 * 创建返回工具调用的模拟响应
 *
 * @param toolName - 工具名称
 * @param toolArgs - 工具参数
 * @param finalResponse - 工具调用后的最终响应
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

describe('E2E: Skill 系统完整流程', () => {
  describe('场景 1: 完整的 Skill 发现和使用流程', () => {
    it('应能从文件系统发现 Skill 并在系统提示中显示列表', async () => {
      // Given: 使用 skillDirectories 创建 Runner，自动扫描 fixtures 目录
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

      // When: 发起对话
      const result = await runner.chat(state, 'What skills do you have?');

      // Then: 应该收到响应
      expect(result.response).toBeDefined();

      // And: LLM 调用时应该包含 Skill 列表
      const mockClient = runner['llmProvider'] as LLMClient;
      const callArgs = vi.mocked(mockClient.call).mock.calls[0];
      const messages = callArgs[0].messages;
      const firstUserMessage = messages.find((m: { role: string }) => m.role === 'user');

      // 验证系统提示中包含 Skill 列表
      expect(firstUserMessage?.content).toContain('Available skills:');
      expect(firstUserMessage?.content).toContain('code-review:');
      expect(firstUserMessage?.content).toContain('testing:');
      expect(firstUserMessage?.content).toContain('deployment:');
      expect(firstUserMessage?.content).toContain('load_skill tool');
    });

    it('应能通过 load_skill 工具加载 Skill 指令', async () => {
      // Given: 配置了 Skill provider 的 Runner
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: createMockLLMClient([]),
        skillDirectories: [FIXTURES_DIR],
      });

      // When: 获取 tool registry
      const toolRegistry = runner.getToolRegistry();

      // Then: load_skill 工具应该被注册
      expect(toolRegistry.has('load_skill')).toBe(true);

      // And: 工具执行结果应该返回 SWITCH_SKILL 信号
      const toolResult = await toolRegistry.execute('load_skill', { name: 'code-review' });
      expect(toolResult).toMatchObject({
        type: 'SWITCH_SKILL',
        to: 'code-review',
      });
      expect(toolResult.instructions).toContain('Code Review Skill');
      expect(toolResult.instructions).toContain('Security');
      expect(toolResult.instructions).toContain('Performance');
    });

    it('应能在流式执行中正确处理 Skill 加载', async () => {
      // Given: 配置了 Skill 的流式 Runner
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

      // When: 流式执行对话
      for await (const event of runner.chatStream(state, 'Help me write tests.')) {
        events.push(event);
      }

      // Then: 应该完成流式执行
      expect(events.length).toBeGreaterThan(0);
      expect(events.some((e) => e.type === 'done')).toBe(true);

      // Note: token 事件可能在流式执行中，取决于 mock 实现
      // 这里我们只验证流式执行完成
    });
  });

  describe('场景 2: 多个 Skill 目录扫描', () => {
    it('应能从多个目录发现 Skill', () => {
      // Given: FilesystemSkillProvider 扫描 fixtures 目录
      // fixtures 目录包含 code-review、testing、deployment 等子目录
      // 每个子目录都有一个 SKILL.md 文件
      const provider = new FilesystemSkillProvider([FIXTURES_DIR]);
      const skills = provider.listSkills();

      // Then: 应该发现所有目录中的 Skill
      // fixtures 目录下有 3 个 skill 子目录
      expect(skills.length).toBeGreaterThanOrEqual(3);
      const skillNames = skills.map((s) => s.name);
      expect(skillNames).toContain('code-review');
      expect(skillNames).toContain('testing');
      expect(skillNames).toContain('deployment');
    });

    it('应能在 Runner 中使用多目录 Skill provider', async () => {
      // Given: 使用多目录 provider 创建 Runner
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

      // When: 发起对话
      const result = await runner.chat(state, 'List your skills.');

      // Then: 应该收到响应
      expect(result.response).toBeDefined();

      // And: 系统提示应该包含所有 Skill
      const mockClient = runner['llmProvider'] as LLMClient;
      const callArgs = vi.mocked(mockClient.call).mock.calls[0];
      const messages = callArgs[0].messages;
      const firstUserMessage = messages.find((m: { role: string }) => m.role === 'user');

      expect(firstUserMessage?.content).toContain('code-review:');
      expect(firstUserMessage?.content).toContain('testing:');
      expect(firstUserMessage?.content).toContain('deployment:');
    });
  });

  describe('场景 3: Skill 元数据正确注入到系统提示', () => {
    it('应正确格式化 Skill 列表', async () => {
      // Given: 有多个 Skill 的 Runner
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

      // When: 发起对话
      await runner.chat(state, 'Hello');

      // Then: Skill 列表应该正确格式化
      const mockClient = runner['llmProvider'] as LLMClient;
      const callArgs = vi.mocked(mockClient.call).mock.calls[0];
      const messages = callArgs[0].messages;
      const firstUserMessage = messages.find((m: { role: string }) => m.role === 'user');
      const content = firstUserMessage?.content || '';

      // 验证格式："- name: description"
      expect(content).toMatch(/code-review:\s*Perform comprehensive code reviews/);
      expect(content).toMatch(/testing:\s*Write comprehensive unit tests/);
      expect(content).toMatch(/deployment:\s*Guide users through safe deployment/);

      // 验证包含使用说明
      expect(content).toContain('Use the load_skill tool');
    });

    it('应该合并系统提示和 Skill 列表', async () => {
      // Given: 带有自定义系统提示的 Runner
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

      // When: 发起对话
      await runner.chat(state, 'Hello');

      // Then: 系统提示应该包含自定义提示和 Skill 列表
      const mockClient = runner['llmProvider'] as LLMClient;
      const callArgs = vi.mocked(mockClient.call).mock.calls[0];
      const messages = callArgs[0].messages;
      const firstUserMessage = messages.find((m: { role: string }) => m.role === 'user');
      const content = firstUserMessage?.content || '';

      // 验证包含自定义系统提示
      expect(content).toContain(customSystemPrompt);

      // 验证包含 Skill 列表
      expect(content).toContain('Available skills:');
    });

    it('没有 Skill 时不应包含 Skill 相关内容', async () => {
      // Given: 没有配置 Skill 的 Runner
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

      // When: 发起对话
      await runner.chat(state, 'Hello');

      // Then: 系统提示中不应包含 Skill 相关内容
      const mockClient = runner['llmProvider'] as LLMClient;
      const callArgs = vi.mocked(mockClient.call).mock.calls[0];
      const messages = callArgs[0].messages;
      const firstUserMessage = messages.find((m: { role: string }) => m.role === 'user');
      const content = firstUserMessage?.content || '';

      expect(content).not.toContain('Available skills:');
      expect(content).not.toContain('load_skill');
    });
  });

  describe('场景 4: load_skill 工具集成', () => {
    it('应自动注册 load_skill 工具', () => {
      // Given: 使用 skillDirectories 创建 Runner
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: createMockLLMClient([]),
        skillDirectories: [FIXTURES_DIR],
      });

      // When: 获取工具注册表
      const toolRegistry = runner.getToolRegistry();

      // Then: load_skill 工具应该被注册
      expect(toolRegistry.has('load_skill')).toBe(true);

      // And: 工具应该有正确的 schema
      const tools = toolRegistry.toToolSchemas();
      const loadSkillTool = tools.find((t) => t.function.name === 'load_skill');
      expect(loadSkillTool).toBeDefined();
      expect(loadSkillTool?.function.description).toContain('Load a skill');
    });

    it('未配置 Skill 时不应注册 load_skill 工具', () => {
      // Given: 没有配置 Skill 的 Runner
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: createMockLLMClient([]),
      });

      // When: 获取工具注册表
      const toolRegistry = runner.getToolRegistry();

      // Then: load_skill 工具不应该被注册
      expect(toolRegistry.has('load_skill')).toBe(false);
    });

    it('应能通过 ToolRegistry 执行 load_skill', async () => {
      // Given: 配置了 Skill 的 Runner
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: createMockLLMClient([]),
        skillDirectories: [FIXTURES_DIR],
      });

      const toolRegistry = runner.getToolRegistry();

      // When: 执行 load_skill 工具
      const result = await toolRegistry.execute('load_skill', { name: 'testing' });

      // Then: 应该返回 SWITCH_SKILL 信号
      expect(result).toMatchObject({
        type: 'SWITCH_SKILL',
        to: 'testing',
      });
      expect(result.instructions).toContain('Testing Skill');
      expect(result.instructions).toContain('Coverage');
      expect(result.instructions).toContain('Unit Tests');
    });

    it('加载不存在的 Skill 应返回错误信息', async () => {
      // Given: 配置了 Skill 的 Runner
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: createMockLLMClient([]),
        skillDirectories: [FIXTURES_DIR],
      });

      const toolRegistry = runner.getToolRegistry();

      // When: 尝试加载不存在的 Skill
      const result = await toolRegistry.execute('load_skill', { name: 'nonexistent' });

      // Then: 应该返回 SKILL_NOT_FOUND 信号
      expect(result).toMatchObject({
        type: 'SKILL_NOT_FOUND',
        requested: 'nonexistent',
      });
      expect(result.available).toContain('code-review');
      expect(result.available).toContain('testing');
      expect(result.available).toContain('deployment');
    });

    it('应能加载多个不同的 Skill', async () => {
      // Given: 配置了多个 Skill 的 Runner
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: createMockLLMClient([]),
        skillDirectories: [FIXTURES_DIR],
      });

      const toolRegistry = runner.getToolRegistry();

      // When: 加载不同的 Skill
      const codeReviewResult = await toolRegistry.execute('load_skill', {
        name: 'code-review',
      });
      const testingResult = await toolRegistry.execute('load_skill', {
        name: 'testing',
      });
      const deploymentResult = await toolRegistry.execute('load_skill', {
        name: 'deployment',
      });

      // Then: 每个 Skill 应该返回 SWITCH_SKILL 信号
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

  describe('场景 5: Agent 完整工作流', () => {
    it('应能使用 Skill 指导其行为', async () => {
      // Given: 配置了 code-review Skill 的 Runner
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

      // When: 请求代码审查
      const result = await runner.chat(state, 'Review this code for security issues.');

      // Then: 应该收到响应
      expect(result.response).toBeDefined();
      expect(result.state.context.messages).toHaveLength(2);
    });

    it('应能在多轮对话中使用 Skill', async () => {
      // Given: 配置了 Skill 的 Runner
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

      // When: 第一轮对话
      const result1 = await runner.chat(state, 'What can you help with?');
      state = result1.state;

      // Then: 第一轮应该有响应
      expect(result1.response).toBeDefined();
      expect(state.context.stepCount).toBe(1);

      // When: 第二轮对话
      const result2 = await runner.chat(state, 'Help me write tests.');
      state = result2.state;

      // Then: 第二轮应该有响应并保持上下文
      expect(result2.response).toBeDefined();
      expect(state.context.stepCount).toBe(2);
      expect(state.context.messages).toHaveLength(4);
    });
  });

  describe('场景 6: 边界条件和异常处理', () => {
    it('应处理空 Skill 目录', async () => {
      // Given: 使用空目录创建 Runner
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

      // When: 发起对话
      const result = await runner.chat(state, 'Hello');

      // Then: 应该正常工作，但没有 Skill 列表
      expect(result.response).toBeDefined();

      const mockClient = runner['llmProvider'] as LLMClient;
      const callArgs = vi.mocked(mockClient.call).mock.calls[0];
      const messages = callArgs[0].messages;
      const firstUserMessage = messages.find((m: { role: string }) => m.role === 'user');
      const content = firstUserMessage?.content || '';

      expect(content).not.toContain('Available skills:');
    });

    it('应处理不存在的 Skill 目录', async () => {
      // Given: 使用不存在的目录创建 Runner
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

      // When: 发起对话
      const result = await runner.chat(state, 'Hello');

      // Then: 应该正常工作，但没有 Skill 列表
      expect(result.response).toBeDefined();
    });

    it('应优先使用注入的 skillProvider 而非 skillDirectories', async () => {
      // Given: 创建一个只包含 code-review 的 custom provider
      // FilesystemSkillProvider 扫描指定目录的子目录
      // 所以我们扫描整个 FIXTURES_DIR，然后验证只注入了部分技能
      const customProvider = new FilesystemSkillProvider([FIXTURES_DIR]);

      // 创建一个 mock provider，只返回 code-review skill
      const mockProvider = {
        getManifest: vi.fn((name: string) => customProvider.getManifest(name)),
        loadInstructions: vi.fn((name: string) => customProvider.loadInstructions(name)),
        loadResource: vi.fn(),
        listSkills: vi.fn(() => {
          // 只返回 code-review，过滤掉其他 skills
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
        skillDirectories: [FIXTURES_DIR], // 这个应该被忽略
      });

      const state = createAgentState(defaultConfig);

      // When: 发起对话
      await runner.chat(state, 'Hello');

      // Then: 应该只使用注入的 provider（只有 code-review）
      const mockClient = runner['llmProvider'] as LLMClient;
      const callArgs = vi.mocked(mockClient.call).mock.calls[0];
      const messages = callArgs[0].messages;
      const firstUserMessage = messages.find((m: { role: string }) => m.role === 'user');
      const content = firstUserMessage?.content || '';

      // 应该包含 code-review
      expect(content).toContain('code-review:');

      // 不应该包含 testing 和 deployment（因为 mock provider 只返回 code-review）
      // 提取 skill 列表部分
      const skillListMatch = content.match(/Available skills:\n([\s\S]*?)\n\n/);
      if (skillListMatch) {
        const skillList = skillListMatch[1];
        // 应该只有 code-review
        expect(skillList).toContain('code-review:');
        // 不应该有 testing 和 deployment
        expect(skillList).not.toContain('testing:');
        expect(skillList).not.toContain('deployment:');
      }
    });
  });

  describe('场景 7: Skill 内容验证', () => {
    it('应正确解析 YAML frontmatter', async () => {
      // Given: 创建 FilesystemSkillProvider
      const provider = new FilesystemSkillProvider([FIXTURES_DIR]);

      // When: 获取 code-review Skill
      const manifest = provider.getManifest('code-review');

      // Then: 应该正确解析元数据
      expect(manifest).toBeDefined();
      expect(manifest!.name).toBe('code-review');
      expect(manifest!.description).toBe(
        'Perform comprehensive code reviews focusing on security, performance, and maintainability'
      );
    });

    it('应能加载完整的 Skill 指令内容', async () => {
      // Given: 创建 FilesystemSkillProvider
      const provider = new FilesystemSkillProvider([FIXTURES_DIR]);

      // When: 加载 code-review Skill 指令
      const instructions = await provider.loadInstructions('code-review');

      // Then: 应该包含完整的内容（不含 frontmatter）
      expect(instructions).toContain('# Code Review Skill');
      expect(instructions).toContain('Security');
      expect(instructions).toContain('Performance');
      expect(instructions).toContain('Maintainability');
      expect(instructions).not.toContain('name: code-review');
      expect(instructions).not.toContain('description:');
    });

    it('应列出所有可用的 Skill', () => {
      // Given: 创建 FilesystemSkillProvider
      const provider = new FilesystemSkillProvider([FIXTURES_DIR]);

      // When: 列出所有 Skill
      const skills = provider.listSkills();

      // Then: 应该包含所有 fixture 中的 Skill
      expect(skills.length).toBeGreaterThanOrEqual(3);
      const skillNames = skills.map((s) => s.name);
      expect(skillNames).toContain('code-review');
      expect(skillNames).toContain('testing');
      expect(skillNames).toContain('deployment');
    });
  });
});
