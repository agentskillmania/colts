/**
 * @fileoverview Built-in load_skill tool
 *
 * Allows the agent to proactively load skill instructions for nested calling.
 */
import { z } from 'zod';
import type { Tool } from '../tools/registry.js';
import type { ISkillProvider, SkillSignal } from './types.js';

/**
 * Create the load_skill tool
 *
 * @param skillProvider - Skill provider instance
 * @returns Tool definition
 */
export function createLoadSkillTool(skillProvider: ISkillProvider): Tool {
  return {
    name: 'load_skill',
    description:
      "Load a skill's detailed instructions by name. Use this when you need to follow a specific skill's workflow or guidelines. The skill instructions will be loaded and you will switch to that skill mode.",
    parameters: z.object({
      name: z.string().describe('The skill name to load'),
      task: z.string().optional().describe('Specific task description for the sub-skill'),
    }),
    execute: async ({ name, task }): Promise<SkillSignal | string> => {
      const manifest = skillProvider.getManifest(name);
      if (!manifest) {
        const availableSkills = skillProvider.listSkills();
        return {
          type: 'SKILL_NOT_FOUND',
          requested: name,
          available: availableSkills.map((s) => s.name),
        };
      }

      const instructions = await skillProvider.loadInstructions(name);

      // Return signal for Runner to handle state switching
      return {
        type: 'SWITCH_SKILL',
        to: name,
        instructions,
        task: task || 'Execute as instructed',
      };
    },
  };
}
