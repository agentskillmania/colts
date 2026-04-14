/**
 * @fileoverview User Story: CLI Command Interaction
 *
 * As a CLI user
 * I want to switch modes, clear the screen, and view help via commands
 * So that I can control the application efficiently
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { App } from '../../src/app.js';
import type { AppConfig } from '../../src/config.js';
import { AgentRunner, createAgentState } from '@agentskillmania/colts';

/** Capture the TextInput onSubmit callback */
let capturedOnSubmit: ((value: string) => void) | null = null;

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

describe('User Story: CLI Command Interaction', () => {
  const validConfig: AppConfig = {
    hasValidConfig: true,
    configPath: '/tmp/test.yaml',
    llm: { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o' },
    agent: { name: 'test-agent', instructions: 'Test', tools: [] },
  };

  const mockRunner = new AgentRunner({ model: 'gpt-4o', llm: { apiKey: 'sk-test' } });

  beforeEach(() => {
    capturedOnSubmit = null;
  });

  it('should switch to RUN mode via /run command', async () => {
    const { lastFrame } = render(<App config={validConfig} runner={mockRunner} />);

    capturedOnSubmit!('/run');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(lastFrame()).toContain('Switched to RUN mode');
  });

  it('should switch to STEP mode via /step command', async () => {
    const { lastFrame } = render(<App config={validConfig} runner={mockRunner} />);

    capturedOnSubmit!('/step');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(lastFrame()).toContain('Switched to STEP mode');
  });

  it('should switch to ADVANCE mode via /advance command', async () => {
    const { lastFrame } = render(<App config={validConfig} runner={mockRunner} />);

    capturedOnSubmit!('/advance');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(lastFrame()).toContain('Switched to ADVANCE mode');
  });

  it('should clear Timeline via /clear command', async () => {
    const { lastFrame } = render(<App config={validConfig} runner={mockRunner} />);

    // Add a system entry first
    capturedOnSubmit!('/run');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(lastFrame()).toContain('Switched to RUN mode');

    // Clear
    capturedOnSubmit!('/clear');
    await new Promise((resolve) => setTimeout(resolve, 50));

    // After clear, welcome screen should be back (no entries)
    expect(lastFrame()).toContain('Welcome to colts-cli');
  });

  it('should show help via /help command', async () => {
    const { lastFrame } = render(<App config={validConfig} runner={mockRunner} />);

    capturedOnSubmit!('/help');
    await new Promise((resolve) => setTimeout(resolve, 50));

    const frame = lastFrame();
    expect(frame).toContain('/run');
    expect(frame).toContain('/step');
    expect(frame).toContain('/advance');
  });
});
