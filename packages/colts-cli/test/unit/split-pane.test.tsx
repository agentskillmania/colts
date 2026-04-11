/**
 * split-pane.tsx 单元测试
 *
 * 测试 SplitPane 组件的渲染行为，包括标题栏、分隔线和面板内容。
 * 使用 ink-testing-library 进行组件渲染验证。
 */

import React from 'react';
import { Text } from 'ink';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { SplitPane } from '../../src/components/split-pane.js';

describe('SplitPane 组件', () => {
  describe('基本渲染', () => {
    it('能渲染顶部和底部内容', () => {
      const { lastFrame } = render(
        <SplitPane
          top={<Text>Top content</Text>}
          bottom={<Text>Bottom content</Text>}
        />
      );
      const frame = lastFrame();
      expect(frame).toContain('Top content');
      expect(frame).toContain('Bottom content');
    });

    it('渲染水平分隔线', () => {
      const { lastFrame } = render(
        <SplitPane
          top={<Text>Top</Text>}
          bottom={<Text>Bottom</Text>}
        />
      );
      const frame = lastFrame();
      // 分隔线由 40 个 ─ 组成
      expect(frame).toContain('─'.repeat(40));
    });
  });

  describe('标题栏', () => {
    it('渲染顶部标题', () => {
      const { lastFrame } = render(
        <SplitPane
          top={<Text>Top</Text>}
          bottom={<Text>Bottom</Text>}
          topTitle="Chat"
        />
      );
      const frame = lastFrame();
      expect(frame).toContain('Chat');
      // 标题格式为 ── Chat ──
      expect(frame).toContain('── Chat ──');
    });

    it('渲染底部标题', () => {
      const { lastFrame } = render(
        <SplitPane
          top={<Text>Top</Text>}
          bottom={<Text>Bottom</Text>}
          bottomTitle="Events"
        />
      );
      const frame = lastFrame();
      expect(frame).toContain('── Events ──');
    });

    it('同时渲染顶部和底部标题', () => {
      const { lastFrame } = render(
        <SplitPane
          top={<Text>Top</Text>}
          bottom={<Text>Bottom</Text>}
          topTitle="Chat"
          bottomTitle="Events"
        />
      );
      const frame = lastFrame();
      expect(frame).toContain('── Chat ──');
      expect(frame).toContain('── Events ──');
    });

    it('无标题时不渲染标题栏', () => {
      const { lastFrame } = render(
        <SplitPane
          top={<Text>Top</Text>}
          bottom={<Text>Bottom</Text>}
        />
      );
      const frame = lastFrame();
      // 不应该出现 ── ... ── 格式的标题
      expect(frame).not.toContain('── Chat ──');
      expect(frame).not.toContain('── Events ──');
    });
  });

  describe('内容布局', () => {
    it('顶部内容在分隔线之上', () => {
      const { lastFrame } = render(
        <SplitPane
          top={<Text>Above</Text>}
          bottom={<Text>Below</Text>}
        />
      );
      const frame = lastFrame()!;
      const aboveIdx = frame.indexOf('Above');
      const dividerIdx = frame.indexOf('─'.repeat(10));
      const belowIdx = frame.indexOf('Below');
      expect(aboveIdx).toBeLessThan(dividerIdx);
      expect(dividerIdx).toBeLessThan(belowIdx);
    });

    it('能渲染 Text 元素作为面板内容并带标题', () => {
      const { lastFrame } = render(
        <SplitPane
          top={<Text>Top panel content</Text>}
          bottom={<Text>Bottom panel content</Text>}
          topTitle="Panel A"
          bottomTitle="Panel B"
        />
      );
      const frame = lastFrame();
      expect(frame).toContain('Top panel content');
      expect(frame).toContain('Bottom panel content');
      expect(frame).toContain('Panel A');
      expect(frame).toContain('Panel B');
    });
  });

  describe('组件卸载', () => {
    it('卸载后不报错', () => {
      const { unmount } = render(
        <SplitPane
          top={<Text>Top</Text>}
          bottom={<Text>Bottom</Text>}
        />
      );
      expect(() => unmount()).not.toThrow();
    });
  });
});
