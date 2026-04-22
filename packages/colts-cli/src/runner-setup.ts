/**
 * @fileoverview Runner creation factory + mutable interaction callback reference
 *
 * Shared runner creation logic from index.ts and app.tsx.
 * interactionCallbacks placed here to avoid circular dependency between index.ts ↔ app.tsx.
 */

import {
  AgentRunner,
  createAgentState,
  ToolRegistry,
  ConfirmableRegistry,
  createAskHumanTool,
} from '@agentskillmania/colts';
import type {
  RunnerOptions,
  AgentState,
  AskHumanHandler,
  ConfirmHandler,
} from '@agentskillmania/colts';
import type { AppConfig } from './config.js';

/**
 * Mutable reference for interaction callbacks
 *
 * runner-setup.ts injects lazy handler when creating runner,
 * app.tsx fills in the real implementation via useEffect after mount (closure holds setInteraction).
 */
export const interactionCallbacks = {
  askHuman: null as AskHumanHandler | null,
  confirm: null as ConfirmHandler | null,
};

/**
 * Create AgentRunner from config (includes ConfirmableRegistry wrapper and ask_human registration)
 *
 * @param config - Validated app config
 * @returns AgentRunner instance, or null if config is invalid
 */
export function createRunnerFromConfig(config: AppConfig): AgentRunner | null {
  if (!config.hasValidConfig || !config.llm) return null;

  // Create internal registry
  const innerRegistry = new ToolRegistry();

  // Wrap with ConfirmableRegistry; confirm handler bound lazily
  const confirmTools = config.confirmTools ?? [];
  const registry = new ConfirmableRegistry(innerRegistry, {
    confirmTools,
    confirm: async (toolName, args) => {
      if (!interactionCallbacks.confirm) return false;
      return interactionCallbacks.confirm(toolName, args);
    },
  });

  const runnerOptions: RunnerOptions = {
    model: config.llm.model,
    llm: {
      apiKey: config.llm.apiKey,
      provider: config.llm.provider,
      baseUrl: config.llm.baseUrl,
    },
    maxSteps: config.maxSteps,
    requestTimeout: config.requestTimeout,
    skillDirectories: config.skills,
    toolRegistry: registry,
    thinkingEnabled: config.llm.thinkingEnabled,
    enablePromptThinking: config.llm.enablePromptThinking,
  };

  const runner = new AgentRunner(runnerOptions);

  // Register ask_human tool; handler bound lazily
  const askHumanTool = createAskHumanTool(async (params) => {
    if (!interactionCallbacks.askHuman) {
      // Fallback: return empty response when no handler is available
      const fallback: Record<string, { type: 'free-text'; value: string }> = {};
      for (const q of params.questions) {
        fallback[q.id] = { type: 'free-text', value: '(no handler available)' };
      }
      return fallback;
    }
    return interactionCallbacks.askHuman(params);
  }) as unknown as Parameters<typeof runner.registerTool>[0];
  runner.registerTool(askHumanTool);

  return runner;
}

/**
 * Create initial AgentState from config
 *
 * @param config - Validated app config
 * @returns AgentState instance, or null if config is invalid
 */
export function createInitialStateFromConfig(config: AppConfig): AgentState | null {
  if (!config.hasValidConfig || !config.llm) return null;

  return createAgentState({
    name: config.agent?.name ?? 'colts-agent',
    instructions: config.agent?.instructions ?? 'You are a helpful assistant.',
    tools: [],
  });
}
