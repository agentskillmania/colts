/**
 * @fileoverview InputBar component unit tests — covering handleSubmit logic
 *
 * Mocks TextInput to directly control the onSubmit callback.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';

/** Capture the TextInput onSubmit callback */
let capturedOnSubmit: ((value: string) => void) | null = null;

vi.mock('@inkjs/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@inkjs/ui')>();
  return {
    ...actual,
    TextInput: ({
      onSubmit,
      placeholder,
    }: {
      onSubmit: (v: string) => void;
      placeholder?: string;
    }) => {
      capturedOnSubmit = onSubmit;
      return React.createElement(Text, null, placeholder ?? '');
    },
  };
});

import { InputBar } from '../../../src/components/input/input-bar.js';

beforeEach(() => {
  capturedOnSubmit = null;
});

describe('InputBar — handleSubmit (normal state)', () => {
  it('submitting with content triggers onSubmit(trimmed)', () => {
    const onSubmit = vi.fn();
    render(<InputBar onSubmit={onSubmit} mode="run" isRunning={false} />);

    capturedOnSubmit!('  hello  ');
    expect(onSubmit).toHaveBeenCalledWith('hello');
  });

  it('empty content does not trigger onSubmit', () => {
    const onSubmit = vi.fn();
    render(<InputBar onSubmit={onSubmit} mode="run" isRunning={false} />);

    capturedOnSubmit!('');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('whitespace-only does not trigger onSubmit', () => {
    const onSubmit = vi.fn();
    render(<InputBar onSubmit={onSubmit} mode="run" isRunning={false} />);

    capturedOnSubmit!('   ');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('normal content is passed after trim', () => {
    const onSubmit = vi.fn();
    render(<InputBar onSubmit={onSubmit} mode="run" isRunning={false} />);

    capturedOnSubmit!('Read main.ts');
    expect(onSubmit).toHaveBeenCalledWith('Read main.ts');
  });
});

describe('InputBar — handleSubmit (paused state)', () => {
  it('empty input while paused triggers onSubmit(empty string)', () => {
    const onSubmit = vi.fn();
    render(<InputBar onSubmit={onSubmit} mode="step" isRunning={true} isPaused={true} />);

    capturedOnSubmit!('');
    expect(onSubmit).toHaveBeenCalledWith('');
  });

  it('whitespace while paused triggers onSubmit(empty string)', () => {
    const onSubmit = vi.fn();
    render(<InputBar onSubmit={onSubmit} mode="step" isRunning={true} isPaused={true} />);

    capturedOnSubmit!('   ');
    expect(onSubmit).toHaveBeenCalledWith('');
  });

  it('content while paused and isRunning=true does not trigger onSubmit', () => {
    const onSubmit = vi.fn();
    render(<InputBar onSubmit={onSubmit} mode="step" isRunning={true} isPaused={true} />);

    capturedOnSubmit!('continue msg');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows Press Enter hint while paused', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      <InputBar onSubmit={onSubmit} mode="step" isRunning={true} isPaused={true} />
    );
    expect(lastFrame()).toContain('Press Enter to continue');
  });
});

describe('InputBar — rendering state', () => {
  it('shows input box when idle', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(<InputBar onSubmit={onSubmit} mode="run" isRunning={false} />);
    expect(lastFrame()).toContain('Type your message');
  });

  it('shows Spinner while running', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(<InputBar onSubmit={onSubmit} mode="run" isRunning={true} />);
    expect(lastFrame()).toContain('Agent is thinking');
  });

  it('shows RUN mode label', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(<InputBar onSubmit={onSubmit} mode="run" isRunning={false} />);
    expect(lastFrame()).toContain('RUN');
  });

  it('shows STEP mode label', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(<InputBar onSubmit={onSubmit} mode="step" isRunning={false} />);
    expect(lastFrame()).toContain('STEP');
  });

  it('shows ADV mode label', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(<InputBar onSubmit={onSubmit} mode="advance" isRunning={false} />);
    expect(lastFrame()).toContain('ADV');
  });
});
