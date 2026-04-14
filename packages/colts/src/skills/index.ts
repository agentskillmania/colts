/**
 * @fileoverview Skills module
 *
 * Exports skill type definitions, the filesystem skill provider,
 * and built-in tools for loading and returning from skills.
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

export {
  applySkillSignal,
  formatSkillToolResult,
  formatSkillAnswer,
  type SkillSignalResult,
} from './signal-handler.js';
