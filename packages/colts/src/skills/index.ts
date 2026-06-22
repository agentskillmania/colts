/**
 * @fileoverview Skills module
 *
 * Exports skill type definitions, the filesystem skill provider,
 * and the built-in load_skill tool. (return_skill was removed: skill
 * instructions now persist as the load_skill tool result content.)
 */

export {
  type SkillManifest,
  type ISkillProvider,
  type SkillSignal,
  isSkillSignal,
} from './types.js';

// Re-export from main types.ts for convenience
export type { SkillState } from '../types.js';

export { FilesystemSkillProvider } from './filesystem-provider.js';

export { createLoadSkillTool } from './load-skill-tool.js';

export {
  applySkillSignal,
  formatSkillToolResult,
  type SkillSignalResult,
} from './signal-handler.js';
