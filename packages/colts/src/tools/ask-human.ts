/**
 * @fileoverview Human-in-the-Loop Tool
 *
 * Factory function to create an ask_human tool for LLM-human interaction.
 * The LLM can autonomously decide when to ask questions, and the handler
 * (provided by the user) implements the actual UI interaction.
 */

import { z } from 'zod';
import type { Tool } from './registry.js';

// ============================================================
// Types
// ============================================================

/**
 * Supported question types for ask_human
 */
export type QuestionType = 'text' | 'number' | 'single-select' | 'multi-select';

/**
 * A single question to ask the human
 */
export interface Question {
  /** Unique identifier for this question (used to match answers) */
  id: string;
  /** The question text */
  question: string;
  /** Question type */
  type: QuestionType;
  /** Available options (required for single-select and multi-select) */
  options?: string[];
}

/**
 * Answer to a single question
 *
 * Two modes:
 * - direct: The user answered the question as asked
 * - free-text: The user said something unrelated (went off-topic)
 */
export type Answer =
  | { type: 'direct'; value: string | number | string[] }
  | { type: 'free-text'; value: string };

/**
 * Human response mapping (question id → answer)
 */
export type HumanResponse = Record<string, Answer>;

/**
 * Handler function provided by the user to implement UI interaction
 *
 * @param params - Questions and optional context
 * @returns Mapping of question ids to answers
 */
export type AskHumanHandler = (params: {
  questions: Question[];
  context?: string;
}) => Promise<HumanResponse>;

// ============================================================
// Zod schema
// ============================================================

const questionSchema = z.object({
  id: z.string().describe('Unique identifier for this question'),
  question: z.string().describe('The question to ask the human'),
  type: z.enum(['text', 'number', 'single-select', 'multi-select']),
  options: z
    .array(z.string())
    .optional()
    .describe('Available choices (required for single-select and multi-select types)'),
});

const askHumanParameters = z.object({
  questions: z.array(questionSchema).min(1).describe('One or more questions to ask the human'),
  context: z
    .string()
    .optional()
    .describe('Why you are asking, helps the human understand the context'),
});

// ============================================================
// Factory function
// ============================================================

/**
 * Create an ask_human tool
 *
 * The LLM can autonomously decide when to call this tool to ask the human
 * questions. The handler function implements the actual interaction
 * (CLI prompt, WebSocket, UI dialog, etc.).
 *
 * @param handler - User-provided interaction handler
 * @returns A Tool that can be registered in a ToolRegistry
 *
 * @example
 * ```typescript
 * // CLI usage
 * const askHuman = createAskHumanTool({
 *   handler: async ({ questions }) => {
 *     const answers: HumanResponse = {};
 *     for (const q of questions) {
 *       const input = readline.question(`${q.question} > `);
 *       answers[q.id] = { type: 'direct', value: input };
 *     }
 *     return answers;
 *   },
 * });
 *
 * registry.register(askHuman);
 * ```
 */
export function createAskHumanTool(handler: AskHumanHandler): Tool<typeof askHumanParameters> {
  return {
    name: 'ask_human',
    description:
      'Ask the human one or more questions when you need clarification, input, or a decision. ' +
      'Use text/number for open-ended answers, single-select for one choice, multi-select for multiple choices.',
    parameters: askHumanParameters,
    execute: async ({ questions, context }) => {
      return handler({ questions, context });
    },
  };
}
