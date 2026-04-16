/**
 * @fileoverview Execution Engine module entry point
 *
 * Re-exports phase handler interfaces, router, default handlers,
 * and concrete handler classes for custom composition.
 */

export type { IPhaseHandler, PhaseHandlerContext } from './types.js';
export { PhaseRouter } from './router.js';
export { createDefaultPhaseHandlers } from './default-registry.js';
export {
  IdleHandler,
  PreparingHandler,
  CallingLLMHandler,
  LLMResponseHandler,
  ParsingHandler,
  ParsedHandler,
  ExecutingToolHandler,
  ToolResultHandler,
  CompletedHandler,
  ErrorHandler,
} from './handlers/index.js';
