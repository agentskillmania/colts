/**
 * @fileoverview Tools module
 *
 * Tool registry and built-in tools for ReAct agents.
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
