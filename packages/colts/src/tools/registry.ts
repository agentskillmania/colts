/**
 * @fileoverview Step 3: Tool Registry
 *
 * Manage tool registration, parameter validation with Zod,
 * and execution.
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Tool definition interface using Zod for parameter validation
 */
export interface Tool<TParams extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Tool name (must be unique within registry) */
  name: string;
  /** Tool description (shown to LLM) */
  description: string;
  /** Zod schema for parameter validation */
  parameters: TParams;
  /** Execute function - receives validated parameters */
  execute: (args: z.infer<TParams>) => Promise<unknown>;
}

/**
 * Tool schema in OpenAI function format
 */
export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}

/**
 * Error thrown when tool is not found
 */
export class ToolNotFoundError extends Error {
  constructor(name: string) {
    super(`Tool not found: ${name}`);
    this.name = 'ToolNotFoundError';
  }
}

/**
 * Error thrown when parameter validation fails
 */
export class ToolParameterError extends Error {
  constructor(
    toolName: string,
    public readonly zodError: z.ZodError
  ) {
    const issues = zodError.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    super(`Parameter validation failed for tool '${toolName}': ${issues}`);
    this.name = 'ToolParameterError';
  }
}

/**
 * ToolRegistry - manages tool registration and execution
 *
 * @example
 * ```typescript
 * const registry = new ToolRegistry();
 *
 * registry.register({
 *   name: 'calculate',
 *   description: 'Calculate math expression',
 *   parameters: z.object({ expression: z.string() }),
 *   execute: async ({ expression }) => eval(expression).toString(),
 * });
 *
 * // Execute with automatic validation
 * const result = await registry.execute('calculate', { expression: '2+2' });
 * ```
 */
export class ToolRegistry {
  private tools = new Map<string, Tool<z.ZodTypeAny>>();

  /**
   * Register a tool
   *
   * @param tool - Tool definition
   * @throws Error if tool name already exists
   */
  register(tool: Tool<z.ZodTypeAny>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool '${tool.name}' is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Unregister a tool
   *
   * @param name - Tool name
   * @returns true if tool was removed, false if not found
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Get a tool by name
   *
   * @param name - Tool name
   * @returns Tool or undefined if not found
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if tool exists
   *
   * @param name - Tool name
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get all registered tool names
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get number of registered tools
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * Execute a tool with automatic parameter validation
   *
   * @param name - Tool name
   * @param args - Raw arguments (will be validated)
   * @returns Tool execution result
   * @throws ToolNotFoundError if tool doesn't exist
   * @throws ToolParameterError if validation fails
   */
  async execute(
    name: string,
    args: unknown,
    _options?: { signal?: AbortSignal }
  ): Promise<unknown> {
    const tool = this.get(name);
    if (!tool) {
      throw new ToolNotFoundError(name);
    }

    // Validate parameters with Zod
    const parseResult = tool.parameters.safeParse(args);
    if (!parseResult.success) {
      throw new ToolParameterError(name, parseResult.error);
    }

    // Execute with validated parameters
    return tool.execute(parseResult.data);
  }

  /**
   * Convert all tools to OpenAI function schema format
   *
   * @returns Array of tool schemas for LLM
   */
  toToolSchemas(): ToolSchema[] {
    return Array.from(this.tools.values()).map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.parameters),
      },
    }));
  }

  /**
   * Clear all registered tools
   */
  clear(): void {
    this.tools.clear();
  }
}
