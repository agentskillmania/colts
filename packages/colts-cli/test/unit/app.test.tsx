/**
 * @fileoverview App component unit tests
 *
 * Tests App routing logic (ConfigPrompt vs MainTUI), command interception, interaction behavior.
 * Mock strategy: only mock stream method on runner to return empty generator;
 * all other code (App, useAgent, StreamEventConsumer) uses real paths.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from '../../src/app.js';
import type { AppConfig } from '../../src/config.js';
import type { AgentRunner, AgentState } from '@agentskillmania/colts';
import { createAgentState } from '@agentskillmania/colts';

// ── mock runner-setup（createRunnerFromConfig / createInitialStateFromConfig）──
// vi.mock factory is hoisted, cannot reference external variables, so factory is self-contained

vi.mock('../../src/runner-setup.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/runner-setup.js')>();
  const { createAgentState: createState } = await import('@agentskillmania/colts');
  const { vi: viModule } = await import('vitest');

  // Empty async generator
  async function* emptyStream() {
    return;
  }

  const mockRunner = {
    runStream: viModule.fn().mockReturnValue(emptyStream()),
    stepStream: viModule.fn().mockReturnValue(emptyStream()),
    advanceStream: viModule.fn().mockReturnValue(emptyStream()),
    chatStream: viModule.fn().mockReturnValue(emptyStream()),
    skillProvider: undefined,
    registerTool: viModule.fn(),
  };

  return {
    ...actual,
    interactionCallbacks: { askHuman: null, confirm: null },
    createRunnerFromConfig: viModule.fn().mockReturnValue(mockRunner),
    createInitialStateFromConfig: viModule
      .fn()
      .mockReturnValue(createState({ name: 'test-agent', instructions: 'Test', tools: [] })),
  };
});

// ── mock setup ──

// Mock @inkjs/ui TextInput, capture onSubmit
let capturedOnSubmit: ((value: string) => void) | null = null;
let capturedSelectOnChange: ((value: string) => void) | null = null;

vi.mock('@inkjs/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@inkjs/ui')>();
  return {
    ...actual,
    TextInput: ({ onSubmit }: { onSubmit: (v: string) => void }) => {
      capturedOnSubmit = onSubmit;
      return React.createElement('text-input-mock');
    },
    Select: ({ onChange }: { onChange: (v: string) => void }) => {
      capturedSelectOnChange = onChange;
      return React.createElement('select-mock');
    },
  };
});

// Mock @inkjs/ui Select also needs mock
vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
  };
});

// ── Helpers ──

/** Create empty async generator to simulate runStream/stepStream/advanceStream */
async function* emptyStream() {
  // Do not yield any events, return result directly
  return;
}

/** Create a mock runner whose stream method returns empty generator */
function createMockRunner(overrides?: Partial<AgentRunner>): AgentRunner {
  return {
    runStream: vi.fn().mockReturnValue(emptyStream()),
    stepStream: vi.fn().mockReturnValue(emptyStream()),
    advanceStream: vi.fn().mockReturnValue(emptyStream()),
    chatStream: vi.fn().mockReturnValue(emptyStream()),
    skillProvider: undefined,
    ...overrides,
  } as unknown as AgentRunner;
}

