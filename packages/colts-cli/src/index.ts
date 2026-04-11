#!/usr/bin/env node
/**
 * @fileoverview colts CLI 入口
 *
 * 加载配置，创建 AgentRunner 和初始 AgentState，渲染 TUI。
 */

import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { loadConfig } from './config.js';
import { AgentRunner, createAgentState } from '@agentskillmania/colts';
import type { RunnerOptions, AgentState } from '@agentskillmania/colts';

async function main() {
  const config = await loadConfig();

  let runner: AgentRunner | null = null;
  let initialState: AgentState | null = null;

  if (config.hasValidConfig && config.llm) {
    const runnerOptions: RunnerOptions = {
      model: config.llm.model,
      llm: {
        apiKey: config.llm.apiKey,
        provider: config.llm.provider,
        baseUrl: config.llm.baseUrl,
      },
      systemPrompt: config.agent?.instructions,
    };
    runner = new AgentRunner(runnerOptions);

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
