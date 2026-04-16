/**
 * @fileoverview Confirmable Tool Registry
 *
 * A registry wrapper that requires human confirmation before executing
 * specified tools. Enables safe execution of dangerous operations
 * (file deletion, email sending, etc.) by intercepting at the registry level.
 */

import type { IToolRegistry } from '../types.js';
import type { ToolSchema, Tool } from './registry.js';

/**
 * Confirmation handler provided by the upper application
 *
 * @param toolName - Name of the tool requesting execution
 * @param args - Arguments the LLM wants to pass to the tool
 * @returns Whether the human approved the execution
 */
export type ConfirmHandler = (toolName: string, args: Record<string, unknown>) => Promise<boolean>;

/**
 * Configuration for ConfirmableRegistry
 */
export interface ConfirmableRegistryOptions {
  /** Handler called when a tool needs confirmation */
  confirm: ConfirmHandler;
  /** List of tool names that require human confirmation */
  confirmTools: string[];
}

/**
 * Tool registry wrapper that enforces human confirmation for specified tools.
 *
 * Wraps an existing IToolRegistry and intercepts execute() calls.
 * Tools listed in confirmTools will trigger the confirm handler before execution.
 * If the handler returns false, execution is rejected with an error message
 * that the LLM can see and react to.
 *
 * @example
 * ```typescript
 * const inner = new ToolRegistry();
 * inner.register(deleteFileTool);
 * inner.register(calculatorTool);
 *
 * const registry = new ConfirmableRegistry(inner, {
 *   confirmTools: ['delete_file'],
 *   confirm: async (toolName, args) => {
 *     return window.confirm(`Execute ${toolName} with ${JSON.stringify(args)}?`);
 *   },
 * });
 *
 * const runner = new AgentRunner({ ..., toolRegistry: registry });
 * ```
 */
export class ConfirmableRegistry implements IToolRegistry {
  private inner: IToolRegistry;
  private options: ConfirmableRegistryOptions;

  constructor(inner: IToolRegistry, options: ConfirmableRegistryOptions) {
    this.inner = inner;
    this.options = options;
  }

  /**
   * Execute a tool with optional human confirmation
   *
   * @param name - Tool name
   * @param args - Tool arguments
   * @param options - Optional execution options including abort signal
   * @returns Tool execution result
   * @throws Error if execution is rejected by human
   */
  async execute(name: string, args: unknown, options?: { signal?: AbortSignal }): Promise<unknown> {
    if (this.needsConfirm(name)) {
      const approved = await this.options.confirm(name, args as Record<string, unknown>);
      if (!approved) {
        throw new Error(`Tool execution rejected by human: ${name}`);
      }
    }
    return this.inner.execute(name, args, options);
  }

  /**
   * Get JSON schemas of all tools (for LLM)
   *
   * @returns Array of tool schemas
   */
  toToolSchemas(): ToolSchema[] {
    return this.inner.toToolSchemas();
  }

  /**
   * Register a new tool
   *
   * @param tool - Tool definition
   */
  register(tool: Parameters<IToolRegistry['register']>[0]): void {
    return this.inner.register(tool);
  }

  /**
   * Unregister a tool by name
   *
   * @param name - Tool name
   * @returns true if the tool was removed
   */
  unregister(name: string): boolean {
    return this.inner.unregister(name);
  }

  /**
   * Check if tool exists
   *
   * @param name - Tool name
   * @returns true if the tool is registered
   */
  has(name: string): boolean {
    return this.inner.has(name);
  }

  /**
   * Get all registered tool names
   *
   * @returns Array of registered tool names
   */
  getToolNames(): string[] {
    return this.inner.getToolNames();
  }

  /**
   * Get a tool by name
   *
   * @param name - Tool name
   * @returns Tool definition or undefined if not found
   */
  get(name: string): ReturnType<IToolRegistry['get']> {
    return this.inner.get(name);
  }

  /**
   * Check if a tool requires confirmation
   *
   * @param name - Tool name
   * @returns true if the tool is in the confirmTools list
   */
  private needsConfirm(name: string): boolean {
    return this.options.confirmTools.includes(name);
  }

  /**
   * Get all registered tool definitions
   *
   * Delegates to inner registry's getAll() for IToolSchemaFormatter.
   *
   * @returns Array of all registered tools
   */
  getAll(): Tool[] {
    if (this.inner.getAll) {
      return this.inner.getAll();
    }
    return [];
  }
}
