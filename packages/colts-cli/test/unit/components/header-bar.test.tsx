/**
 * @fileoverview HeaderBar component unit tests
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { HeaderBar } from '../../../src/components/layout/header-bar.js';

describe('HeaderBar', () => {
  it('should display version and model name', () => {
    const { lastFrame } = render(<HeaderBar model="gpt-4o" status="idle" />);
    const frame = lastFrame();
    expect(frame).toContain('colts-cli v0.1.0');
    expect(frame).toContain('gpt-4o');
  });

  it('should display Ready when idle', () => {
    const { lastFrame } = render(<HeaderBar model="gpt-4" status="idle" />);
    expect(lastFrame()).toContain('READY');
  });

  it('should display Running while running', () => {
    const { lastFrame } = render(<HeaderBar model="gpt-4" status="running" />);
    expect(lastFrame()).toContain('Running');
  });

  it('should display Error when errored', () => {
    const { lastFrame } = render(<HeaderBar model="gpt-4" status="error" />);
    expect(lastFrame()).toContain('ERROR');
  });

  it('should show exit hint when idle', () => {
    const { lastFrame } = render(<HeaderBar model="gpt-4" status="idle" />);
    expect(lastFrame()).toContain('exit');
  });

  it('should show interrupt hint while running', () => {
    const { lastFrame } = render(<HeaderBar model="gpt-4" status="running" />);
    expect(lastFrame()).toContain('interrupt');
  });
});
