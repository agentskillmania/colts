/**
 * @fileoverview Interaction state types — shared state for AskHuman and Confirm dialogs
 *
 * When agent calls ask_human tool or a dangerous tool requiring confirmation,
 * MainTUI switches to interaction mode and renders the corresponding dialog component.
 */

import type { Question, HumanResponse } from '@agentskillmania/colts';

/**
 * Interaction state
 *
 * - `none`: Normal chat mode
 * - `ask-human`: Agent requests user to answer questions
 * - `confirm`: Dangerous tool requires user confirmation
 */
export type InteractionState =
  | { type: 'none' }
  | {
      type: 'ask-human';
      questions: Question[];
      context?: string;
      resolve: (response: HumanResponse) => void;
    }
  | {
      type: 'confirm';
      toolName: string;
      args: Record<string, unknown>;
      resolve: (approved: boolean) => void;
    };
