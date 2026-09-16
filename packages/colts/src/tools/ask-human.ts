/**
 * @fileoverview Human-in-the-Loop Tool
 *
 * Factory function to create an ask_human tool for LLM-human interaction.
 * The LLM can autonomously decide when to ask questions, and the handler
 * (provided by the user) implements the actual UI interaction.
 */

import { z } from 'zod';

import type { Tool } from './registry.js';
import { ToolSuspensionError } from './registry.js';

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
 * ask_human suspend signal (non-blocking HITL, Rust `AskOutcome::Suspend`).
 *
 * Returned by hosts that want the run to PAUSE and surface the questions
 * (run ends in the waiting-human phase; the unanswered request is persisted
 * in `context.pendingInterrupts`) instead of parking the tool call on a
 * promise. Blocking hosts keep returning plain answers.
 */
export interface AskSuspendSignal {
  type: 'suspend';
  /** Questions to surface to the human */
  questions: Question[];
  /** Optional context from the agent */
  context?: string;
  /**
   * Transitional tool-call id (e.g. a bridge-invented `human-<uuid>` used
   * as the frontend requestId). The kernel retargets the persisted request
   * to the LLM's action.id — the value here never reaches state.
   */
  toolCallId?: string;
}

/**
 * ask_human handler outcome (Rust `AskOutcome` vocabulary): the human's
 * answers (blocking mode), or a suspend signal (non-blocking HITL).
 */
export type AskOutcome = HumanResponse | AskSuspendSignal;

/**
 * Discriminant for {@link AskSuspendSignal} within {@link AskOutcome}
 * (answers are a plain `Record`, so the `type` key is unambiguous).
 */
export function isAskSuspendSignal(outcome: AskOutcome): outcome is AskSuspendSignal {
  return (
    typeof outcome === 'object' &&
    outcome !== null &&
    (outcome as AskSuspendSignal).type === 'suspend'
  );
}

/**
 * Handler function provided by the user to implement UI interaction
 *
 * @param params - Questions, optional context, and optional abort signal
 * @returns Mapping of question ids to answers (blocking), or a suspend
 *   signal requesting the run to pause and wait for the human
 */
export type AskHumanHandler = (params: {
  questions: Question[];
  context?: string;
  signal?: AbortSignal;
}) => Promise<AskOutcome>;

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
    execute: async ({ questions, context }, options) => {
      const outcome = await handler({ questions, context, signal: options?.signal });
      if (isAskSuspendSignal(outcome)) {
        // A suspend with nothing to ask is a host bug — surface it as a
        // plain tool error (error-policy path), never as a suspension:
        // an empty/undefined question list must not reach pendingInterrupts.
        if (!outcome.questions || outcome.questions.length === 0) {
          throw new Error(
            'ask_human suspend signal requires at least one question (got none — refusing to suspend with an empty question list)'
          );
        }
        // Typed suspension: the tool layer converts the host's suspend
        // signal into ToolSuspensionError; the kernel's executing-tool
        // handler intercepts it before the error policy, anchors the id to
        // the LLM's action.id and persists the request. Not a failure.
        throw new ToolSuspensionError({
          type: 'question',
          questions: outcome.questions,
          context: outcome.context,
          // Transitional only — the kernel retargets to action.id.
          toolCallId: outcome.toolCallId ?? `human-${globalThis.crypto.randomUUID()}`,
        });
      }
      return outcome;
    },
  };
}
