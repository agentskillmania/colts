/**
 * @fileoverview HeaderBar 组件单元测试
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { HeaderBar } from '../../../src/components/layout/header-bar.js';

describe('HeaderBar', () => {
  it('显示版本号和模型名', () => {
    const { lastFrame } = render(<HeaderBar model="gpt-4o" status="idle" eventsVisible={true} />);
    const frame = lastFrame();
    expect(frame).toContain('colts-cli v0.1.0');
    expect(frame).toContain('gpt-4o');
  });

  it('空闲时显示 Ready 状态', () => {
    const { lastFrame } = render(<HeaderBar model="gpt-4" status="idle" eventsVisible={true} />);
    expect(lastFrame()).toContain('READY');
  });

  it('运行时显示 Running 状态', () => {
    const { lastFrame } = render(<HeaderBar model="gpt-4" status="running" eventsVisible={true} />);
    expect(lastFrame()).toContain('Running');
  });

  it('错误时显示 Error 状态', () => {
    const { lastFrame } = render(<HeaderBar model="gpt-4" status="error" eventsVisible={true} />);
    expect(lastFrame()).toContain('ERROR');
  });

  it('events 可见时显示 hide 提示', () => {
    const { lastFrame } = render(<HeaderBar model="gpt-4" status="idle" eventsVisible={true} />);
    expect(lastFrame()).toContain('hide events');
  });

  it('events 隐藏时显示 show 提示', () => {
    const { lastFrame } = render(<HeaderBar model="gpt-4" status="idle" eventsVisible={false} />);
    expect(lastFrame()).toContain('show events');
  });
});
