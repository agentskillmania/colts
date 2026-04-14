/**
 * @fileoverview User Story: App Startup Session Restore
 *
 * As a CLI user
 * I want the app to automatically restore my last conversation on startup
 * So that I can continue from where I left off
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { App } from '../../src/app.js';
import type { AppConfig } from '../../src/config.js';
import {
  AgentRunner,
  createAgentState,
  addUserMessage,
  addAssistantMessage,
} from '@agentskillmania/colts';
import { saveSession } from '../../src/session.js';

describe('User Story: App Startup Session Restore', () => {
  const sessionDir = path.join(os.tmpdir(), `colts-cli-restore-${Date.now()}`);

  const validConfig: AppConfig = {
    hasValidConfig: true,
    configPath: '/tmp/test.yaml',
    llm: { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o' },
    agent: { name: 'test-agent', instructions: 'Test', tools: [] },
  };

  beforeEach(async () => {
    await fs.mkdir(sessionDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(sessionDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('should restore the most recent session and show history in Timeline', async () => {
    // Given: A saved session with conversation history
    let state = createAgentState({
      name: 'test-agent',
      instructions: 'Test',
      tools: [],
    });
    state = addUserMessage(state, 'Hello from previous session');
    state = addAssistantMessage(state, 'Hi there!', { type: 'final', visible: true });

    await saveSession(state, sessionDir);

    // When: Render App without initialState (should trigger restoreLatest)
    const runner = new AgentRunner({ model: 'gpt-4o', llm: { apiKey: 'sk-test' } });
    const { lastFrame } = render(
      <App config={validConfig} runner={runner} sessionBaseDir={sessionDir} />
    );

    // Then: Wait for async restore
    await new Promise((resolve) => setTimeout(resolve, 200));

    const frame = lastFrame();
    // Should show previous messages instead of welcome screen
    expect(frame).toContain('Hello from previous session');
    expect(frame).toContain('Hi there!');
    // Should not show welcome screen
    expect(frame).not.toContain('Welcome to colts-cli');
  });

  it('should show welcome screen when no sessions exist', async () => {
    const emptyDir = path.join(sessionDir, 'empty');
    await fs.mkdir(emptyDir, { recursive: true });

    const runner = new AgentRunner({ model: 'gpt-4o', llm: { apiKey: 'sk-test' } });
    const { lastFrame } = render(
      <App config={validConfig} runner={runner} sessionBaseDir={emptyDir} />
    );

    await new Promise((resolve) => setTimeout(resolve, 200));

    const frame = lastFrame();
    expect(frame).toContain('Welcome to colts-cli');
  });
});
