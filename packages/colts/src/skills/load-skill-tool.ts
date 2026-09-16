/**
 * @fileoverview Built-in load_skill tool
 *
 * Allows the agent to proactively load skill instructions for nested calling.
 */
import { z } from 'zod';

import type { ISkillProvider, SkillSignal } from './types.js';
import type { Tool } from '../tools/registry.js';

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
      "Load a skill's detailed instructions by name. Use this when you need to follow a specific skill's workflow or guidelines. The result also lists the skill's bundled resource and script files — use those exact paths with read_skill_resource / run_skill_script; do not construct paths.",
    parameters: z.object({
      name: z.string().describe('The skill name to load'),
      task: z.string().optional().describe('Specific task description for the sub-skill'),
    }),
    execute: async ({ name, task }): Promise<SkillSignal | string> => {
      const manifest = await skillProvider.getManifest(name);
      if (!manifest) {
        const availableSkills = await skillProvider.listSkills();
        return {
          type: 'SKILL_NOT_FOUND',
          requested: name,
          available: availableSkills.map((s) => s.name),
        };
      }

      const instructions = await skillProvider.loadInstructions(name);

      // Attach the resource/script inventory: read_skill_resource /
      // run_skill_script path inputs may only come from this inventory or
      // references in the skill's instructions — without it the model can
      // only guess paths and the load likely derails. Empty arrays (not
      // undefined) keep the delivered shape stable, mirroring Rust's
      // unwrap_or_default. (R2P-114, aligned with Rust c78cfcc.)
      // Return signal for Runner to handle state switching
      return {
        type: 'SWITCH_SKILL',
        to: name,
        instructions,
        task: task || 'Execute as instructed',
        resources: manifest.resources ?? [],
        scripts: manifest.scripts ?? [],
      };
    },
  };
}
