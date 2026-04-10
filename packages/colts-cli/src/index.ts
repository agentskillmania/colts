#!/usr/bin/env node
/**
 * @fileoverview colts-cli 入口 — 启动 ink 终端应用
 */

import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { loadConfig } from './config.js';

async function main() {
  const config = await loadConfig();

  render(React.createElement(App, { config }));
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
