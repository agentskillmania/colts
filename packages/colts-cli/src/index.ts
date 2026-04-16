#!/usr/bin/env node
/**
 * @fileoverview colts CLI 入口 — 加载配置、创建 AgentRunner、渲染 TUI
 *
 * runner 创建逻辑委托给 runner-setup.ts，
 * index.ts 只负责：加载配置 → 创建 runner → 渲染 App。
 */

import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { loadConfig } from './config.js';
import { createRunnerFromConfig, createInitialStateFromConfig } from './runner-setup.js';

async function main() {
  const config = await loadConfig();

  const runner = createRunnerFromConfig(config);
  const initialState = createInitialStateFromConfig(config);

  render(React.createElement(App, { config, runner, initialState }));
}

main().catch((err) => {
  console.error('Failed to start colts:', err);
  process.exit(1);
});
