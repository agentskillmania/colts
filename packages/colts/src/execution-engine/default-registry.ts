/**
 * @fileoverview Default Phase Handler Registry
 *
 * Creates the standard set of 10 phase handlers for the ReAct cycle.
 */

import type { IPhaseHandler } from './types.js';
import { IdleHandler } from './handlers/idle-handler.js';
import { PreparingHandler } from './handlers/preparing-handler.js';
import { CallingLLMHandler } from './handlers/calling-llm-handler.js';
import { LLMResponseHandler } from './handlers/llm-response-handler.js';
import { ParsingHandler } from './handlers/parsing-handler.js';
import { ParsedHandler } from './handlers/parsed-handler.js';
import { ExecutingToolHandler } from './handlers/executing-tool-handler.js';
import { ToolResultHandler } from './handlers/tool-result-handler.js';
import { CompletedHandler } from './handlers/completed-handler.js';
import { ErrorHandler } from './handlers/error-handler.js';

/**
 * Create the default set of phase handlers
 *
 * @returns Array of 10 handlers covering all ReAct cycle phases
 */
export function createDefaultPhaseHandlers(): IPhaseHandler[] {
  return [
    new IdleHandler(),
    new PreparingHandler(),
    new CallingLLMHandler(),
    new LLMResponseHandler(),
    new ParsingHandler(),
    new ParsedHandler(),
    new ExecutingToolHandler(),
    new ToolResultHandler(),
    new CompletedHandler(),
    new ErrorHandler(),
  ];
}
