/**
 * @fileoverview Human-in-the-Loop V2 Types
 *
 * Non-blocking HITL: requests are surfaced as message types,
 * runner returns cleanly, caller provides responses asynchronously.
 */

// ─── Questions & Answers ────────────────────────────────────────

/** Single question presented to the human */
export interface HumanQuestion {
  /** Unique question identifier */
  id: string;
  /** Question text */
  question: string;
  /** Answer format */
  type: 'text' | 'number' | 'single-select' | 'multi-select';
  /** Options for single-select / multi-select */
  options?: string[];
}

/** Human answer to a single question */
export type HumanAnswer =
  | { type: 'direct'; value: string | number | string[] }
  | { type: 'free-text'; value: string };

// ─── Request & Response ─────────────────────────────────────────

/** Unified human request (non-blocking, surfaced by runner) */
export type HumanRequest =
  | {
      type: 'question';
      /** Questions to ask the human */
      questions: HumanQuestion[];
      /** Optional context from the agent */
      context?: string;
      /** Tool call ID (links response to the LLM's tool call) */
      toolCallId: string;
    }
  | {
      type: 'tool-confirm';
      /** Tool name requiring confirmation */
      toolName: string;
      /** Arguments the LLM wants to pass */
      args: Record<string, unknown>;
      /** Tool call ID (links response to the LLM's tool call) */
      toolCallId: string;
    };

/** Unified human response (provided by caller) */
export type HumanResponse =
  | {
      type: 'question';
      /** Answers keyed by question ID */
      answers: Record<string, HumanAnswer>;
    }
  | {
      type: 'tool-confirm';
      /** Whether the human approved the tool execution */
      approved: boolean;
    };

// ─── Configuration ──────────────────────────────────────────────

/** V2 HITL configuration for RunnerOptions */
export interface HitlConfig {
  /** Enable non-blocking HITL */
  enabled: true;
  /** Tools requiring confirmation (non-blocking) */
  confirmTools?: string[];
}
