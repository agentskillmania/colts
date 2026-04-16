/**
 * @fileoverview Tool format conversion for LLM calls
 *
 * Converts tool definitions from the registry to pi-ai Tool format
 * via IToolSchemaFormatter. No intermediate OpenAI function format.
 */

import type { Tool } from '@mariozechner/pi-ai';
import type { IToolRegistry } from '../types.js';
import type { IToolSchemaFormatter } from './schema-formatter.js';
import { DefaultToolSchemaFormatter } from './schema-formatter.js';

/** Shared singleton for the default formatter */
const defaultFormatter = new DefaultToolSchemaFormatter();

/**
 * Convert tool registry to pi-ai Tool format for LLM calls
 *
 * @param registry - Optional tool registry
 * @param formatter - Optional schema formatter (defaults to DefaultToolSchemaFormatter)
 * @returns Array of tools in pi-ai format, or undefined if no registry provided
 */
export function getToolsForLLM(
  registry?: IToolRegistry,
  formatter?: IToolSchemaFormatter
): Tool[] | undefined {
  if (!registry) return undefined;

  const fmt = formatter ?? defaultFormatter;
  const tools = registry.getAll?.() ?? [];
  return fmt.format(tools);
}
