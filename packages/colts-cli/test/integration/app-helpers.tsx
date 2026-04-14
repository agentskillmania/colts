/**
 * @fileoverview UI integration test helpers for colts-cli
 */

import React from 'react';
import { render, type RenderResult } from 'ink-testing-library';
import { Text } from 'ink';
import { vi } from 'vitest';
import { AgentRunner, createAgentState } from '@agentskillmania/colts';
import type { AgentState, RunnerOptions } from '@agentskillmania/colts';
import { App } from '../../src/app.js';
import type { AppConfig } from '../../src/config.js';
import { createRealLLMClient } from './helpers.js';
import { testConfig } from './config.js';

/** Captured onSubmit handler from mocked TextInput */
export let capturedOnSubmit: ((value: string) => void) | null = null;

/** Mock @inkjs/ui TextInput so tests can capture the onSubmit handler */
vi.mock('@inkjs/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@inkjs/ui')>();
  return {
    ...actual,
    TextInput: ({
      onSubmit,
      placeholder,
    }: {
      onSubmit: (v: string) => void;
      placeholder?: string;
    }) => {
      capturedOnSubmit = onSubmit;
      return React.createElement(Text, null, placeholder ?? '');
    },
  };
});

/** Create a real AgentRunner for integration tests */
export function createRealRunner(options?: Partial<RunnerOptions>): AgentRunner {
  const client = createRealLLMClient();
  return new AgentRunner({
    model: testConfig.testModel,
    llmClient: client,
    requestTimeout: 60000,
    ...options,
  } as RunnerOptions);
}

/** Build a minimal valid AppConfig for tests */
export function buildTestConfig(overrides?: Partial<AppConfig>): AppConfig {
  return {
    hasValidConfig: true,
    configPath: '/tmp/test-config.yaml',
    llm: {
      provider: testConfig.provider,
      apiKey: testConfig.apiKey,
      model: testConfig.testModel,
      baseUrl: testConfig.baseUrl,
    },
    agent: {
      name: 'test-agent',
      instructions: 'You are a helpful assistant. Answer concisely.',
    },
    maxSteps: 20,
    requestTimeout: 60000,
    ...overrides,
  } as AppConfig;
}

/** Render App with a real runner and optional initial state / session dir */
export function renderApp(
  options: {
    runner?: AgentRunner;
    initialState?: AgentState;
    sessionBaseDir?: string;
  } = {}
): { runner: AgentRunner } & RenderResult {
  capturedOnSubmit = null;
  const runner = options.runner ?? createRealRunner();
  const initialState =
    options.initialState ??
    createAgentState({
      name: 'test-agent',
      instructions: 'You are a helpful assistant. Answer concisely.',
      tools: [],
    });
  const config = buildTestConfig();
  return {
    runner,
    ...render(
      <App
        config={config}
        runner={runner}
        initialState={initialState}
        sessionBaseDir={options.sessionBaseDir}
      />
    ),
  };
}

/** Wait until the agent stops running (no more thinking spinner) */
export async function waitForIdle(
  lastFrame: () => string | undefined,
  timeout = 90000,
  interval = 500
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const frame = lastFrame() || '';
    if (!frame.includes('Agent is thinking') && !frame.includes('Running')) {
      await new Promise((r) => setTimeout(r, interval));
      return lastFrame() || '';
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Timeout waiting for idle. Last frame:\n${lastFrame() || '(empty)'}`);
}

/** Wait until the agent pauses in step/advance mode, or becomes idle */
export async function waitForPauseOrIdle(
  lastFrame: () => string | undefined,
  timeout = 15000,
  interval = 500
): Promise<{ type: 'pause'; frame: string } | { type: 'idle'; frame: string }> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const frame = lastFrame() || '';
    if (frame.includes('Press Enter to continue')) {
      return { type: 'pause', frame };
    }
    if (!frame.includes('Agent is thinking') && !frame.includes('Running')) {
      await new Promise((r) => setTimeout(r, interval));
      return { type: 'idle', frame: lastFrame() || '' };
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(
    `Timeout waiting for pause or idle. Last frame:\n${lastFrame() || '(empty)'}`
  );
}

/** Submit a message through the captured TextInput onSubmit */
export async function submitMessage(text: string): Promise<void> {
  if (!capturedOnSubmit) {
    throw new Error('No TextInput onSubmit captured. Did you render App before submitting?');
  }
  capturedOnSubmit(text);
  // Yield to let React process the state update and start the async work
  await new Promise((r) => setTimeout(r, 50));
}
