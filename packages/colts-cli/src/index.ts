#!/usr/bin/env node
/**
 * @fileoverview colts CLI entry — load config, create AgentRunner, render TUI
 *
 * Runner creation logic is delegated to runner-setup.ts.
 * index.ts is only responsible for: load config → create runner → render App.
 */

import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { loadConfig } from './config.js';
import { createRunnerFromConfig, createInitialStateFromConfig } from './runner-setup.js';
import type { InteractionCallbacks } from './runner-setup.js';

async function main() {
  const config = await loadConfig();

  const callbacks: InteractionCallbacks = { askHuman: null, confirm: null };
  const runner = createRunnerFromConfig(config, callbacks);
  const initialState = createInitialStateFromConfig(config);

  render(React.createElement(App, { config, runner, initialState, callbacks }));
}

main().catch((err) => {
  console.error('Failed to start colts:', err);
  process.exit(1);
});
