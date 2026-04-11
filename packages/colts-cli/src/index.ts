#!/usr/bin/env node
/**
 * @fileoverview colts CLI 入口
 *
 * 加载配置，创建 AgentRunner，渲染 TUI。
 */

import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { loadConfig } from './config.js';
import { AgentRunner } from '@agentskillmania/colts';
import type { RunnerOptions } from '@agentskillmania/colts';

async function main() {
  const config = await loadConfig();

  let runner: AgentRunner | null = null;
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
  }

  render(React.createElement(App, { config, runner }));
}

main().catch((err) => {
  console.error('Failed to start colts:', err);
  process.exit(1);
});
