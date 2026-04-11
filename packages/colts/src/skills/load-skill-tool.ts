/**
 * @fileoverview Built-in load_skill tool
 *
 * Allows the agent to proactively load skill instructions.
 */
import { z } from 'zod';
import type { Tool } from '../tools/registry.js';
import type { ISkillProvider } from './types.js';

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
