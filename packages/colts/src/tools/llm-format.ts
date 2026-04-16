/**
 * @fileoverview Tool format conversion for LLM calls
 *
 * Converts ToolRegistry schemas to pi-ai Tool format.
 */

import type { Tool } from '@mariozechner/pi-ai';
import type { IToolRegistry } from '../types.js';
import type { ToolSchema } from './registry.js';

/**
 * Convert ToolRegistry schemas to pi-ai Tool format
 *
 * @param registry - Optional tool registry
 * @returns Array of tools in pi-ai format, or undefined if no registry provided
 */
export function getToolsForLLM(registry?: IToolRegistry): Tool[] | undefined {
  if (!registry) return undefined;

  const schemas = registry.toToolSchemas();
  return schemas.map((schema: ToolSchema) => ({
    name: schema.function.name,
    description: schema.function.description,
    parameters: schema.function.parameters as unknown as Tool['parameters'],
  }));
}
