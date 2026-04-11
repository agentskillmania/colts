/**
 * status-indicator.tsx 单元测试
 *
 * 测试 StatusIndicator 组件的渲染行为，包括状态图标、颜色和自定义文本。
 * 使用 ink-testing-library 进行组件渲染验证。
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { StatusIndicator } from '../../src/components/ui/status-indicator.js';

describe('StatusIndicator 组件', () => {
  describe('状态图标渲染', () => {
    it('loading 状态显示 ◐ 图标', () => {
      const { lastFrame } = render(<StatusIndicator type="loading" />);
      const frame = lastFrame();
      expect(frame).toContain('◐');
    });

    it('success 状态显示 ✔ 图标', () => {
      const { lastFrame } = render(<StatusIndicator type="success" />);
      const frame = lastFrame();
      expect(frame).toContain('✔');
    });

    it('error 状态显示 ✖ 图标', () => {
      const { lastFrame } = render(<StatusIndicator type="error" />);
      const frame = lastFrame();
      expect(frame).toContain('✖');
    });

    it('idle 状态显示 ○ 图标', () => {
      const { lastFrame } = render(<StatusIndicator type="idle" />);
      const frame = lastFrame();
      expect(frame).toContain('○');
    });
  });

  describe('默认文本', () => {
    it('loading 状态默认文本为 "loading"', () => {
      const { lastFrame } = render(<StatusIndicator type="loading" />);
      const frame = lastFrame();
      expect(frame).toContain('loading');
    });

    it('success 状态默认文本为 "success"', () => {
      const { lastFrame } = render(<StatusIndicator type="success" />);
      const frame = lastFrame();
      expect(frame).toContain('success');
    });

    it('error 状态默认文本为 "error"', () => {
      const { lastFrame } = render(<StatusIndicator type="error" />);
      const frame = lastFrame();
      expect(frame).toContain('error');
    });

    it('idle 状态默认文本为 "idle"', () => {
      const { lastFrame } = render(<StatusIndicator type="idle" />);
      const frame = lastFrame();
      expect(frame).toContain('idle');
    });
  });

  describe('自定义文本', () => {
    it('能显示自定义加载文本', () => {
      const { lastFrame } = render(
        <StatusIndicator type="loading" text="Loading data..." />
      );
      const frame = lastFrame();
      expect(frame).toContain('Loading data...');
      // 不应显示默认的 "loading" 文本（因为被覆盖了）
      expect(frame).toContain('◐');
    });

    it('能显示自定义成功文本', () => {
      const { lastFrame } = render(
        <StatusIndicator type="success" text="Completed!" />
      );
      const frame = lastFrame();
      expect(frame).toContain('Completed!');
      expect(frame).toContain('✔');
    });

    it('能显示自定义错误文本', () => {
      const { lastFrame } = render(
        <StatusIndicator type="error" text="Connection failed" />
      );
      const frame = lastFrame();
      expect(frame).toContain('Connection failed');
      expect(frame).toContain('✖');
    });

    it('能显示自定义空闲文本', () => {
      const { lastFrame } = render(
        <StatusIndicator type="idle" text="Waiting for input" />
      );
      const frame = lastFrame();
      expect(frame).toContain('Waiting for input');
      expect(frame).toContain('○');
    });

    it('空字符串自定义文本也能正常渲染', () => {
      const { lastFrame } = render(
        <StatusIndicator type="success" text="" />
      );
      const frame = lastFrame();
      expect(frame).toContain('✔');
    });
  });

  describe('组合渲染', () => {
    it('图标和文本之间有空格分隔', () => {
      const { lastFrame } = render(
        <StatusIndicator type="success" text="Done" />
      );
      const frame = lastFrame();
      // 图标和文本之间应该有空格
      expect(frame).toContain('✔ Done');
    });
  });
});
