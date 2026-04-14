/**
 * @fileoverview Sub-agent module
 *
 * Exports sub-agent type definitions and the delegate tool factory
 * for delegating tasks from a parent agent to specialized sub-agents.
 */

export type { SubAgentConfig, DelegateResult, SubAgentStreamEvent } from './types.js';
export { createDelegateTool } from './delegate-tool.js';
export type { DelegateToolDeps } from './delegate-tool.js';
