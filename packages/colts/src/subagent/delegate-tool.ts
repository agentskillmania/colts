/**
 * @fileoverview Delegate Tool factory function
 *
 * Creates the 'delegate' tool that allows the parent agent to delegate tasks to sub-agents.
 * Sub-agents have independent instructions, tools, and maxSteps configuration.
 */

import { z } from 'zod';

import type { SubAgentConfig, DelegateResult, ISubAgentFactory } from './types.js';
import { DefaultSubAgentFactory, DEFAULT_SUBAGENT_MAX_STEPS } from './types.js';
import { createAgentState, addUserMessage } from '../state/index.js';
import type { Tool } from '../tools/registry.js';
import type { ILLMProvider, IToolRegistry, ISkillProvider } from '../types.js';

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
  /**
   * Parent runner's skill provider. Forwarded to the sub-agent factory so
   * sub-agents that opt into `inheritParentSkills` get `load_skill` wired up.
   */
  parentSkillProvider?: ISkillProvider;
  /** Sub-agent factory (defaults to DefaultSubAgentFactory) */
  subAgentFactory?: ISubAgentFactory;
  /**
   * Event emitter callback — forwards sub-agent events to the parent runner's EventEmitter.
   * Called with (type, data) for each event the sub-agent produces.
   */
  emit: (type: string, data: Record<string, unknown>) => void;
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
    defaultMaxSteps = DEFAULT_SUBAGENT_MAX_STEPS,
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
          status: 'error',
          error: `Unknown sub-agent '${agent}'. Available: ${available}`,
          totalSteps: 0,
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

      // Create a runner for the sub-agent via factory.
      // The factory handles `inheritParentTools`/`inheritParentSkills`
      // (both default true) — when inheriting, the factory already wires the
      // parent's tool set and skill provider into the sub-runner's registry.
      const subRunner = subAgentFactory.create(config, {
        llmProvider,
        toolRegistry: parentToolRegistry,
        model,
        skillProvider: deps.parentSkillProvider,
      });

      // Register tools explicitly listed in config.config.tools, but ONLY when
      // the sub-agent did NOT inherit the parent's full tool set. When
      // inheritParentTools is true, the factory already registered every tool,
      // so re-registering the named subset would be redundant (and would
      // double-register anything also in the inherited set).
      const inheritTools = config.inheritParentTools !== false;
      if (!inheritTools) {
        const canDelegate = config.allowDelegation ?? false;
        for (const toolDef of config.config.tools) {
          // Skip delegate tool if sub-agent is not allowed to delegate
          if (toolDef.name === 'delegate' && !canDelegate) {
            continue;
          }

          // Look up tool implementation from parent registry
          const parentTool = parentToolRegistry.get(toolDef.name);
          if (parentTool) {
            subRunner.registerTool({
              name: parentTool.name,
              description: parentTool.description,
              parameters: parentTool.parameters,
              execute: parentTool.execute,
            });
          }
        }
      }

      // Wire sub-agent event forwarding: each event is re-emitted to the parent
      // runner's EventEmitter with a 'subagent:' prefix and subtaskId for routing.
      const subtaskId = `${agent}-${Date.now()}`;
      const forwardEvents = ['token', 'thinking', 'tool:start', 'tool:end', 'tools:start', 'tools:end'];
      for (const evtType of forwardEvents) {
        subRunner.on(evtType as 'token', (...args: unknown[]) => {
          const data = (args[0] ?? {}) as Record<string, unknown>;
          deps.emit(`subagent:${evtType}`, { ...data, subtaskId, subagentName: agent });
        });
      }

      // Emit subagent:start before running
      deps.emit('subagent:start', { name: agent, task, subtaskId, timestamp: Date.now() });

      // Check abort signal before running
      if (options?.signal?.aborted) {
        return {
          status: 'abort',
          totalSteps: 0,
        } satisfies DelegateResult;
      }

      // Set up timeout if configured — combines with caller's signal
      const timeoutMs = config.timeout;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutController = new AbortController();
      const combinedSignal = options?.signal
        ? AbortSignal.any([options.signal, timeoutController.signal])
        : timeoutController.signal;

      if (timeoutMs) {
        timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
      }

      // Run until completion with signal + timeout support
      let result;
      try {
        ({ result } = await subRunner.run(stateWithTask, {
          signal: combinedSignal,
        }));
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      // Check if timeout caused the abort
      if (result.type === 'abort' && timeoutMs && timeoutController.signal.aborted) {
        deps.emit('subagent:end', {
          name: agent,
          result: { status: 'timeout', partialResult: '', totalSteps: result.totalSteps },
          subtaskId,
          timestamp: Date.now(),
        });
        return {
          status: 'timeout',
          partialResult: '',
          totalSteps: result.totalSteps,
        } satisfies DelegateResult;
      }

      // Build the structured result
      let delegateResult: DelegateResult;
      if (result.type === 'abort') {
        delegateResult = { status: 'abort', totalSteps: result.totalSteps };
      } else if (result.type === 'success') {
        delegateResult = { status: 'success', answer: result.answer, totalSteps: result.totalSteps };
      } else if (result.type === 'error') {
        delegateResult = { status: 'error', error: result.error.message, totalSteps: result.totalSteps };
      } else {
        delegateResult = { status: 'max_steps', lastAnswer: result.type === 'stopped' ? (result.data ?? '') : '', totalSteps: result.totalSteps };
      }

      // Emit subagent:end with the result
      deps.emit('subagent:end', { name: agent, result: delegateResult, subtaskId, timestamp: Date.now() });

      return delegateResult;
    },
  };
}
