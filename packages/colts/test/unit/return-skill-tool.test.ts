/**
 * @fileoverview return_skill 工具单元测试
 *
 * 测试 createReturnSkillTool 的信号返回和参数处理。
 */
import { describe, it, expect } from 'vitest';
import { createReturnSkillTool } from '../../src/skills/return-skill-tool.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { isSkillSignal } from '../../src/skills/types.js';

describe('return_skill Tool', () => {
  describe('createReturnSkillTool', () => {
    it('应返回正确的工具名称和描述', () => {
      const tool = createReturnSkillTool();

      expect(tool.name).toBe('return_skill');
      expect(tool.description).toBeTruthy();
      expect(typeof tool.description).toBe('string');
      expect(tool.description).toContain('return');
    });

    it('应返回 Zod 参数 schema', () => {
      const tool = createReturnSkillTool();

      expect(tool.parameters).toBeDefined();
      expect(tool.parameters._def).toBeDefined();
    });
  });

  describe('RETURN_SKILL 信号', () => {
    it('应返回 RETURN_SKILL 信号', async () => {
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

    it('应支持 partial 状态', async () => {
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

    it('应支持 failed 状态', async () => {
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

    it('status 应默认为 success', async () => {
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

    it('应支持详细的返回结果', async () => {
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

  describe('ToolRegistry 集成', () => {
    it('应能注册到 ToolRegistry', () => {
      const tool = createReturnSkillTool();

      const registry = new ToolRegistry();
      registry.register(tool);

      expect(registry.has('return_skill')).toBe(true);
    });

    it('应生成有效的 LLM 工具 schema', () => {
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

    it('应能通过 ToolRegistry 执行', async () => {
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

    it('应通过 Zod schema 校验参数', async () => {
      const tool = createReturnSkillTool();

      const registry = new ToolRegistry();
      registry.register(tool);

      // 缺少 result 参数应抛出校验错误
      await expect(registry.execute('return_skill', {})).rejects.toThrow();

      // result 类型错误应抛出校验错误
      await expect(registry.execute('return_skill', { result: 123 })).rejects.toThrow();

      // status 值不在枚举中应抛出校验错误
      await expect(
        registry.execute('return_skill', { result: 'test', status: 'invalid' })
      ).rejects.toThrow();
    });
  });
});
