/**
 * input.tsx 单元测试
 *
 * 测试 Input 组件的渲染行为，包括模式标签、运行指示器和提交回调。
 * 使用 ink-testing-library 进行组件渲染验证。
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Input } from '../../src/components/input.js';

describe('Input 组件', () => {
  describe('模式标签渲染', () => {
    it('run 模式显示 RUN 标签', () => {
      const { lastFrame } = render(
        <Input onSubmit={vi.fn()} mode="run" isRunning={false} />
      );
      const frame = lastFrame();
      expect(frame).toContain('[RUN]');
    });

    it('step 模式显示 STEP 标签', () => {
      const { lastFrame } = render(
        <Input onSubmit={vi.fn()} mode="step" isRunning={false} />
      );
      const frame = lastFrame();
      expect(frame).toContain('[STEP]');
    });

    it('advance 模式显示 ADV 标签', () => {
      const { lastFrame } = render(
        <Input onSubmit={vi.fn()} mode="advance" isRunning={false} />
      );
      const frame = lastFrame();
      expect(frame).toContain('[ADV]');
    });
  });

  describe('运行指示器', () => {
    it('isRunning 为 true 时显示运行指示器', () => {
      const { lastFrame } = render(
        <Input onSubmit={vi.fn()} mode="run" isRunning={true} />
      );
      const frame = lastFrame();
      // 运行指示器包含 ● 符号
      expect(frame).toContain('●');
    });

    it('isRunning 为 false 时不显示运行指示器', () => {
      const { lastFrame } = render(
        <Input onSubmit={vi.fn()} mode="run" isRunning={false} />
      );
      const frame = lastFrame();
      expect(frame).not.toContain('●');
    });

    it('step 模式运行时同时显示标签和指示器', () => {
      const { lastFrame } = render(
        <Input onSubmit={vi.fn()} mode="step" isRunning={true} />
      );
      const frame = lastFrame();
      expect(frame).toContain('[STEP]');
      expect(frame).toContain('●');
    });
  });

  describe('输入提示符', () => {
    it('渲染包含 > 提示符', () => {
      const { lastFrame } = render(
        <Input onSubmit={vi.fn()} mode="run" isRunning={false} />
      );
      const frame = lastFrame();
      expect(frame).toContain('>');
    });

    it('渲染包含模式标签和提示符', () => {
      const { lastFrame } = render(
        <Input onSubmit={vi.fn()} mode="run" isRunning={false} />
      );
      const frame = lastFrame();
      // 标签在 > 之前
      const labelIdx = frame!.indexOf('[RUN]');
      const promptIdx = frame!.indexOf('>');
      expect(labelIdx).toBeLessThan(promptIdx);
    });
  });

  describe('组件卸载', () => {
    it('卸载后不报错', () => {
      const { unmount } = render(
        <Input onSubmit={vi.fn()} mode="run" isRunning={false} />
      );
      expect(() => unmount()).not.toThrow();
    });

    it('重新渲染后模式标签更新', () => {
      const { rerender, lastFrame } = render(
        <Input onSubmit={vi.fn()} mode="run" isRunning={false} />
      );
      expect(lastFrame()).toContain('[RUN]');

      rerender(<Input onSubmit={vi.fn()} mode="step" isRunning={false} />);
      expect(lastFrame()).toContain('[STEP]');
      expect(lastFrame()).not.toContain('[RUN]');
    });
  });
});
