/**
 * @fileoverview load_skill 工具单元测试（Step 8）
 *
 * 测试 createLoadSkillTool 的正常场景、异常场景和边界场景。
 */
import { describe, it, expect, vi } from 'vitest';
import { createLoadSkillTool } from '../../src/skills/load-skill-tool.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { ISkillProvider, SkillManifest } from '../../src/skills/types.js';

/**
 * 创建 mock ISkillProvider
 *
 * @param skills - Skill 列表
 * @param instructions - name -> 指令内容的映射
 */
function createMockProvider(
  skills: SkillManifest[] = [],
  instructions: Record<string, string> = {}
): ISkillProvider {
  const manifestMap = new Map(skills.map((s) => [s.name, s]));

  return {
    getManifest: vi.fn((name: string) => manifestMap.get(name)),
    loadInstructions: vi.fn(async (name: string) => {
      const content = instructions[name];
      if (content === undefined) {
        throw new Error(`Skill not found: ${name}`);
      }
      return content;
    }),
    loadResource: vi.fn(),
    listSkills: vi.fn(() => skills),
    refresh: vi.fn(),
  } as unknown as ISkillProvider;
}

describe('Step 8: load_skill Tool', () => {
  describe('createLoadSkillTool', () => {
    it('应返回正确的工具名称和描述', () => {
      const provider = createMockProvider();
      const tool = createLoadSkillTool(provider);

      expect(tool.name).toBe('load_skill');
      expect(tool.description).toBeTruthy();
      expect(typeof tool.description).toBe('string');
    });

    it('应返回 Zod 参数 schema', () => {
      const provider = createMockProvider();
      const tool = createLoadSkillTool(provider);

      expect(tool.parameters).toBeDefined();
      expect(tool.parameters._def).toBeDefined();
    });
  });

  describe('加载已存在的 Skill 指令', () => {
    it('应能加载并返回 Skill 指令内容', async () => {
      const manifest: SkillManifest = {
        name: 'code-review',
        description: 'Code review skill',
        source: '/skills/code-review',
      };
      const provider = createMockProvider([manifest], {
        'code-review': '# Code Review\n\nStep 1: Read the code.',
      });

      const tool = createLoadSkillTool(provider);
      const result = await tool.execute({ name: 'code-review' });

      expect(result).toBe('# Code Review\n\nStep 1: Read the code.');
    });

    it('应通过 skillProvider.getManifest 查找 Skill', async () => {
      const manifest: SkillManifest = {
        name: 'deploy',
        description: 'Deploy skill',
        source: '/skills/deploy',
      };
      const provider = createMockProvider([manifest], { deploy: 'Deploy instructions' });

      const tool = createLoadSkillTool(provider);
      await tool.execute({ name: 'deploy' });

      expect(provider.getManifest).toHaveBeenCalledWith('deploy');
    });

    it('应通过 skillProvider.loadInstructions 加载指令', async () => {
      const manifest: SkillManifest = {
        name: 'test',
        description: 'Test skill',
        source: '/skills/test',
      };
      const provider = createMockProvider([manifest], { test: 'Test instructions' });

      const tool = createLoadSkillTool(provider);
      await tool.execute({ name: 'test' });

      expect(provider.loadInstructions).toHaveBeenCalledWith('test');
    });
  });

  describe('Skill 未找到', () => {
    it('应返回包含可用 Skill 列表的错误信息', async () => {
      const skills: SkillManifest[] = [
        { name: 'skill-a', description: 'A', source: '/a' },
        { name: 'skill-b', description: 'B', source: '/b' },
      ];
      const provider = createMockProvider(skills, {
        'skill-a': 'Instructions A',
        'skill-b': 'Instructions B',
      });

      const tool = createLoadSkillTool(provider);
      const result = await tool.execute({ name: 'nonexistent' });

      expect(result).toBe(
        "Error: Skill 'nonexistent' not found. Available skills: skill-a, skill-b"
      );
    });

    it('没有可用 Skill 时应显示空列表', async () => {
      const provider = createMockProvider([], {});

      const tool = createLoadSkillTool(provider);
      const result = await tool.execute({ name: 'anything' });

      expect(result).toBe("Error: Skill 'anything' not found. Available skills: ");
    });
  });

  describe('重复加载同一 Skill', () => {
    it('多次加载同一 Skill 应返回相同内容', async () => {
      const manifest: SkillManifest = {
        name: 'stable-skill',
        description: 'Stable',
        source: '/skills/stable',
      };
      const provider = createMockProvider([manifest], {
        'stable-skill': 'Always the same content',
      });

      const tool = createLoadSkillTool(provider);

      const result1 = await tool.execute({ name: 'stable-skill' });
      const result2 = await tool.execute({ name: 'stable-skill' });

      expect(result1).toBe(result2);
      expect(result1).toBe('Always the same content');
    });
  });

  describe('空 Skill 名称', () => {
    it('空字符串名称应正确处理并返回错误', async () => {
      const skills: SkillManifest[] = [{ name: 'real-skill', description: 'Real', source: '/r' }];
      const provider = createMockProvider(skills, {
        'real-skill': 'Content',
      });

      const tool = createLoadSkillTool(provider);
      const result = await tool.execute({ name: '' });

      expect(result).toBe("Error: Skill '' not found. Available skills: real-skill");
    });
  });

  describe('ToolRegistry 集成', () => {
    it('应能注册到 ToolRegistry', () => {
      const provider = createMockProvider();
      const tool = createLoadSkillTool(provider);

      const registry = new ToolRegistry();
      registry.register(tool);

      expect(registry.has('load_skill')).toBe(true);
    });

    it('应生成有效的 LLM 工具 schema', () => {
      const provider = createMockProvider();
      const tool = createLoadSkillTool(provider);

      const registry = new ToolRegistry();
      registry.register(tool);

      const schemas = registry.toToolSchemas();
      expect(schemas).toHaveLength(1);

      const schema = schemas[0];
      expect(schema.type).toBe('function');
      expect(schema.function.name).toBe('load_skill');
      expect(schema.function.description).toBeTruthy();

      const params = schema.function.parameters as Record<string, unknown>;
      expect(params).toBeDefined();
      expect(params.type).toBe('object');
    });

    it('应能通过 ToolRegistry 执行', async () => {
      const manifest: SkillManifest = {
        name: 'integration-test',
        description: 'Integration',
        source: '/skills/int',
      };
      const provider = createMockProvider([manifest], {
        'integration-test': 'Integration content',
      });

      const tool = createLoadSkillTool(provider);

      const registry = new ToolRegistry();
      registry.register(tool);

      const result = await registry.execute('load_skill', { name: 'integration-test' });
      expect(result).toBe('Integration content');
    });

    it('应通过 Zod schema 校验参数', async () => {
      const provider = createMockProvider();
      const tool = createLoadSkillTool(provider);

      const registry = new ToolRegistry();
      registry.register(tool);

      // 缺少 name 参数应抛出校验错误
      await expect(registry.execute('load_skill', {})).rejects.toThrow();

      // name 类型错误应抛出校验错误
      await expect(registry.execute('load_skill', { name: 123 })).rejects.toThrow();
    });
  });

  describe('loadInstructions 异常', () => {
    it('当 loadInstructions 抛出异常时应该传播', async () => {
      const manifest: SkillManifest = {
        name: 'broken-skill',
        description: 'Broken',
        source: '/skills/broken',
      };
      const provider = createMockProvider([manifest], {});
      // 覆盖 loadInstructions 使其抛出
      (provider.loadInstructions as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Failed to read skill file')
      );

      const tool = createLoadSkillTool(provider);

      await expect(tool.execute({ name: 'broken-skill' })).rejects.toThrow(
        'Failed to read skill file'
      );
    });
  });
});
