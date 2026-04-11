/**
 * app.tsx 单元测试
 *
 * 测试 App 组件的渲染行为，包括设置向导和就绪状态。
 * 使用 ink-testing-library 进行组件渲染验证。
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from '../../src/app.js';

describe('App 组件', () => {
  describe('无有效配置（设置向导）', () => {
    it('显示配置缺失提示', () => {
      const { lastFrame } = render(
        <App config={{ hasValidConfig: false }} />
      );
      const frame = lastFrame();
      expect(frame).toContain('No configuration found');
    });

    it('显示配置指引信息', () => {
      const { lastFrame } = render(
        <App config={{ hasValidConfig: false }} />
      );
      const frame = lastFrame();
      expect(frame).toContain('/config llm.provider');
      expect(frame).toContain('/config llm.apiKey');
      expect(frame).toContain('/config llm.model');
    });

    it('显示退出提示', () => {
      const { lastFrame } = render(
        <App config={{ hasValidConfig: false }} />
      );
      const frame = lastFrame();
      expect(frame).toContain('Ctrl+C');
    });
  });

  describe('有效配置（就绪状态）', () => {
    it('显示版本信息', () => {
      const { lastFrame } = render(
        <App config={{
          hasValidConfig: true,
          llm: { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4' },
        }} />
      );
      const frame = lastFrame();
      expect(frame).toContain('colts-cli v0.1.0');
    });

    it('显示就绪提示', () => {
      const { lastFrame } = render(
        <App config={{
          hasValidConfig: true,
          llm: { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4' },
        }} />
      );
      const frame = lastFrame();
      expect(frame).toContain('Ready');
    });

    it('显示输入提示符', () => {
      const { lastFrame } = render(
        <App config={{
          hasValidConfig: true,
          llm: { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4' },
        }} />
      );
      const frame = lastFrame();
      expect(frame).toContain('>');
    });
  });

  describe('组件生命周期', () => {
    it('卸载后不报错', () => {
      const { unmount } = render(
        <App config={{ hasValidConfig: false }} />
      );
      expect(() => unmount()).not.toThrow();
    });

    it('重新渲染后配置更新', () => {
      const { rerender, lastFrame } = render(
        <App config={{ hasValidConfig: false }} />
      );
      expect(lastFrame()).toContain('No configuration found');

      rerender(
        <App config={{
          hasValidConfig: true,
          llm: { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4' },
        }} />
      );
      expect(lastFrame()).toContain('colts-cli v0.1.0');
      expect(lastFrame()).not.toContain('No configuration found');
    });
  });
});
