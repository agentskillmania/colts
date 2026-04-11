/**
 * @fileoverview WelcomeScreen component unit tests
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { WelcomeScreen } from '../../../src/components/screens/welcome-screen.js';

describe('WelcomeScreen', () => {
  it('should display welcome message', () => {
    const { lastFrame } = render(<WelcomeScreen />);
    expect(lastFrame()).toContain('Welcome to colts-cli');
  });

  it('should display agent name', () => {
    const { lastFrame } = render(<WelcomeScreen agentName="my-agent" />);
    expect(lastFrame()).toContain('my-agent');
  });

  it('should display model name', () => {
    const { lastFrame } = render(<WelcomeScreen model="gpt-4o" />);
    expect(lastFrame()).toContain('gpt-4o');
  });

  it('should display help hint', () => {
    const { lastFrame } = render(<WelcomeScreen />);
    expect(lastFrame()).toContain('/help');
  });

  it('should show only welcome message and hint with no props', () => {
    const { lastFrame } = render(<WelcomeScreen />);
    const frame = lastFrame();
    expect(frame).toContain('Welcome to colts-cli');
    expect(frame).toContain('Type a message below to start');
  });
});
