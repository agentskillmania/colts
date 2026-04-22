/**
 * @fileoverview ConfirmDialog component unit tests
 *
 * Tests tool confirmation dialog: displays tool name and parameters, confirm/cancel callbacks.
 * Mock strategy: mock @inkjs/ui ConfirmInput, capture onConfirm/onCancel.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { ConfirmDialog } from '../../src/components/interactive/confirm-dialog.js';

// ── mock setup ──

let capturedOnConfirm: (() => void) | null = null;
let capturedOnCancel: (() => void) | null = null;

vi.mock('@inkjs/ui', () => ({
  ConfirmInput: ({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) => {
    capturedOnConfirm = onConfirm;
    capturedOnCancel = onCancel;
    return React.createElement('confirm-input-mock');
  },
}));

// ── Helpers ──

function resetCaptures() {
  capturedOnConfirm = null;
  capturedOnCancel = null;
}

// ── Test cases ──

describe('ConfirmDialog', () => {
  beforeEach(resetCaptures);

  it('shows tool name', () => {
    const onResult = vi.fn();
    const { lastFrame } = render(
      <ConfirmDialog toolName="delete_file" args={{ path: '/tmp/test.txt' }} onResult={onResult} />
    );
    expect(lastFrame()).toContain('delete_file');
  });

  it('shows parameter list', () => {
    const onResult = vi.fn();
    const { lastFrame } = render(
      <ConfirmDialog
        toolName="delete_file"
        args={{ path: '/tmp/test.txt', force: true }}
        onResult={onResult}
      />
    );
    expect(lastFrame()).toContain('path');
    expect(lastFrame()).toContain('/tmp/test.txt');
    expect(lastFrame()).toContain('force');
    expect(lastFrame()).toContain('true');
  });

  it('shows confirmation prompt title', () => {
    const onResult = vi.fn();
    const { lastFrame } = render(<ConfirmDialog toolName="rm" args={{}} onResult={onResult} />);
    expect(lastFrame()).toContain('Confirm tool execution');
  });

  it('calls onResult(true) on confirm', () => {
    const onResult = vi.fn();
    render(<ConfirmDialog toolName="delete_file" args={{ path: '/tmp/x' }} onResult={onResult} />);

    expect(capturedOnConfirm).not.toBeNull();
    capturedOnConfirm!();

    expect(onResult).toHaveBeenCalledOnce();
    expect(onResult).toHaveBeenCalledWith(true);
  });

  it('calls onResult(false) on cancel', () => {
    const onResult = vi.fn();
    render(<ConfirmDialog toolName="delete_file" args={{ path: '/tmp/x' }} onResult={onResult} />);

    expect(capturedOnCancel).not.toBeNull();
    capturedOnCancel!();

    expect(onResult).toHaveBeenCalledOnce();
    expect(onResult).toHaveBeenCalledWith(false);
  });

  it('does not crash with empty parameters', () => {
    const onResult = vi.fn();
    const { lastFrame } = render(<ConfirmDialog toolName="ping" args={{}} onResult={onResult} />);
    expect(lastFrame()).toContain('ping');
  });

  it('displays complex parameters (nested object) correctly', () => {
    const onResult = vi.fn();
    const { lastFrame } = render(
      <ConfirmDialog
        toolName="deploy"
        args={{ targets: ['prod', 'staging'], config: { retries: 3 } }}
        onResult={onResult}
      />
    );
    expect(lastFrame()).toContain('targets');
    expect(lastFrame()).toContain('prod');
  });

  it('unmount does not throw', () => {
    const onResult = vi.fn();
    const { unmount } = render(<ConfirmDialog toolName="test" args={{}} onResult={onResult} />);
    expect(() => unmount()).not.toThrow();
  });
});
