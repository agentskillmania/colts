/**
 * @fileoverview Tool Schema Formatter
 *
 * Converts tool definitions to the format required by LLM providers.
 * Abstracted from ToolRegistry to allow custom formatting for different
 * providers (pi-ai, MCP, etc.).
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Tool } from './registry.js';
import type { Tool as PiAiTool } from '@mariozechner/pi-ai';

/**
 * Interface for converting tool definitions to LLM-compatible format
 *
 * Default implementation converts Zod schemas via zodToJsonSchema.
 * Custom implementations can support MCP inputSchema, OpenAI function
 * calling format, or any other provider-specific schema format.
 */
export interface IToolSchemaFormatter {
  /**
   * Format tool definitions for LLM consumption
   *
   * @param tools - Array of tool definitions with Zod parameters
   * @returns Array of tools in the target provider format
   */
  format(tools: Tool[]): PiAiTool[];
}

/**
 * Default formatter: Zod schema → JSON Schema → pi-ai Tool format
 *
 * Skips the intermediate OpenAI function-calling wrapper and produces
 * the flat { name, description, parameters } structure directly.
 */
export class DefaultToolSchemaFormatter implements IToolSchemaFormatter {
  format(tools: Tool[]): PiAiTool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.parameters) as unknown as PiAiTool['parameters'],
    }));
  }
}
