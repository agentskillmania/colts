/**
 * @fileoverview WelcomeScreen 组件单元测试
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { WelcomeScreen } from '../../../src/components/screens/welcome-screen.js';

describe('WelcomeScreen', () => {
  it('显示欢迎语', () => {
    const { lastFrame } = render(<WelcomeScreen />);
    expect(lastFrame()).toContain('Welcome to colts-cli');
  });

  it('显示 agent 名称', () => {
    const { lastFrame } = render(<WelcomeScreen agentName="my-agent" />);
    expect(lastFrame()).toContain('my-agent');
  });

  it('显示模型名', () => {
    const { lastFrame } = render(<WelcomeScreen model="gpt-4o" />);
    expect(lastFrame()).toContain('gpt-4o');
  });

  it('显示帮助提示', () => {
    const { lastFrame } = render(<WelcomeScreen />);
    expect(lastFrame()).toContain('/help');
  });

  it('无参数只显示欢迎语和提示', () => {
    const { lastFrame } = render(<WelcomeScreen />);
    const frame = lastFrame();
    expect(frame).toContain('Welcome to colts-cli');
    expect(frame).toContain('Type a message below to start');
  });
});