const validConfig: AppConfig = {
  hasValidConfig: true,
  configPath: '/tmp/test.yaml',
  llm: { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o' },
  agent: { name: 'test-agent', instructions: 'Test' },
};

const invalidConfig: AppConfig = {
  hasValidConfig: false,
  configPath: '/tmp/test.yaml',
};

// ── Test cases ──

describe('App', () => {
  beforeEach(() => {
    capturedOnSubmit = null;
    capturedSelectOnChange = null;
  });

  // ── Routing logic ──

  describe('No valid config', () => {
    it('shows SetupWizard instead of MainTUI', () => {
      const { lastFrame } = render(<App config={invalidConfig} runner={null} />);
      const frame = lastFrame();
      expect(frame).toContain('colts-cli Setup');
      expect(frame).toContain('Step 1/3');
      expect(frame).not.toContain('RUN');
    });

    it('shows provider selection prompt', () => {
      const { lastFrame } = render(<App config={invalidConfig} runner={null} />);
      expect(lastFrame()).toContain('Select your LLM provider');
    });
  });

  describe('Valid config + runner', () => {
    it('shows WelcomeScreen when no messages', () => {
      const runner = createMockRunner();
      const { lastFrame } = render(
        <App config={validConfig} runner={runner} sessionBaseDir="/tmp/colts-test-sessions" />
      );
      expect(lastFrame()).toContain('Welcome to colts-cli');
    });

    it('shows model name', () => {
      const runner = createMockRunner();
      const { lastFrame } = render(
        <App config={validConfig} runner={runner} sessionBaseDir="/tmp/colts-test-sessions" />
      );
      expect(lastFrame()).toContain('gpt-4o');
    });

    it('shows agent name', () => {
      const runner = createMockRunner();
      const { lastFrame } = render(
        <App config={validConfig} runner={runner} sessionBaseDir="/tmp/colts-test-sessions" />
      );
      expect(lastFrame()).toContain('test-agent');
    });

    it('shows input area (RUN mode)', () => {
      const runner = createMockRunner();
      const { lastFrame } = render(
        <App config={validConfig} runner={runner} sessionBaseDir="/tmp/colts-test-sessions" />
      );
      expect(lastFrame()).toContain('RUN');
    });

    it('unmount does not throw', () => {
      const runner = createMockRunner();
      const { unmount } = render(
        <App config={validConfig} runner={runner} sessionBaseDir="/tmp/colts-test-sessions" />
      );
      expect(() => unmount()).not.toThrow();
    });
  });

  // ── Command interception ──

  describe('handleSubmit command interception', () => {
    it('/step switches to STEP mode', async () => {
      const runner = createMockRunner();
      const { lastFrame } = render(
        <App config={validConfig} runner={runner} sessionBaseDir="/tmp/colts-test-sessions" />
      );

      expect(capturedOnSubmit).not.toBeNull();
      capturedOnSubmit!('/step');

      // handleSubmit is async (internally awaits import), need to wait for render
      await vi.waitFor(() => {
        expect(lastFrame()).toContain('STEP');
      });
    });

    it('/advance switches to ADVANCE mode', async () => {
      const runner = createMockRunner();
      const { lastFrame } = render(
        <App config={validConfig} runner={runner} sessionBaseDir="/tmp/colts-test-sessions" />
      );

      capturedOnSubmit!('/advance');
      await vi.waitFor(() => {
        expect(lastFrame()).toContain('ADV');
      });
    });

    it('/run switches back to RUN mode', async () => {
      const runner = createMockRunner();
      const { lastFrame } = render(
        <App config={validConfig} runner={runner} sessionBaseDir="/tmp/colts-test-sessions" />
      );

      capturedOnSubmit!('/step');
      await vi.waitFor(() => {
        expect(lastFrame()).toContain('STEP');
      });

      capturedOnSubmit!('/run');
      await vi.waitFor(() => {
        expect(lastFrame()).toContain('RUN');
      });
    });

    it('/clear does not throw', () => {
      const runner = createMockRunner();
      render(
        <App config={validConfig} runner={runner} sessionBaseDir="/tmp/colts-test-sessions" />
      );

      expect(() => capturedOnSubmit!('/clear')).not.toThrow();
    });

    it('normal message triggers sendMessage (calls runStream)', async () => {
      const runner = createMockRunner();
      render(
        <App config={validConfig} runner={runner} sessionBaseDir="/tmp/colts-test-sessions" />
      );

      capturedOnSubmit!('hello');

      // Wait for async operation to complete
      await vi.waitFor(() => {
        expect(runner.runStream).toHaveBeenCalled();
      });
    });

    it('empty message does not trigger sendMessage', async () => {
      const runner = createMockRunner();
      render(
        <App config={validConfig} runner={runner} sessionBaseDir="/tmp/colts-test-sessions" />
      );

      capturedOnSubmit!('   ');

      // Give some time to ensure it does not trigger
      await new Promise((r) => setTimeout(r, 50));
      expect(runner.runStream).not.toHaveBeenCalled();
    });

    it('/help is intercepted as command by useAgent, does not trigger runStream', async () => {
      const runner = createMockRunner();
      render(
        <App config={validConfig} runner={runner} sessionBaseDir="/tmp/colts-test-sessions" />
      );

      capturedOnSubmit!('/help');

      // /help is intercepted as command in useAgent.sendMessage, does not go through runStream
      await vi.waitFor(() => {
        expect(runner.runStream).not.toHaveBeenCalled();
      });
    });
  });

  // ── Edge cases ──

  describe('Edge cases', () => {
    it('does not crash when runner is null but config is valid', () => {
      // This combination should not occur, but test defensively
      const { lastFrame } = render(
        <App config={validConfig} runner={null} sessionBaseDir="/tmp/colts-test-sessions" />
      );
      // Config valid but runner null → goes to SetupWizard branch
      expect(lastFrame()).toContain('colts-cli Setup');
    });

    it('multiple mode switches do not crash', () => {
      const runner = createMockRunner();
      const { lastFrame } = render(
        <App config={validConfig} runner={runner} sessionBaseDir="/tmp/colts-test-sessions" />
      );

      for (let i = 0; i < 5; i++) {
        capturedOnSubmit!('/step');
        capturedOnSubmit!('/advance');
        capturedOnSubmit!('/run');
      }

      expect(lastFrame()).toContain('RUN');
    });
  });

  // ── SetupWizard auto-switches to MainTUI ──

  describe('SetupWizard auto-switches to MainTUI', () => {
    it('switches to MainTUI showing WelcomeScreen after SetupWizard completes', async () => {
      const { lastFrame } = render(<App config={invalidConfig} runner={null} />);

      // Initially shows SetupWizard
      expect(lastFrame()).toContain('colts-cli Setup');

      // Step 1: select provider
      await vi.waitFor(() => {
        expect(capturedSelectOnChange).not.toBeNull();
      });
      capturedSelectOnChange!('openai');

      // Wait for step 2, TextInput appears
      await vi.waitFor(() => {
        expect(capturedOnSubmit).not.toBeNull();
      });

      // Step 2: enter API key
      capturedOnSubmit!('sk-test-key');

      // Wait for step 3, new TextInput appears
      await vi.waitFor(() => {
        expect(lastFrame()).toContain('Step 3/3');
        expect(capturedOnSubmit).not.toBeNull();
      });

      // Step 3: enter model (triggers onComplete → handleSetupComplete → switch to MainTUI)
      capturedOnSubmit!('gpt-4o');

      // Wait for state switch to complete, should show MainTUI WelcomeScreen
      await vi.waitFor(
        () => {
          expect(lastFrame()).toContain('Welcome to colts-cli');
        },
        { timeout: 5000 }
      );

      // Should no longer contain SetupWizard
      expect(lastFrame()).not.toContain('colts-cli Setup');
    });
  });
});
