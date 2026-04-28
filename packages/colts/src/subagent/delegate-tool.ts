/**
 * @fileoverview Delegate Tool factory function
 *
 * Creates the 'delegate' tool that allows the parent agent to delegate tasks to sub-agents.
 * Sub-agents have independent instructions, tools, and maxSteps configuration.
 */

import { z } from 'zod';
import type { Tool } from '../tools/registry.js';
import type { SubAgentConfig, DelegateResult, ISubAgentFactory } from './types.js';
import { DefaultSubAgentFactory } from './types.js';
import { createAgentState, addUserMessage } from '../state/index.js';
import type { ILLMProvider, IToolRegistry } from '../types.js';

/**
 * Dependency injection interface for the delegate tool
 */
export interface DelegateToolDeps {
  /** Sub-agent configuration map (name → SubAgentConfig) */
  subAgentConfigs: Map<string, SubAgentConfig>;
  /** LLM provider instance */
  llmProvider: ILLMProvider;
  /** Parent agent's model identifier, passed through to sub-agent */
  model?: string;
  /** Default max steps for sub-agents (default: 10) */
  defaultMaxSteps?: number;
  /** Parent agent's tool registry for inheriting tool implementations */
  parentToolRegistry: IToolRegistry;
  /** Sub-agent factory (defaults to DefaultSubAgentFactory) */
  subAgentFactory?: ISubAgentFactory;
}

/**
 * Create the delegate tool
 *
 * The parent agent uses this tool to delegate specific tasks to specialized sub-agents.
 * Sub-agents have independent instructions, tools, and maxSteps configuration.
 *
 * @param deps - Dependency injection parameters
 * @returns Tool instance, registerable with ToolRegistry
 *
 * @example
 * ```typescript
 * const subAgents = new Map<string, SubAgentConfig>();
 * subAgents.set('researcher', {
 *   name: 'researcher',
 *   description: 'Information research specialist',
 *   config: { name: 'researcher', instructions: 'You research topics...', tools: [] },
 *   maxSteps: 5,
 * });
 *
 * const delegateTool = createDelegateTool({
 *   subAgentConfigs: subAgents,
 *   llmProvider: myLLMClient,
 *   parentToolRegistry: parentRegistry,
 * });
 *
 * registry.register(delegateTool);
 * ```
 */
export function createDelegateTool(deps: DelegateToolDeps): Tool {
  const {
    subAgentConfigs,
    llmProvider,
    model,
    defaultMaxSteps = 10,
    parentToolRegistry,
    subAgentFactory = new DefaultSubAgentFactory(defaultMaxSteps),
  } = deps;

  return {
    name: 'delegate',
    description:
      'Delegate a task to a specialized sub-agent. Use when a task requires specific expertise or tools that a sub-agent possesses.',
    parameters: z.object({
      agent: z.string().describe('Name of the sub-agent to use'),
      task: z.string().describe('Clear description of the task to delegate'),
      extraInstructions: z
        .string()
        .optional()
        .describe("Additional instructions appended to the sub-agent's base personality."),
    }),
    execute: async ({ agent, task, extraInstructions }, options) => {
      const config = subAgentConfigs.get(agent);
      if (!config) {
        const available = Array.from(subAgentConfigs.keys()).join(', ');
        return {
          answer: `Error: Unknown sub-agent '${agent}'. Available: ${available}`,
          totalSteps: 0,
          finalState: null,
        } satisfies DelegateResult;
      }

      // Build sub-agent instructions, optionally appending extra instructions
      let instructions = config.config.instructions;
      if (extraInstructions) {
        instructions = instructions + '\n\n' + extraInstructions;
      }

      // Create sub-agent state
      const subConfig = { ...config.config, instructions };
      const subState = createAgentState(subConfig);
      const stateWithTask = addUserMessage(subState, task);

      // Build sub-agent tools from parent registry
      const subAgentTools: Tool[] = [];
      const canDelegate = config.allowDelegation ?? false;

      for (const toolDef of config.config.tools) {
        // Skip delegate tool if sub-agent is not allowed to delegate
        if (toolDef.name === 'delegate' && !canDelegate) {
          continue;
        }

        // Look up tool implementation from parent registry
        const parentTool = parentToolRegistry.get(toolDef.name);
        if (parentTool) {
          // Use the parent's tool implementation (including execute function)
          subAgentTools.push({
            name: parentTool.name,
            description: parentTool.description,
            parameters: parentTool.parameters,
            execute: parentTool.execute,
          });
        }
        // If tool not found in parent, it's not added (sub-agent won't have access)
      }

      // Create a runner for the sub-agent via factory
      const subRunner = subAgentFactory.create(config, {
        llmProvider,
        toolRegistry: parentToolRegistry,
        model,
      });
      // Register resolved tool implementations onto the sub-agent's registry
      for (const tool of subAgentTools) {
        subRunner.registerTool(tool);
      }

      // Check abort signal before running
      if (options?.signal?.aborted) {
        return {
          answer: 'Aborted',
          totalSteps: 0,
          finalState: null,
        } satisfies DelegateResult;
      }

      // Run until completion with signal support
      const { state: finalState, result } = await subRunner.run(stateWithTask, {
        signal: options?.signal,
      });

      if (result.type === 'abort') {
        return {
          answer: 'Aborted',
          totalSteps: result.totalSteps,
          finalState,
        } satisfies DelegateResult;
      }

      if (result.type === 'success') {
        return {
          answer: result.answer,
          totalSteps: result.totalSteps,
          finalState,
        } satisfies DelegateResult;
      }
      if (result.type === 'error') {
        return {
          answer: `Error: ${result.error.message}`,
          totalSteps: result.totalSteps,
          finalState,
        } satisfies DelegateResult;
      }
      return {
        answer: 'Max steps reached',
        totalSteps: result.totalSteps,
        finalState,
      } satisfies DelegateResult;
    },
  };
}
