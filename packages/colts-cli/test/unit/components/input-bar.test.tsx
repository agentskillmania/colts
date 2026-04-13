/**
 * @fileoverview InputBar 组件单元测试 — 覆盖 handleSubmit 逻辑
 *
 * Mock TextInput 以直接控制 onSubmit 回调触发。
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';

/** 捕获 TextInput 的 onSubmit 回调 */
let capturedOnSubmit: ((value: string) => void) | null = null;

vi.mock('@inkjs/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@inkjs/ui')>();
  return {
    ...actual,
    TextInput: ({ onSubmit, placeholder }: { onSubmit: (v: string) => void; placeholder?: string }) => {
      capturedOnSubmit = onSubmit;
      return React.createElement(Text, null, placeholder ?? '');
    },
  };
});

import { InputBar } from '../../../src/components/input/input-bar.js';

beforeEach(() => {
  capturedOnSubmit = null;
});

describe('InputBar — handleSubmit（正常状态）', () => {
  it('有内容的提交触发 onSubmit(trimmed)', () => {
    const onSubmit = vi.fn();
    render(<InputBar onSubmit={onSubmit} mode="run" isRunning={false} />);

    capturedOnSubmit!('  hello  ');
    expect(onSubmit).toHaveBeenCalledWith('hello');
  });

  it('空内容不触发 onSubmit', () => {
    const onSubmit = vi.fn();
    render(<InputBar onSubmit={onSubmit} mode="run" isRunning={false} />);

    capturedOnSubmit!('');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('纯空格不触发 onSubmit', () => {
    const onSubmit = vi.fn();
    render(<InputBar onSubmit={onSubmit} mode="run" isRunning={false} />);

    capturedOnSubmit!('   ');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('正常内容 trim 后传递', () => {
    const onSubmit = vi.fn();
    render(<InputBar onSubmit={onSubmit} mode="run" isRunning={false} />);

    capturedOnSubmit!('Read main.ts');
    expect(onSubmit).toHaveBeenCalledWith('Read main.ts');
  });
});

describe('InputBar — handleSubmit（暂停状态）', () => {
  it('暂停时空输入触发 onSubmit(空字符串)', () => {
    const onSubmit = vi.fn();
    render(<InputBar onSubmit={onSubmit} mode="step" isRunning={true} isPaused={true} />);

    capturedOnSubmit!('');
    expect(onSubmit).toHaveBeenCalledWith('');
  });

  it('暂停时空格也触发 onSubmit(空字符串)', () => {
    const onSubmit = vi.fn();
    render(<InputBar onSubmit={onSubmit} mode="step" isRunning={true} isPaused={true} />);

    capturedOnSubmit!('   ');
    expect(onSubmit).toHaveBeenCalledWith('');
  });

  it('暂停时有内容但 isRunning=true 不触发 onSubmit', () => {
    const onSubmit = vi.fn();
    render(<InputBar onSubmit={onSubmit} mode="step" isRunning={true} isPaused={true} />);

    capturedOnSubmit!('continue msg');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('暂停时显示 Press Enter 提示', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      <InputBar onSubmit={onSubmit} mode="step" isRunning={true} isPaused={true} />
    );
    expect(lastFrame()).toContain('Press Enter to continue');
  });
});

describe('InputBar — 渲染状态', () => {
  it('空闲时显示输入框', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      <InputBar onSubmit={onSubmit} mode="run" isRunning={false} />
    );
    expect(lastFrame()).toContain('Type your message');
  });

  it('运行中显示 Spinner', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      <InputBar onSubmit={onSubmit} mode="run" isRunning={true} />
    );
    expect(lastFrame()).toContain('Agent is thinking');
  });

  it('显示 RUN 模式标签', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      <InputBar onSubmit={onSubmit} mode="run" isRunning={false} />
    );
    expect(lastFrame()).toContain('RUN');
  });

  it('显示 STEP 模式标签', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      <InputBar onSubmit={onSubmit} mode="step" isRunning={false} />
    );
    expect(lastFrame()).toContain('STEP');
  });

  it('显示 ADV 模式标签', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      <InputBar onSubmit={onSubmit} mode="advance" isRunning={false} />
    );
    expect(lastFrame()).toContain('ADV');
  });
});
