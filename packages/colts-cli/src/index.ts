#!/usr/bin/env node
/**
 * @fileoverview colts-cli entry point — starts the ink terminal application
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
