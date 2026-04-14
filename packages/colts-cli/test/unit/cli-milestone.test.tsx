/**
 * CLI milestone integration tests
 *
 * User Story: CLI Milestone
 * Verify: startup → render → exit complete flow.
 * (No real LLM calls, only verify component + hooks + session wiring is correct)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from '../../src/app.js';
import type { AppConfig } from '../../src/config.js';
import { AgentRunner, createAgentState } from '@agentskillmania/colts';
import { saveSession, listSessions, loadSession } from '../../src/session.js';

// Mock AgentRunner
vi.mock('@agentskillmania/colts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentskillmania/colts')>();
  return {
    ...actual,
    AgentRunner: vi.fn().mockImplementation(() => ({
      chatStream: vi.fn(),
      stepStream: vi.fn(),
      advanceStream: vi.fn(),
    })),
  };
});

describe('CLI milestone integration', () => {
  const testSessionDir = path.join(os.tmpdir(), `colts-cli-milestone-${Date.now()}`);

  beforeEach(async () => {
    await fs.mkdir(testSessionDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testSessionDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  /**
   * Scenario 1: First startup (no config) shows config prompt
   */
  it('should show config prompt on first startup with no config', () => {
    const noConfig: AppConfig = { hasValidConfig: false, configPath: '/tmp/test.yaml' };
    const { lastFrame } = render(<App config={noConfig} runner={null} />);
    const frame = lastFrame();
    expect(frame).toContain('AI Key Configuration Required');
    expect(frame).toContain('/tmp/test.yaml');
  });

  /**
   * Scenario 2: Valid config startup shows welcome screen
   */
  it('should show welcome screen with valid config', () => {
    const config: AppConfig = {
      hasValidConfig: true,
      configPath: '/tmp/test.yaml',
      llm: { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o' },
      agent: { name: 'test-agent', instructions: 'Test' },
    };
    const runner = new AgentRunner({ model: 'gpt-4o', llm: { apiKey: 'sk-test' } });
    const { lastFrame } = render(<App config={config} runner={runner} />);
    const frame = lastFrame();
    expect(frame).toContain('Welcome to colts-cli');
    expect(frame).toContain('test-agent');
    expect(frame).toContain('gpt-4o');
    expect(frame).toContain('RUN');
  });

  /**
   * Scenario 3: Startup with initial state
   */
  it('should render correctly with initial AgentState', () => {
    const config: AppConfig = {
      hasValidConfig: true,
      configPath: '/tmp/test.yaml',
      llm: { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o' },
      agent: { name: 'test-agent', instructions: 'Test' },
    };
    const runner = new AgentRunner({ model: 'gpt-4o', llm: { apiKey: 'sk-test' } });
    const initialState = createAgentState({
      name: 'test-agent',
      instructions: 'Test',
      tools: [],
    });
    const { lastFrame } = render(<App config={config} runner={runner} initialState={initialState} />);
    const frame = lastFrame();
    expect(frame).toContain('colts-cli');
    expect(frame).toContain('gpt-4o');
  });

  /**
   * Scenario 4: Session persistence verification — save + load
   */
  it('should load session after saving', async () => {
    const state = createAgentState({
      name: 'test-agent',
      instructions: 'Test',
      tools: [],
    });

    // Save
    await saveSession(state, testSessionDir);

    // Load
    const loaded = await loadSession(state.id, testSessionDir);
    expect(loaded.id).toBe(state.id);

    // List
    const sessions = await listSessions(testSessionDir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(state.id);
  });

  /**
   * Scenario 5: Multiple renders without errors (component stability)
   */
  it('should not throw on multiple renders', () => {
    const config: AppConfig = {
      hasValidConfig: true,
      configPath: '/tmp/test.yaml',
      llm: { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o' },
      agent: { name: 'test-agent', instructions: 'Test' },
    };
    const runner = new AgentRunner({ model: 'gpt-4o', llm: { apiKey: 'sk-test' } });

    // Render 3 times consecutively
    for (let i = 0; i < 3; i++) {
      const { unmount } = render(<App config={config} runner={runner} />);
      expect(() => unmount()).not.toThrow();
    }
  });
});
