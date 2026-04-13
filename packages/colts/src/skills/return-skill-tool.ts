/**
 * @fileoverview Built-in return_skill tool
 *
 * Allows a sub-skill to return results to its parent skill.
 */
import { z } from 'zod';
import type { Tool } from '../tools/registry.js';
import type { SkillSignal } from './types.js';

/**
 * Create the return_skill tool
 *
 * @returns Tool definition
 */
export function createReturnSkillTool(): Tool {
  return {
    name: 'return_skill',
    description:
      'Return from the current sub-skill to the parent skill with results. Use this when you have completed the assigned task and need to return control to the parent skill.',
    parameters: z.object({
      result: z
        .string()
        .describe('The result to return to the parent skill (be specific and detailed)'),
      status: z
        .enum(['success', 'partial', 'failed'])
        .default('success')
        .describe('Completion status of the sub-skill task'),
    }),
    execute: async ({ result, status }): Promise<SkillSignal> => {
      // Return signal for Runner to handle state switching
      // status has default 'success' in Zod schema, but we ensure it here too
      return {
        type: 'RETURN_SKILL',
        result,
        status: status ?? 'success',
      };
    },
  };
}
