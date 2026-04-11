/**
 * @fileoverview App 组件单元测试
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from '../../src/app.js';
import type { AppConfig } from '../../src/config.js';
import { AgentRunner } from '@agentskillmania/colts';

// Mock AgentRunner，避免真正创建 LLM 连接
vi.mock('@agentskillmania/colts', () => ({
  AgentRunner: vi.fn().mockImplementation(() => ({
    chatStream: vi.fn(),
    stepStream: vi.fn(),
    advanceStream: vi.fn(),
  })),
}));

describe('App', () => {
  describe('无有效配置', () => {
    const noConfig: AppConfig = { hasValidConfig: false, configPath: '/tmp/test.yaml' };

    it('显示配置缺失提示', () => {
      const { lastFrame } = render(<App config={noConfig} runner={null} />);
      expect(lastFrame()).toContain('AI Key Configuration Required');
    });

    it('显示配置文件路径', () => {
      const { lastFrame } = render(<App config={noConfig} runner={null} />);
      expect(lastFrame()).toContain('/tmp/test.yaml');
    });

    it('显示退出提示', () => {
      const { lastFrame } = render(<App config={noConfig} runner={null} />);
      expect(lastFrame()).toContain('Ctrl+C');
    });
  });

  describe('有效配置', () => {
    const validConfig: AppConfig = {
      hasValidConfig: true,
      configPath: '/tmp/test.yaml',
      llm: { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o' },
      agent: { name: 'test-agent', instructions: 'Test' },
    };

    it('显示主界面', () => {
      const runner = new AgentRunner({ model: 'gpt-4o', llm: { apiKey: 'sk-test' } });
      const { lastFrame } = render(<App config={validConfig} runner={runner} />);
      const frame = lastFrame();
      expect(frame).toContain('colts-cli v0.1.0');
      expect(frame).toContain('gpt-4o');
    });

    it('显示 Ready 状态', () => {
      const runner = new AgentRunner({ model: 'gpt-4o', llm: { apiKey: 'sk-test' } });
      const { lastFrame } = render(<App config={validConfig} runner={runner} />);
      expect(lastFrame()).toContain('Ready');
    });

    it('显示输入框', () => {
      const runner = new AgentRunner({ model: 'gpt-4o', llm: { apiKey: 'sk-test' } });
      const { lastFrame } = render(<App config={validConfig} runner={runner} />);
      expect(lastFrame()).toContain('RUN');
    });

    it('卸载不报错', () => {
      const runner = new AgentRunner({ model: 'gpt-4o', llm: { apiKey: 'sk-test' } });
      const { unmount } = render(<App config={validConfig} runner={runner} />);
      expect(() => unmount()).not.toThrow();
    });
  });
});
