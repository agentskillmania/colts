/**
 * @fileoverview SetupWizard 组件单元测试
 *
 * 测试 3 步配置向导：Provider 选择 → API Key 输入 → Model 输入。
 * mock 策略：mock @inkjs/ui 的 Select 和 TextInput，捕获 onChange/onSubmit。
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { SetupWizard } from '../../src/components/setup/setup-wizard.js';

// ── mock setup ──

let capturedSelectOnChange: ((value: string) => void) | null = null;
let capturedTextInputOnSubmit: ((value: string) => void) | null = null;

vi.mock('@inkjs/ui', () => ({
  Select: ({ onChange }: { onChange: (v: string) => void }) => {
    capturedSelectOnChange = onChange;
    return React.createElement('select-mock');
  },
  TextInput: ({ onSubmit }: { onSubmit: (v: string) => void }) => {
    capturedTextInputOnSubmit = onSubmit;
    return React.createElement('text-input-mock');
  },
}));

// ── 辅助 ──

function resetCaptures() {
  capturedSelectOnChange = null;
  capturedTextInputOnSubmit = null;
}

// ── 测试用例 ──

describe('SetupWizard', () => {
  beforeEach(resetCaptures);

  // ── Step 1: Provider 选择 ──

  it('初始显示 Step 1/3', () => {
    const onComplete = vi.fn();
    const { lastFrame } = render(<SetupWizard onComplete={onComplete} />);
    expect(lastFrame()).toContain('Step 1/3');
  });

  it('显示 colts-cli Setup 标题', () => {
    const onComplete = vi.fn();
    const { lastFrame } = render(<SetupWizard onComplete={onComplete} />);
    expect(lastFrame()).toContain('colts-cli Setup');
  });

  it('显示 Select your LLM provider 提示', () => {
    const onComplete = vi.fn();
    const { lastFrame } = render(<SetupWizard onComplete={onComplete} />);
    expect(lastFrame()).toContain('Select your LLM provider');
  });

  it('选择 Provider 后进入 Step 2', async () => {
    const onComplete = vi.fn();
    const { lastFrame } = render(<SetupWizard onComplete={onComplete} />);

    expect(capturedSelectOnChange).not.toBeNull();
    capturedSelectOnChange!('openai');

    // 等待重渲染
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Step 2/3');
    });
    expect(lastFrame()).toContain('API key');
  });

  // ── Step 2: API Key 输入 ──

  it('输入 API Key 后进入 Step 3', async () => {
    const onComplete = vi.fn();
    const { lastFrame } = render(<SetupWizard onComplete={onComplete} />);

    // 选择 provider
    capturedSelectOnChange!('openai');

    // 等待 step 2 渲染后 TextInput 出现
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Step 2/3');
    });

    // 此时 TextInput mock 应该已经被调用
    expect(capturedTextInputOnSubmit).not.toBeNull();
    capturedTextInputOnSubmit!('sk-test-key');

    // 进入 Step 3
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Step 3/3');
    });
    expect(lastFrame()).toContain('Model');
  });

  // ── Step 3: Model 输入 ──

  it('显示默认 model（openai）', async () => {
    const onComplete = vi.fn();
    const { lastFrame } = render(<SetupWizard onComplete={onComplete} />);

    // Step 1 → 2
    capturedSelectOnChange!('openai');
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Step 2/3');
    });

    // Step 2 → 3
    capturedTextInputOnSubmit!('sk-123');
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Step 3/3');
    });

    // 默认 model 提示
    expect(lastFrame()).toContain('gpt-4o');
  });

  it('输入空 Model 使用默认值并调用 onComplete', async () => {
    const onComplete = vi.fn();
    const { lastFrame } = render(<SetupWizard onComplete={onComplete} />);

    // Step 1 → 2
    capturedSelectOnChange!('openai');
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Step 2/3');
    });

    // Step 2 → 3
    capturedTextInputOnSubmit!('sk-123');
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Step 3/3');
    });

    // Step 3: 输入空值
    capturedTextInputOnSubmit!('');

    await vi.waitFor(() => {
      expect(onComplete).toHaveBeenCalledOnce();
    });
    expect(onComplete).toHaveBeenCalledWith({
      provider: 'openai',
      apiKey: 'sk-123',
      model: 'gpt-4o',
    });
  });

  it('输入自定义 Model 值', async () => {
    const onComplete = vi.fn();
    render(<SetupWizard onComplete={onComplete} />);

    // Step 1
    capturedSelectOnChange!('openai');
    await vi.waitFor(() => {
      expect(capturedTextInputOnSubmit).not.toBeNull();
    });

    // Step 2
    capturedTextInputOnSubmit!('sk-abc');
    await vi.waitFor(() => {
      expect(capturedTextInputOnSubmit).not.toBeNull();
    });

    // Step 3: 输入自定义 model
    capturedTextInputOnSubmit!('gpt-4o-mini');

    await vi.waitFor(() => {
      expect(onComplete).toHaveBeenCalledOnce();
    });
    expect(onComplete).toHaveBeenCalledWith({
      provider: 'openai',
      apiKey: 'sk-abc',
      model: 'gpt-4o-mini',
    });
  });

  it('Google provider 的默认 model', async () => {
    const onComplete = vi.fn();
    render(<SetupWizard onComplete={onComplete} />);

    capturedSelectOnChange!('google');
    await vi.waitFor(() => {
      expect(capturedTextInputOnSubmit).not.toBeNull();
    });

    capturedTextInputOnSubmit!('google-key');
    await vi.waitFor(() => {
      expect(capturedTextInputOnSubmit).not.toBeNull();
    });

    // Step 3 默认是 gemini
    capturedTextInputOnSubmit!('');

    await vi.waitFor(() => {
      expect(onComplete).toHaveBeenCalledOnce();
    });
    expect(onComplete).toHaveBeenCalledWith({
      provider: 'google',
      apiKey: 'google-key',
      model: 'gemini-2.0-flash',
    });
  });

  it('Other provider 的默认 model', async () => {
    const onComplete = vi.fn();
    render(<SetupWizard onComplete={onComplete} />);

    capturedSelectOnChange!('other');
    await vi.waitFor(() => {
      expect(capturedTextInputOnSubmit).not.toBeNull();
    });

    capturedTextInputOnSubmit!('custom-key');
    await vi.waitFor(() => {
      expect(capturedTextInputOnSubmit).not.toBeNull();
    });

    capturedTextInputOnSubmit!('');

    await vi.waitFor(() => {
      expect(onComplete).toHaveBeenCalledOnce();
    });
    expect(onComplete).toHaveBeenCalledWith({
      provider: 'other',
      apiKey: 'custom-key',
      model: 'gpt-4o',
    });
  });

  it('完整流程：anthropic provider + 自定义 model', async () => {
    const onComplete = vi.fn();
    render(<SetupWizard onComplete={onComplete} />);

    capturedSelectOnChange!('anthropic');
    await vi.waitFor(() => {
      expect(capturedTextInputOnSubmit).not.toBeNull();
    });

    capturedTextInputOnSubmit!('sk-ant-123');
    await vi.waitFor(() => {
      expect(capturedTextInputOnSubmit).not.toBeNull();
    });

    capturedTextInputOnSubmit!('claude-opus-4-20250514');

    await vi.waitFor(() => {
      expect(onComplete).toHaveBeenCalledOnce();
    });
    expect(onComplete).toHaveBeenCalledWith({
      provider: 'anthropic',
      apiKey: 'sk-ant-123',
      model: 'claude-opus-4-20250514',
    });
  });

  it('unmount 不报错', () => {
    const onComplete = vi.fn();
    const { unmount } = render(<SetupWizard onComplete={onComplete} />);
    expect(() => unmount()).not.toThrow();
  });
});
