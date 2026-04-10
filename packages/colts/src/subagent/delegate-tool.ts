/**
 * @fileoverview Delegate Tool 工厂函数
 *
 * 创建 "delegate" 工具，允许主 agent 将任务委派给子 agent。
 * 子 agent 拥有独立的 instructions、tools 和 maxSteps 配置。
 */

import { z } from 'zod';
import type { Tool } from '../tools/registry.js';
import type { SubAgentConfig, DelegateResult } from './types.js';
import { createAgentState, addUserMessage } from '../state.js';
import { AgentRunner } from '../runner.js';
import type { ILLMProvider } from '../types.js';

/**
 * delegate tool 的依赖注入接口
 */
export interface DelegateToolDeps {
  /** 子 agent 配置映射（name → SubAgentConfig） */
  subAgentConfigs: Map<string, SubAgentConfig>;
  /** LLM Provider 实例 */
  llmProvider: ILLMProvider;
  /** 子 agent 默认最大步数（默认 10） */
  defaultMaxSteps?: number;
}

/**
 * 创建 delegate 工具
 *
 * 主 agent 通过此工具将特定任务委派给专业子 agent 执行。
 * 子 agent 拥有独立的 instructions、tools 和 maxSteps 配置。
 *
 * @param deps - 依赖注入参数
 * @returns Tool 实例，可注册到 ToolRegistry
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
 * });
 *
 * registry.register(delegateTool);
 * ```
 */
export function createDelegateTool(deps: DelegateToolDeps): Tool {
  const { subAgentConfigs, llmProvider, defaultMaxSteps = 10 } = deps;

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
    execute: async ({ agent, task, extraInstructions }) => {
      const config = subAgentConfigs.get(agent);
      if (!config) {
        const available = Array.from(subAgentConfigs.keys()).join(', ');
        return {
          answer: `Error: Unknown sub-agent '${agent}'. Available: ${available}`,
          totalSteps: 0,
          finalState: null,
        } satisfies DelegateResult;
      }

      // 构建子 agent 的 instructions，可选追加额外指令
      let instructions = config.config.instructions;
      if (extraInstructions) {
        instructions = instructions + '\n\n' + extraInstructions;
      }

      // 创建子 agent 状态
      const subConfig = { ...config.config, instructions };
      const subState = createAgentState(subConfig);
      const stateWithTask = addUserMessage(subState, task);

      // 为子 agent 创建 runner
      const subRunner = new AgentRunner({
        model: 'sub-agent',
        llmClient: llmProvider,
        maxSteps: config.maxSteps ?? defaultMaxSteps,
        tools: config.config.tools.map((toolDef) => ({
          name: toolDef.name,
          description: toolDef.description,
          parameters: z.object({}).passthrough(),
          execute: async () => 'Tool not implemented',
        })),
      });

      // 运行至完成
      const { state: finalState, result } = await subRunner.run(stateWithTask);

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
