/**
 * @fileoverview Tools module
 *
 * Exports the ToolRegistry implementation, built-in tools (calculator),
 * human-in-the-loop support (ask_human), and the confirmable registry wrapper.
 */

export {
  ToolRegistry,
  ToolNotFoundError,
  ToolParameterError,
  ToolSuspensionError,
  type Tool,
  type ToolSchema,
} from './registry.js';

export { calculatorTool } from './calculator.js';

export {
  createAskHumanTool,
  isAskSuspendSignal,
  type QuestionType,
  type Question,
  type Answer,
  type HumanResponse,
  type AskHumanHandler,
  type AskSuspendSignal,
  type AskOutcome,
} from './ask-human.js';

export {
  ConfirmableRegistry,
  type ConfirmHandler,
  type ConfirmableRegistryOptions,
} from './confirmable-registry.js';

export type { IToolSchemaFormatter } from './schema-formatter.js';
export { DefaultToolSchemaFormatter } from './schema-formatter.js';
