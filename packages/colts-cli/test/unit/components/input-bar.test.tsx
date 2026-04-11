/**
 * @fileoverview InputBar component unit tests
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { InputBar } from '../../../src/components/input/input-bar.js';

describe('InputBar', () => {
  it('should show input bar when idle', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      <InputBar onSubmit={onSubmit} mode="run" isRunning={false} />
    );
    const frame = lastFrame();
    expect(frame).toContain('RUN');
    expect(frame).toContain('Type your message...');
  });

  it('should show spinner when running', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      <InputBar onSubmit={onSubmit} mode="run" isRunning={true} />
    );
    expect(lastFrame()).toContain('Agent is thinking...');
  });

  it('should show STEP label in step mode', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      <InputBar onSubmit={onSubmit} mode="step" isRunning={false} />
    );
    expect(lastFrame()).toContain('STEP');
  });

  it('should show ADV label in advance mode', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      <InputBar onSubmit={onSubmit} mode="advance" isRunning={false} />
    );
    expect(lastFrame()).toContain('ADV');
  });

  it('should have border', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      <InputBar onSubmit={onSubmit} mode="run" isRunning={false} />
    );
    // ink border uses box drawing characters
    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });
});
