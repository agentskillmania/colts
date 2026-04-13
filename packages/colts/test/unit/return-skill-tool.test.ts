/**
 * @fileoverview return_skill tool unit tests
 *
 * Tests signal return and parameter handling of createReturnSkillTool.
 */
import { describe, it, expect } from 'vitest';
import { createReturnSkillTool } from '../../src/skills/return-skill-tool.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { isSkillSignal } from '../../src/skills/types.js';

describe('return_skill Tool', () => {
  describe('createReturnSkillTool', () => {
    it('should return correct tool name and description', () => {
      const tool = createReturnSkillTool();

      expect(tool.name).toBe('return_skill');
      expect(tool.description).toBeTruthy();
      expect(typeof tool.description).toBe('string');
      expect(tool.description).toContain('return');
    });

    it('should return Zod parameter schema', () => {
      const tool = createReturnSkillTool();

      expect(tool.parameters).toBeDefined();
      expect(tool.parameters._def).toBeDefined();
    });
  });

  describe('RETURN_SKILL signal', () => {
    it('should return RETURN_SKILL signal', async () => {
      const tool = createReturnSkillTool();
      const result = await tool.execute({
        result: 'Task completed successfully',
        status: 'success',
      });

      expect(result).toEqual({
        type: 'RETURN_SKILL',
        result: 'Task completed successfully',
        status: 'success',
      });
      expect(isSkillSignal(result)).toBe(true);
    });

    it('should support partial status', async () => {
      const tool = createReturnSkillTool();
      const result = await tool.execute({
        result: 'Partial results obtained',
        status: 'partial',
      });

      expect(result).toMatchObject({
        type: 'RETURN_SKILL',
        status: 'partial',
      });
    });

    it('should support failed status', async () => {
      const tool = createReturnSkillTool();
      const result = await tool.execute({
        result: 'Task failed due to error',
        status: 'failed',
      });

      expect(result).toMatchObject({
        type: 'RETURN_SKILL',
        status: 'failed',
      });
    });

    it('status should default to success', async () => {
      const tool = createReturnSkillTool();
      const result = await tool.execute({
        result: 'Default status test',
      });

      expect(result).toMatchObject({
        type: 'RETURN_SKILL',
        result: 'Default status test',
        status: 'success',
      });
    });

    it('should support detailed return result', async () => {
      const tool = createReturnSkillTool();
      const detailedResult = JSON.stringify({
        recordsProcessed: 100,
        errors: 2,
        summary: 'Most records processed successfully',
      });

      const result = await tool.execute({
        result: detailedResult,
        status: 'partial',
      });

      expect(result).toMatchObject({
        type: 'RETURN_SKILL',
        result: detailedResult,
        status: 'partial',
      });
    });
  });

  describe('ToolRegistry integration', () => {
    it('should be registerable to ToolRegistry', () => {
      const tool = createReturnSkillTool();

      const registry = new ToolRegistry();
      registry.register(tool);

      expect(registry.has('return_skill')).toBe(true);
    });

    it('should generate valid LLM tool schema', () => {
      const tool = createReturnSkillTool();

      const registry = new ToolRegistry();
      registry.register(tool);

      const schemas = registry.toToolSchemas();
      expect(schemas).toHaveLength(1);

      const schema = schemas[0];
      expect(schema.type).toBe('function');
      expect(schema.function.name).toBe('return_skill');
      expect(schema.function.description).toBeTruthy();

      const params = schema.function.parameters as Record<string, unknown>;
      expect(params).toBeDefined();
      expect(params.type).toBe('object');
    });

    it('should execute through ToolRegistry', async () => {
      const tool = createReturnSkillTool();

      const registry = new ToolRegistry();
      registry.register(tool);

      const result = await registry.execute('return_skill', {
        result: 'Registry test result',
        status: 'success',
      });

      expect(result).toMatchObject({
        type: 'RETURN_SKILL',
        result: 'Registry test result',
        status: 'success',
      });
    });

    it('should validate parameters through Zod schema', async () => {
      const tool = createReturnSkillTool();

      const registry = new ToolRegistry();
      registry.register(tool);

      // Missing result parameter should throw validation error
      await expect(registry.execute('return_skill', {})).rejects.toThrow();

      // Wrong result type should throw validation error
      await expect(registry.execute('return_skill', { result: 123 })).rejects.toThrow();

      // status value not in enum should throw validation error
      await expect(
        registry.execute('return_skill', { result: 'test', status: 'invalid' })
      ).rejects.toThrow();
    });
  });
});
