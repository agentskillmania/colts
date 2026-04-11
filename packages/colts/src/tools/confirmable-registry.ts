/**
 * @fileoverview Confirmable Tool Registry
 *
 * A registry wrapper that requires human confirmation before executing
 * specified tools. Enables safe execution of dangerous operations
 * (file deletion, email sending, etc.) by intercepting at the registry level.
 */

import type { IToolRegistry } from '../types.js';
import type { ToolSchema } from './registry.js';

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

  async execute(name: string, args: unknown, options?: { signal?: AbortSignal }): Promise<unknown> {
    if (this.needsConfirm(name)) {
      const approved = await this.options.confirm(name, args as Record<string, unknown>);
      if (!approved) {
        throw new Error(`Tool execution rejected by human: ${name}`);
      }
    }
    return this.inner.execute(name, args, options);
  }

  toToolSchemas(): ToolSchema[] {
    return this.inner.toToolSchemas();
  }

  register(tool: Parameters<IToolRegistry['register']>[0]): void {
    return this.inner.register(tool);
  }

  unregister(name: string): boolean {
    return this.inner.unregister(name);
  }

  has(name: string): boolean {
    return this.inner.has(name);
  }

  getToolNames(): string[] {
    return this.inner.getToolNames();
  }

  get(name: string): ReturnType<IToolRegistry['get']> {
    return this.inner.get(name);
  }

  private needsConfirm(name: string): boolean {
    return this.options.confirmTools.includes(name);
  }
}
