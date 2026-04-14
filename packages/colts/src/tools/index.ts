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
  type Tool,
  type ToolSchema,
} from './registry.js';

export { calculatorTool } from './calculator.js';

export {
  createAskHumanTool,
  type QuestionType,
  type Question,
  type Answer,
  type HumanResponse,
  type AskHumanHandler,
} from './ask-human.js';

export {
  ConfirmableRegistry,
  type ConfirmHandler,
  type ConfirmableRegistryOptions,
} from './confirmable-registry.js';
