/**
 * @fileoverview Tool Registry
 *
 * Manage tool registration, parameter validation with Zod,
 * and execution.
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import type { HumanRequest } from '../hitl/types.js';
import { compareByCodeUnit } from '../utils/compare.js';

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
  /** Execute function - receives validated parameters and optional abort signal */
  execute: (args: z.infer<TParams>, options?: { signal?: AbortSignal }) => Promise<unknown>;
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
 * Typed HITL suspension signal — a tool requesting the whole run to pause
 * and wait for human input (R2P-108, Rust `ToolError::Suspend` equivalent).
 *
 * This is NOT a failure: it is a typed control signal crossing the registry
 * boundary through the error channel (the Tool interface's return signature
 * stays unchanged — built-in tools, MCP and delegate wrappers are all
 * unaffected). The executing-tool handler intercepts this class BEFORE the
 * error policy, anchors the request to the LLM's action.id, persists it in
 * `context.pendingInterrupts` and ends the advance with the waiting-human
 * phase. The predecessor of this contract was a `__hitl_suspend__` sentinel
 * string inside tool results — unguardable by the compiler (it let an id
 * pairing bug slip through), hence typed.
 */
export class ToolSuspensionError extends Error {
  constructor(public readonly request: HumanRequest) {
    super('tool requested suspension (HITL)');
    this.name = 'ToolSuspensionError';
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
   * @returns true if the tool is registered
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get all registered tool names (sorted by name)
   *
   * Sorting is not cosmetic: the wire `tools` array sits at the very front
   * of the provider prefix cache (token-stream order: tools → system →
   * messages), so enumeration order must be deterministic across registry
   * instances. All public enumerations (names / snapshots / schemas) sort by
   * tool name. (R2P-101a, aligned with Rust 5120a3e.)
   *
   * @returns Array of registered tool names, sorted
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys()).sort(compareByCodeUnit);
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
   * @param options - Optional execution options including abort signal
   * @returns Tool execution result
   * @throws ToolNotFoundError if tool doesn't exist
   * @throws ToolParameterError if validation fails
   */
  async execute(name: string, args: unknown, options?: { signal?: AbortSignal }): Promise<unknown> {
    const tool = this.get(name);
    if (!tool) {
      throw new ToolNotFoundError(name);
    }

    // Validate parameters with Zod
    const parseResult = tool.parameters.safeParse(args);
    if (!parseResult.success) {
      throw new ToolParameterError(name, parseResult.error);
    }

    // Execute with validated parameters and signal
    return tool.execute(parseResult.data, options);
  }

  /**
   * Convert all tools to OpenAI function schema format
   *
   * Output is sorted by tool name — the wire `tools` array must be
   * byte-stable across requests for provider prefix caching (see
   * {@link getToolNames}). (R2P-101a, aligned with Rust 5120a3e.)
   *
   * @returns Array of tool schemas for LLM, sorted by name
   */
  toToolSchemas(): ToolSchema[] {
    return Array.from(this.tools.values())
      .map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: zodToJsonSchema(tool.parameters),
        },
      }))
      .sort((a, b) => compareByCodeUnit(a.function.name, b.function.name));
  }

  /**
   * Clear all registered tools
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * Get all registered tool definitions (sorted by tool name)
   *
   * Used by IToolSchemaFormatter to convert tools for LLM consumption.
   * Sorting keeps every enumeration deterministic for prefix caching
   * (see {@link getToolNames}). (R2P-101a, aligned with Rust 5120a3e.)
   *
   * @returns Array of all registered tools, sorted by name
   */
  getAll(): Tool<z.ZodTypeAny>[] {
    return Array.from(this.tools.values()).sort((a, b) => compareByCodeUnit(a.name, b.name));
  }
}
