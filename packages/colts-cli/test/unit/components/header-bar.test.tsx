/**
 * @fileoverview HeaderBar 组件单元测试
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { HeaderBar } from '../../../src/components/layout/header-bar.js';

describe('HeaderBar', () => {
  it('应该显示版本和模型名', () => {
    const { lastFrame } = render(<HeaderBar model="gpt-4o" status="idle" />);
    const frame = lastFrame();
    expect(frame).toContain('colts-cli v0.1.0');
    expect(frame).toContain('gpt-4o');
  });

  it('空闲时应该显示 Ready', () => {
    const { lastFrame } = render(<HeaderBar model="gpt-4" status="idle" />);
    expect(lastFrame()).toContain('READY');
  });

  it('运行中应该显示 Running', () => {
    const { lastFrame } = render(<HeaderBar model="gpt-4" status="running" />);
    expect(lastFrame()).toContain('Running');
  });

  it('出错时应该显示 Error', () => {
    const { lastFrame } = render(<HeaderBar model="gpt-4" status="error" />);
    expect(lastFrame()).toContain('ERROR');
  });

  it('空闲时应该显示 exit 提示', () => {
    const { lastFrame } = render(<HeaderBar model="gpt-4" status="idle" />);
    expect(lastFrame()).toContain('exit');
  });

  it('运行中应该显示 interrupt 提示', () => {
    const { lastFrame } = render(<HeaderBar model="gpt-4" status="running" />);
    expect(lastFrame()).toContain('interrupt');
  });
});
