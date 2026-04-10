/**
 * @fileoverview load_skill 内置工具
 *
 * 让 agent 能主动加载 skill 指令。
 */
import { z } from 'zod';
import type { Tool } from '../tools/registry.js';
import type { ISkillProvider } from './types.js';

/**
 * 创建 load_skill 工具
 *
 * @param skillProvider - Skill 提供者实例
 * @returns Tool 定义
 */
export function createLoadSkillTool(skillProvider: ISkillProvider): Tool {
  return {
    name: 'load_skill',
    description:
      "Load a skill's detailed instructions by name. Use this when you need to follow a specific skill's workflow or guidelines.",
    parameters: z.object({
      name: z.string().describe('The skill name to load'),
    }),
    execute: async ({ name }) => {
      const manifest = skillProvider.getManifest(name);
      if (!manifest) {
        return `Error: Skill '${name}' not found. Available skills: ${skillProvider
          .listSkills()
          .map((s) => s.name)
          .join(', ')}`;
      }
      const instructions = await skillProvider.loadInstructions(name);
      return instructions;
    },
  };
}
