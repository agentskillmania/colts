/**
 * @fileoverview load_skill tool unit tests (Step 8)
 *
 * Tests createLoadSkillTool for normal, abnormal, and boundary scenarios.
 */
import { describe, it, expect, vi } from 'vitest';
import { createLoadSkillTool } from '../../src/skills/load-skill-tool.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { ISkillProvider, SkillManifest } from '../../src/skills/types.js';

/**
 * Create mock ISkillProvider
 *
 * @param skills - Skill list
 * @param instructions - name -> instruction content mapping
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
    it('should return correct tool name and description', () => {
      const provider = createMockProvider();
      const tool = createLoadSkillTool(provider);

      expect(tool.name).toBe('load_skill');
      expect(tool.description).toBeTruthy();
      expect(typeof tool.description).toBe('string');
    });

    it('should return Zod parameter schema', () => {
      const provider = createMockProvider();
      const tool = createLoadSkillTool(provider);

      expect(tool.parameters).toBeDefined();
      expect(tool.parameters._def).toBeDefined();
    });
  });

  describe('Loading existing Skill instructions', () => {
    it('should return SWITCH_SKILL signal', async () => {
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

      expect(result).toEqual({
        type: 'SWITCH_SKILL',
        to: 'code-review',
        instructions: '# Code Review\n\nStep 1: Read the code.',
        task: 'Execute as instructed',
      });
    });

    it('should pass task parameter', async () => {
      const manifest: SkillManifest = {
        name: 'code-review',
        description: 'Code review skill',
        source: '/skills/code-review',
      };
      const provider = createMockProvider([manifest], {
        'code-review': '# Code Review',
      });

      const tool = createLoadSkillTool(provider);
      const result = await tool.execute({ name: 'code-review', task: 'Review this PR' });

      expect(result).toMatchObject({
        type: 'SWITCH_SKILL',
        to: 'code-review',
        task: 'Review this PR',
      });
    });

    it('should look up Skill via skillProvider.getManifest', async () => {
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

    it('should load instructions via skillProvider.loadInstructions', async () => {
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

  describe('Skill not found', () => {
    it('should return SKILL_NOT_FOUND signal', async () => {
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

      expect(result).toEqual({
        type: 'SKILL_NOT_FOUND',
        requested: 'nonexistent',
        available: ['skill-a', 'skill-b'],
      });
    });

    it('should return empty list when no Skills are available', async () => {
      const provider = createMockProvider([], {});

      const tool = createLoadSkillTool(provider);
      const result = await tool.execute({ name: 'anything' });

      expect(result).toEqual({
        type: 'SKILL_NOT_FOUND',
        requested: 'anything',
        available: [],
      });
    });
  });

  describe('Reloading the same Skill', () => {
    it('multiple loads of the same Skill should return the same SWITCH_SKILL signal', async () => {
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

      expect(result1).toEqual(result2);
      expect(result1).toMatchObject({
        type: 'SWITCH_SKILL',
        to: 'stable-skill',
        instructions: 'Always the same content',
      });
    });
  });

  describe('Empty Skill name', () => {
    it('empty string name should return SKILL_NOT_FOUND signal', async () => {
      const skills: SkillManifest[] = [{ name: 'real-skill', description: 'Real', source: '/r' }];
      const provider = createMockProvider(skills, {
        'real-skill': 'Content',
      });

      const tool = createLoadSkillTool(provider);
      const result = await tool.execute({ name: '' });

      expect(result).toEqual({
        type: 'SKILL_NOT_FOUND',
        requested: '',
        available: ['real-skill'],
      });
    });
  });

  describe('ToolRegistry integration', () => {
    it('should be registerable to ToolRegistry', () => {
      const provider = createMockProvider();
      const tool = createLoadSkillTool(provider);

      const registry = new ToolRegistry();
      registry.register(tool);

      expect(registry.has('load_skill')).toBe(true);
    });

    it('should generate valid LLM tool schema', () => {
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

    it('should execute through ToolRegistry and return SWITCH_SKILL signal', async () => {
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
      expect(result).toMatchObject({
        type: 'SWITCH_SKILL',
        to: 'integration-test',
        instructions: 'Integration content',
      });
    });

    it('should validate parameters through Zod schema', async () => {
      const provider = createMockProvider();
      const tool = createLoadSkillTool(provider);

      const registry = new ToolRegistry();
      registry.register(tool);

      // Missing name parameter should throw validation error
      await expect(registry.execute('load_skill', {})).rejects.toThrow();

      // Wrong name type should throw validation error
      await expect(registry.execute('load_skill', { name: 123 })).rejects.toThrow();
    });
  });

  describe('loadInstructions exception', () => {
    it('should propagate when loadInstructions throws', async () => {
      const manifest: SkillManifest = {
        name: 'broken-skill',
        description: 'Broken',
        source: '/skills/broken',
      };
      const provider = createMockProvider([manifest], {});
      // Override loadInstructions to throw
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
