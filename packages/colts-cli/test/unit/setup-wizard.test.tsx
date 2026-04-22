/**
 * @fileoverview SetupWizard component unit tests
 *
 * Tests 3-step config wizard: Provider selection → API Key input → Model input.
 * Mock strategy: mock @inkjs/ui Select and TextInput, capture onChange/onSubmit.
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

// ── Helpers ──

function resetCaptures() {
  capturedSelectOnChange = null;
  capturedTextInputOnSubmit = null;
}

// ── Test cases ──

describe('SetupWizard', () => {
  beforeEach(resetCaptures);

  // ── Step 1: Provider selection ──

  it('initially shows Step 1/3', () => {
    const onComplete = vi.fn();
    const { lastFrame } = render(<SetupWizard onComplete={onComplete} />);
    expect(lastFrame()).toContain('Step 1/3');
  });

  it('shows colts-cli Setup title', () => {
    const onComplete = vi.fn();
    const { lastFrame } = render(<SetupWizard onComplete={onComplete} />);
    expect(lastFrame()).toContain('colts-cli Setup');
  });

  it('shows Select your LLM provider prompt', () => {
    const onComplete = vi.fn();
    const { lastFrame } = render(<SetupWizard onComplete={onComplete} />);
    expect(lastFrame()).toContain('Select your LLM provider');
  });

  it('enters Step 2 after selecting Provider', async () => {
    const onComplete = vi.fn();
    const { lastFrame } = render(<SetupWizard onComplete={onComplete} />);

    expect(capturedSelectOnChange).not.toBeNull();
    capturedSelectOnChange!('openai');

    // Wait for re-render
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Step 2/3');
    });
    expect(lastFrame()).toContain('API key');
  });

  // ── Step 2: API Key input ──

  it('enters Step 3 after inputting API Key', async () => {
    const onComplete = vi.fn();
    const { lastFrame } = render(<SetupWizard onComplete={onComplete} />);

    // Select provider
    capturedSelectOnChange!('openai');

    // Wait for step 2 render, TextInput appears
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Step 2/3');
    });

    // TextInput mock should have been called by now
    expect(capturedTextInputOnSubmit).not.toBeNull();
    capturedTextInputOnSubmit!('sk-test-key');

    // Enter Step 3
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Step 3/3');
    });
    expect(lastFrame()).toContain('Model');
  });

  // ── Step 3: Model input ──

  it('shows default model (openai)', async () => {
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

    // Default model hint
    expect(lastFrame()).toContain('gpt-4o');
  });

  it('uses default value when empty Model is input and calls onComplete', async () => {
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

    // Step 3: input empty value
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

  it('inputs custom Model value', async () => {
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

    // Step 3: input custom model
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

  it('Google provider default model', async () => {
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

    // Step 3 default is gemini
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

  it('Other provider default model', async () => {
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

  it('full flow: anthropic provider + custom model', async () => {
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

  it('unmount does not throw', () => {
    const onComplete = vi.fn();
    const { unmount } = render(<SetupWizard onComplete={onComplete} />);
    expect(() => unmount()).not.toThrow();
  });
});
