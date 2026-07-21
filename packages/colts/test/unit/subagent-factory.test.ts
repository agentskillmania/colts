/**
 * @fileoverview DefaultSubAgentFactory — tool and skill inheritance tests
 *
 * Sub-agents historically got tools:[] and no skillProvider, so they could
 * only call the LLM. SubAgentConfig.inheritParentTools/inheritParentSkills
 * (default true) now let them pick up the parent runner's toolRegistry and
 * skillProvider via DefaultSubAgentFactory.
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type { LLMClient } from '@agentskillmania/llm-client';
import { DefaultSubAgentFactory } from '../../src/subagent/types.js';
import type { SubAgentConfig } from '../../src/subagent/types.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { Tool } from '../../src/tools/registry.js';
import { FilesystemSkillProvider } from '../../src/skills/filesystem-provider.js';

// ============================================================
// Helpers
// ============================================================

function createFakeTool(name: string): Tool {
  return {
    name,
    description: `${name} tool`,
    parameters: z.object({}),
    execute: vi.fn().mockResolvedValue(`${name} result`),
  };
}

function createMockLLMClient(): LLMClient {
  return {
    call: vi.fn().mockResolvedValue({
      content: 'ok',
      toolCalls: [],
      tokens: { input: 1, output: 1 },
      stopReason: 'stop',
    }),
    stream: vi.fn(),
  } as unknown as LLMClient;
}

function createBaseConfig(overrides?: Partial<SubAgentConfig>): SubAgentConfig {
  return {
    name: 'researcher',
    description: 'research helper',
    config: { name: 'researcher', instructions: 'be helpful', tools: [] },
    ...overrides,
  };
}

// ============================================================
// Tests
// ============================================================

describe('DefaultSubAgentFactory — tool/skill inheritance', () => {
  it('inherits all parent tools when inheritParentTools is true (default)', () => {
    const registry = new ToolRegistry();
    registry.register(createFakeTool('file_read'));
    registry.register(createFakeTool('shell'));
    registry.register(createFakeTool('web_search'));

    const factory = new DefaultSubAgentFactory();
    const runner = factory.create(createBaseConfig(), {
      llmProvider: createMockLLMClient(),
      toolRegistry: registry,
      model: 'test-model',
    });

    const toolNames = runner.getToolRegistry().getAll().map((t) => t.name);
    expect(toolNames).toContain('file_read');
    expect(toolNames).toContain('shell');
    expect(toolNames).toContain('web_search');
  });

  it('does NOT inherit parent tools when inheritParentTools is false', () => {
    const registry = new ToolRegistry();
    registry.register(createFakeTool('file_read'));
    registry.register(createFakeTool('shell'));

    const factory = new DefaultSubAgentFactory();
    const runner = factory.create(
      createBaseConfig({ inheritParentTools: false }),
      {
        llmProvider: createMockLLMClient(),
        toolRegistry: registry,
        model: 'test-model',
      }
    );

    const toolNames = runner.getToolRegistry().getAll().map((t) => t.name);
    expect(toolNames).not.toContain('file_read');
    expect(toolNames).not.toContain('shell');
  });

  it('filters out delegate tool from inherited set (prevents recursion)', () => {
    const registry = new ToolRegistry();
    registry.register(createFakeTool('file_read'));
    registry.register(createFakeTool('delegate')); // would-be-recursive

    const factory = new DefaultSubAgentFactory();
    const runner = factory.create(createBaseConfig(), {
      llmProvider: createMockLLMClient(),
      toolRegistry: registry,
      model: 'test-model',
    });

    const toolNames = runner.getToolRegistry().getAll().map((t) => t.name);
    expect(toolNames).toContain('file_read');
    expect(toolNames).not.toContain('delegate');
  });

  it('registers load_skill automatically when parent skillProvider is inherited', () => {
    // An empty dir is fine — we just need any FilesystemSkillProvider to verify
    // the sub-runner wires up load_skill when one is forwarded.
    const skillProvider = new FilesystemSkillProvider(['/tmp/nonexistent-skills']);
    const registry = new ToolRegistry();
    registry.register(createFakeTool('file_read'));

    const factory = new DefaultSubAgentFactory();
    const runner = factory.create(createBaseConfig(), {
      llmProvider: createMockLLMClient(),
      toolRegistry: registry,
      model: 'test-model',
      skillProvider,
    });

    const toolNames = runner.getToolRegistry().getAll().map((t) => t.name);
    expect(toolNames).toContain('load_skill');
  });

  it('does NOT register load_skill when inheritParentSkills is false', () => {
    const skillProvider = new FilesystemSkillProvider(['/tmp/nonexistent-skills']);
    const registry = new ToolRegistry();
    registry.register(createFakeTool('file_read'));

    const factory = new DefaultSubAgentFactory();
    const runner = factory.create(
      createBaseConfig({ inheritParentSkills: false }),
      {
        llmProvider: createMockLLMClient(),
        toolRegistry: registry,
        model: 'test-model',
        skillProvider,
      }
    );

    const toolNames = runner.getToolRegistry().getAll().map((t) => t.name);
    expect(toolNames).not.toContain('load_skill');
  });

  it('still works when no parent skillProvider provided (backward compat)', () => {
    const registry = new ToolRegistry();
    registry.register(createFakeTool('file_read'));

    const factory = new DefaultSubAgentFactory();
    const runner = factory.create(createBaseConfig(), {
      llmProvider: createMockLLMClient(),
      toolRegistry: registry,
      model: 'test-model',
      // no skillProvider — old code path
    });

    const toolNames = runner.getToolRegistry().getAll().map((t) => t.name);
    expect(toolNames).toContain('file_read');
    expect(toolNames).not.toContain('load_skill');
  });
});
