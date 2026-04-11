/**
 * @fileoverview HeaderBar component unit tests
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { HeaderBar } from '../../../src/components/layout/header-bar.js';

describe('HeaderBar', () => {
  it('should display version and model name', () => {
    const { lastFrame } = render(<HeaderBar model="gpt-4o" status="idle" eventsVisible={true} />);
    const frame = lastFrame();
    expect(frame).toContain('colts-cli v0.1.0');
    expect(frame).toContain('gpt-4o');
  });

  it('should show Ready status when idle', () => {
    const { lastFrame } = render(<HeaderBar model="gpt-4" status="idle" eventsVisible={true} />);
    expect(lastFrame()).toContain('READY');
  });

  it('should show Running status when running', () => {
    const { lastFrame } = render(<HeaderBar model="gpt-4" status="running" eventsVisible={true} />);
    expect(lastFrame()).toContain('Running');
  });

  it('should show Error status on error', () => {
    const { lastFrame } = render(<HeaderBar model="gpt-4" status="error" eventsVisible={true} />);
    expect(lastFrame()).toContain('ERROR');
  });

  it('should show hide hint when events are visible', () => {
    const { lastFrame } = render(<HeaderBar model="gpt-4" status="idle" eventsVisible={true} />);
    expect(lastFrame()).toContain('hide events');
  });

  it('should show show hint when events are hidden', () => {
    const { lastFrame } = render(<HeaderBar model="gpt-4" status="idle" eventsVisible={false} />);
    expect(lastFrame()).toContain('show events');
  });
});
