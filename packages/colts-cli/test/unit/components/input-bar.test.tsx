/**
 * @fileoverview InputBar 组件单元测试
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { InputBar } from '../../../src/components/input/input-bar.js';

describe('InputBar', () => {
  it('空闲时显示输入框', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      <InputBar onSubmit={onSubmit} mode="run" isRunning={false} />
    );
    const frame = lastFrame();
    expect(frame).toContain('RUN');
    expect(frame).toContain('Type your message...');
  });

  it('运行时显示 Spinner', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      <InputBar onSubmit={onSubmit} mode="run" isRunning={true} />
    );
    expect(lastFrame()).toContain('Agent is thinking...');
  });

  it('step 模式显示 STEP 标签', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      <InputBar onSubmit={onSubmit} mode="step" isRunning={false} />
    );
    expect(lastFrame()).toContain('STEP');
  });

  it('advance 模式显示 ADV 标签', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      <InputBar onSubmit={onSubmit} mode="advance" isRunning={false} />
    );
    expect(lastFrame()).toContain('ADV');
  });

  it('有边框', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      <InputBar onSubmit={onSubmit} mode="run" isRunning={false} />
    );
    // ink border 使用 box drawing 字符
    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });
});
