/**
 * @fileoverview ConfirmDialog 组件单元测试
 *
 * 测试工具确认对话框：显示工具名和参数、确认/取消回调。
 * mock 策略：mock @inkjs/ui 的 ConfirmInput，捕获 onConfirm/onCancel。
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

// ── 辅助 ──

function resetCaptures() {
  capturedOnConfirm = null;
  capturedOnCancel = null;
}

// ── 测试用例 ──

describe('ConfirmDialog', () => {
  beforeEach(resetCaptures);

  it('显示工具名', () => {
    const onResult = vi.fn();
    const { lastFrame } = render(
      <ConfirmDialog toolName="delete_file" args={{ path: '/tmp/test.txt' }} onResult={onResult} />
    );
    expect(lastFrame()).toContain('delete_file');
  });

  it('显示参数列表', () => {
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

  it('显示确认提示标题', () => {
    const onResult = vi.fn();
    const { lastFrame } = render(<ConfirmDialog toolName="rm" args={{}} onResult={onResult} />);
    expect(lastFrame()).toContain('Confirm tool execution');
  });

  it('确认时调用 onResult(true)', () => {
    const onResult = vi.fn();
    render(<ConfirmDialog toolName="delete_file" args={{ path: '/tmp/x' }} onResult={onResult} />);

    expect(capturedOnConfirm).not.toBeNull();
    capturedOnConfirm!();

    expect(onResult).toHaveBeenCalledOnce();
    expect(onResult).toHaveBeenCalledWith(true);
  });

  it('取消时调用 onResult(false)', () => {
    const onResult = vi.fn();
    render(<ConfirmDialog toolName="delete_file" args={{ path: '/tmp/x' }} onResult={onResult} />);

    expect(capturedOnCancel).not.toBeNull();
    capturedOnCancel!();

    expect(onResult).toHaveBeenCalledOnce();
    expect(onResult).toHaveBeenCalledWith(false);
  });

  it('空参数不崩溃', () => {
    const onResult = vi.fn();
    const { lastFrame } = render(<ConfirmDialog toolName="ping" args={{}} onResult={onResult} />);
    expect(lastFrame()).toContain('ping');
  });

  it('复杂参数（嵌套对象）正常显示', () => {
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

  it('unmount 不报错', () => {
    const onResult = vi.fn();
    const { unmount } = render(<ConfirmDialog toolName="test" args={{}} onResult={onResult} />);
    expect(() => unmount()).not.toThrow();
  });
});
