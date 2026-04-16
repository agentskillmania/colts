#!/usr/bin/env node
/**
 * @fileoverview colts CLI 入口 — 加载配置、创建 AgentRunner、渲染 TUI
 *
 * 使用延迟绑定模式注入 ask_human handler 和 confirm handler：
 * - ConfirmableRegistry 在 runner 构造时注入，handler 初始为空
 * - app.tsx 挂载后通过 interactionCallbacks 填入真正的 handler
 */

import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { loadConfig } from './config.js';
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

/**
 * 交互回调的可变引用
 *
 * index.ts 中创建 runner 时注入延迟 handler，
 * app.tsx 挂载后填入真正的实现（闭包持有 setInteraction）。
 */
export const interactionCallbacks = {
  askHuman: null as AskHumanHandler | null,
  confirm: null as ConfirmHandler | null,
};

async function main() {
  const config = await loadConfig();

  let runner: AgentRunner | null = null;
  let initialState: AgentState | null = null;

  if (config.hasValidConfig && config.llm) {
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
    runner = new AgentRunner(runnerOptions);

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

    // 创建初始 AgentState
    initialState = createAgentState({
      name: config.agent?.name ?? 'colts-agent',
      instructions: config.agent?.instructions ?? 'You are a helpful assistant.',
      tools: [],
    });
  }

  render(React.createElement(App, { config, runner, initialState }));
}

main().catch((err) => {
  console.error('Failed to start colts:', err);
  process.exit(1);
});
