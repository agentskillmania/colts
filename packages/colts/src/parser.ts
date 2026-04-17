/**
 * @fileoverview Response Parser
 *
 * Parse LLM Function Calling response to extract Thought and Tool Calls.
 */

import type { LLMResponse } from '@agentskillmania/llm-client';

/**
 * Tool call extracted from LLM response
 */
export interface ToolCall {
  /** Unique identifier for this tool call */
  id: string;
  /** Tool name */
  name: string;
  /** Tool arguments as a JSON object */
  arguments: Record<string, unknown>;
}

/**
 * Result of parsing LLM response
 */
export interface ParseResult {
  /** LLM's reasoning/thinking process */
  thought: string;
  /** Tool calls to execute (empty if final answer) */
  toolCalls: ToolCall[];
  /** Whether this is a final answer (no tool calls needed) */
  isFinalAnswer: boolean;
}

/**
 * ParseError - thrown when response parsing fails
 */
export class ParseError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

/**
 * Parse LLM response to extract thought and tool calls
 *
 * @param response - LLM response from llm-client
 * @returns ParseResult with thought, toolCalls, and isFinalAnswer flag
 * @throws ParseError if parsing fails
 *
 * @example
 * ```typescript
 * const result = parseResponse(llmResponse);
 *
 * if (result.isFinalAnswer) {
 *   console.log('Final answer:', result.thought);
 * } else {
 *   console.log('Need to execute tools:', result.toolCalls);
 * }
 * ```
 */
export function parseResponse(response: LLMResponse): ParseResult {
  const rawContent = response.content ?? '';

  // 1. Native thinking from supported models (e.g. Claude)
  let thought = response.thinking ?? '';
  // 2. Prompt-level thinking: extract<think>...</think>
  if (!thought) {
    const thinkMatch = rawContent.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
      thought = thinkMatch[1].trim();
    }
  }

  // Extract tool calls from response (use original toolCalls metadata)
  const toolCalls: ToolCall[] = [];

  if (response.toolCalls && response.toolCalls.length > 0) {
    for (const call of response.toolCalls) {
      try {
        // Parse arguments JSON string to object
        const args = parseArguments(call.arguments);

        toolCalls.push({
          id: call.id,
          name: call.name,
          arguments: args,
        });
      } catch (error) {
        throw new ParseError(
          `Failed to parse arguments for tool '${call.name}': ${error instanceof Error ? error.message : String(error)}`,
          error
        );
      }
    }
  }

  // Determine if this is a final answer
  const isFinalAnswer = toolCalls.length === 0;

  return {
    thought,
    toolCalls,
    isFinalAnswer,
  };
}

/**
 * Parse tool arguments from various formats
 *
 * @param args - Arguments as string, object, or unknown
 * @returns Parsed arguments as Record
 * @throws Error if parsing fails
 *
 * @private
 */
function parseArguments(args: unknown): Record<string, unknown> {
  // If already an object, return as-is
  if (typeof args === 'object' && args !== null && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }

  // If string, try to parse as JSON
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      throw new Error(`Parsed arguments is not an object: ${typeof parsed}`);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON: ${error.message}`);
      }
      throw error;
    }
  }

  throw new Error(`Invalid arguments type: ${typeof args}`);
}

/**
 * Check if a parsed result requires tool execution
 *
 * @param result - Parse result from LLM response
 * @returns true if tool calls need to be executed
 */
export function requiresToolExecution(result: ParseResult): boolean {
  return result.toolCalls.length > 0;
}

/**
 * Format tool calls for display/logging
 *
 * @param toolCalls - Array of tool calls to format
 * @returns Formatted string representation of the tool calls
 */
export function formatToolCalls(toolCalls: ToolCall[]): string {
  if (toolCalls.length === 0) {
    return 'No tool calls';
  }

  return toolCalls.map((call) => `${call.name}(${JSON.stringify(call.arguments)})`).join(', ');
}
