/**
 * @fileoverview Runner 创建工厂 + 交互回调可变引用
 *
 * 从 index.ts 和 app.tsx 共享的 runner 创建逻辑。
 * interactionCallbacks 放在此处避免 index.ts ↔ app.tsx 循环依赖。
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
 * 交互回调的可变引用
 *
 * runner-setup.ts 创建 runner 时注入延迟 handler，
 * app.tsx 挂载后通过 useEffect 填入真正的实现（闭包持有 setInteraction）。
 */
export const interactionCallbacks = {
  askHuman: null as AskHumanHandler | null,
  confirm: null as ConfirmHandler | null,
};

/**
 * 从配置创建 AgentRunner（含 ConfirmableRegistry 包装和 ask_human 注册）
 *
 * @param config - 已验证的应用配置
 * @returns AgentRunner 实例，配置无效时返回 null
 */
export function createRunnerFromConfig(config: AppConfig): AgentRunner | null {
  if (!config.hasValidConfig || !config.llm) return null;

  // 创建内部 registry
  const innerRegistry = new ToolRegistry();

  // 用 ConfirmableRegistry 包装，confirm handler 通过延迟绑定
  const confirmTools = config.confirmTools ?? [];
  const registry = new ConfirmableRegistry(innerRegistry, {
    confirmTools,
    confirm: async (toolName, args) => {
      if (!interactionCallbacks.confirm) return true;
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
  };

  const runner = new AgentRunner(runnerOptions);

  // 注册 ask_human 工具，handler 通过延迟绑定
  const askHumanTool = createAskHumanTool(async (params) => {
    if (!interactionCallbacks.askHuman) {
      // fallback：没有 handler 时返回空回答
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
 * 从配置创建初始 AgentState
 *
 * @param config - 已验证的应用配置
 * @returns AgentState 实例，配置无效时返回 null
 */
export function createInitialStateFromConfig(config: AppConfig): AgentState | null {
  if (!config.hasValidConfig || !config.llm) return null;

  return createAgentState({
    name: config.agent?.name ?? 'colts-agent',
    instructions: config.agent?.instructions ?? 'You are a helpful assistant.',
    tools: [],
  });
}
