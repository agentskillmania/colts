/**
 * @fileoverview App component unit tests
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from '../../src/app.js';
import type { AppConfig } from '../../src/config.js';
import { AgentRunner } from '@agentskillmania/colts';

// Mock AgentRunner to avoid creating real LLM connections
vi.mock('@agentskillmania/colts', () => ({
  AgentRunner: vi.fn().mockImplementation(() => ({
    chatStream: vi.fn(),
    stepStream: vi.fn(),
    advanceStream: vi.fn(),
  })),
  createAgentState: vi.fn().mockReturnValue({
    id: 'test-state-1',
    config: { name: 'test-agent', instructions: 'Test', tools: [] },
    context: { messages: [], stepCount: 0 },
  }),
}));

describe('App', () => {
  describe('No valid config', () => {
    const noConfig: AppConfig = { hasValidConfig: false, configPath: '/tmp/test.yaml' };

    it('should show config missing prompt', () => {
      const { lastFrame } = render(<App config={noConfig} runner={null} />);
      expect(lastFrame()).toContain('AI Key Configuration Required');
    });

    it('should show config file path', () => {
      const { lastFrame } = render(<App config={noConfig} runner={null} />);
      expect(lastFrame()).toContain('/tmp/test.yaml');
    });

    it('should show exit prompt', () => {
      const { lastFrame } = render(<App config={noConfig} runner={null} />);
      expect(lastFrame()).toContain('Ctrl+C');
    });
  });

  describe('Valid config', () => {
    const validConfig: AppConfig = {
      hasValidConfig: true,
      configPath: '/tmp/test.yaml',
      llm: { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o' },
      agent: { name: 'test-agent', instructions: 'Test' },
    };

    it('should show welcome screen (when no messages)', () => {
      const runner = new AgentRunner({ model: 'gpt-4o', llm: { apiKey: 'sk-test' } });
      const { lastFrame } = render(<App config={validConfig} runner={runner} />);
      const frame = lastFrame();
      expect(frame).toContain('Welcome to colts-cli');
    });

    it('should show model name', () => {
      const runner = new AgentRunner({ model: 'gpt-4o', llm: { apiKey: 'sk-test' } });
      const { lastFrame } = render(<App config={validConfig} runner={runner} />);
      expect(lastFrame()).toContain('gpt-4o');
    });

    it('should show agent name', () => {
      const runner = new AgentRunner({ model: 'gpt-4o', llm: { apiKey: 'sk-test' } });
      const { lastFrame } = render(<App config={validConfig} runner={runner} />);
      expect(lastFrame()).toContain('test-agent');
    });

    it('should show input bar', () => {
      const runner = new AgentRunner({ model: 'gpt-4o', llm: { apiKey: 'sk-test' } });
      const { lastFrame } = render(<App config={validConfig} runner={runner} />);
      expect(lastFrame()).toContain('RUN');
    });

    it('should not throw on unmount', () => {
      const runner = new AgentRunner({ model: 'gpt-4o', llm: { apiKey: 'sk-test' } });
      const { unmount } = render(<App config={validConfig} runner={runner} />);
      expect(() => unmount()).not.toThrow();
    });
  });
});
