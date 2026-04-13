/**
 * @fileoverview Skills module
 *
 * Skill system type definitions and provider implementations.
 */

export {
  type SkillManifest,
  type ISkillProvider,
  type SkillSignal,
  isSkillSignal,
} from './types.js';

// Re-export from main types.ts for convenience
export type { SkillStackFrame, SkillState } from '../types.js';

export { FilesystemSkillProvider } from './filesystem-provider.js';

export { createLoadSkillTool } from './load-skill-tool.js';
export { createReturnSkillTool } from './return-skill-tool.js';
