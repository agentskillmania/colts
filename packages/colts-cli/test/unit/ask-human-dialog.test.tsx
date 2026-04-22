/**
 * @fileoverview AskHumanDialog component unit tests
 *
 * Tests question-by-question flow: text, number, single-select, multi-select question types,
 * as well as sequential multi-question answering, context display, answer format.
 * Mock strategy: mock @inkjs/ui TextInput/Select/MultiSelect, capture onSubmit/onChange.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { AskHumanDialog } from '../../src/components/interactive/ask-human-dialog.js';
import type { Question, HumanResponse } from '@agentskillmania/colts';

// ── mock setup ──

let capturedTextInputOnSubmit: ((value: string) => void) | null = null;
let capturedSelectOnChange: ((value: string) => void) | null = null;
let capturedMultiSelectOnSubmit: ((values: string[]) => void) | null = null;

vi.mock('@inkjs/ui', () => ({
  TextInput: ({ onSubmit }: { onSubmit: (v: string) => void }) => {
    capturedTextInputOnSubmit = onSubmit;
    return React.createElement('text-input-mock');
  },
  Select: ({ onChange }: { onChange: (v: string) => void }) => {
    capturedSelectOnChange = onChange;
    return React.createElement('select-mock');
  },
  MultiSelect: ({ onSubmit }: { onSubmit: (v: string[]) => void }) => {
    capturedMultiSelectOnSubmit = onSubmit;
    return React.createElement('multi-select-mock');
  },
}));

// ── Helpers ──

function resetCaptures() {
  capturedTextInputOnSubmit = null;
  capturedSelectOnChange = null;
  capturedMultiSelectOnSubmit = null;
}

// ── Test cases ──

describe('AskHumanDialog', () => {
  beforeEach(resetCaptures);

  it('shows first question (text type)', () => {
    const questions: Question[] = [{ id: 'q1', question: 'What is your name?', type: 'text' }];
    const onAnswer = vi.fn();
    const { lastFrame } = render(<AskHumanDialog questions={questions} onAnswer={onAnswer} />);
    const frame = lastFrame();
    expect(frame).toContain('[1/1]');
    expect(frame).toContain('What is your name?');
  });

  it('shows context info', () => {
    const questions: Question[] = [{ id: 'q1', question: 'Name?', type: 'text' }];
    const onAnswer = vi.fn();
    const { lastFrame } = render(
      <AskHumanDialog questions={questions} context="Need your info" onAnswer={onAnswer} />
    );
    expect(lastFrame()).toContain('Need your info');
  });

  it('does not show context when none provided', () => {
    const questions: Question[] = [{ id: 'q1', question: 'Name?', type: 'text' }];
    const onAnswer = vi.fn();
    const { lastFrame } = render(<AskHumanDialog questions={questions} onAnswer={onAnswer} />);
    // Only check it does not crash, no extra context text
    expect(lastFrame()).toContain('Name?');
  });

  it('calls onAnswer after text type submits answer', () => {
    const questions: Question[] = [{ id: 'q1', question: 'Name?', type: 'text' }];
    const onAnswer = vi.fn();
    render(<AskHumanDialog questions={questions} onAnswer={onAnswer} />);

    expect(capturedTextInputOnSubmit).not.toBeNull();
    capturedTextInputOnSubmit!('Alice');

    expect(onAnswer).toHaveBeenCalledOnce();
    const response = onAnswer.mock.calls[0][0] as HumanResponse;
    expect(response.q1).toEqual({ type: 'direct', value: 'Alice' });
  });

  it('number type parses as number', () => {
    const questions: Question[] = [{ id: 'q1', question: 'How old?', type: 'number' }];
    const onAnswer = vi.fn();
    render(<AskHumanDialog questions={questions} onAnswer={onAnswer} />);

    capturedTextInputOnSubmit!('42');

    const response = onAnswer.mock.calls[0][0] as HumanResponse;
    expect(response.q1).toEqual({ type: 'direct', value: 42 });
  });

  it('number type preserves original string for invalid input', () => {
    const questions: Question[] = [{ id: 'q1', question: 'How old?', type: 'number' }];
    const onAnswer = vi.fn();
    render(<AskHumanDialog questions={questions} onAnswer={onAnswer} />);

    capturedTextInputOnSubmit!('not-a-number');

    const response = onAnswer.mock.calls[0][0] as HumanResponse;
    expect(response.q1).toEqual({ type: 'direct', value: 'not-a-number' });
  });

  it('single-select type uses Select onChange', () => {
    const questions: Question[] = [
      { id: 'q1', question: 'Pick one', type: 'single-select', options: ['A', 'B', 'C'] },
    ];
    const onAnswer = vi.fn();
    const { lastFrame } = render(<AskHumanDialog questions={questions} onAnswer={onAnswer} />);

    expect(lastFrame()).toContain('Pick one');
    expect(capturedSelectOnChange).not.toBeNull();
    capturedSelectOnChange!('B');

    const response = onAnswer.mock.calls[0][0] as HumanResponse;
    expect(response.q1).toEqual({ type: 'direct', value: 'B' });
  });

  it('multi-select type uses MultiSelect onSubmit', () => {
    const questions: Question[] = [
      { id: 'q1', question: 'Pick many', type: 'multi-select', options: ['X', 'Y', 'Z'] },
    ];
    const onAnswer = vi.fn();
    const { lastFrame } = render(<AskHumanDialog questions={questions} onAnswer={onAnswer} />);

    expect(lastFrame()).toContain('Pick many');
    expect(capturedMultiSelectOnSubmit).not.toBeNull();
    capturedMultiSelectOnSubmit!(['X', 'Z']);

    const response = onAnswer.mock.calls[0][0] as HumanResponse;
    expect(response.q1).toEqual({ type: 'direct', value: ['X', 'Z'] });
  });

  it('sequential multi-question answering: shows second question after first', async () => {
    const questions: Question[] = [
      { id: 'q1', question: 'Name?', type: 'text' },
      { id: 'q2', question: 'Age?', type: 'number' },
    ];
    const onAnswer = vi.fn();
    const { lastFrame } = render(<AskHumanDialog questions={questions} onAnswer={onAnswer} />);

    // First question
    expect(lastFrame()).toContain('[1/2]');
    expect(lastFrame()).toContain('Name?');

    // Submit first question answer
    capturedTextInputOnSubmit!('Bob');

    // Wait for re-render, second question appears
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('[2/2]');
      expect(lastFrame()).toContain('Age?');
    });

    // onAnswer not called yet (still has second question)
    expect(onAnswer).not.toHaveBeenCalled();

    // Submit second question
    capturedTextInputOnSubmit!('25');

    // Now both questions answered, onAnswer is called
    await vi.waitFor(() => {
      expect(onAnswer).toHaveBeenCalledOnce();
    });
    const response = onAnswer.mock.calls[0][0] as HumanResponse;
    expect(response.q1).toEqual({ type: 'direct', value: 'Bob' });
    expect(response.q2).toEqual({ type: 'direct', value: 25 });
  });

  it('three-question mixed-type full flow', async () => {
    const questions: Question[] = [
      { id: 'name', question: 'Your name?', type: 'text' },
      { id: 'color', question: 'Favorite color?', type: 'single-select', options: ['red', 'blue'] },
      { id: 'skills', question: 'Your skills?', type: 'multi-select', options: ['js', 'ts', 'go'] },
    ];
    const onAnswer = vi.fn();
    const { lastFrame } = render(<AskHumanDialog questions={questions} onAnswer={onAnswer} />);

    // First question (text)
    expect(lastFrame()).toContain('[1/3]');
    capturedTextInputOnSubmit!('Alice');

    // Wait for second question (single-select)
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('[2/3]');
    });
    capturedSelectOnChange!('blue');

    // Wait for third question (multi-select)
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('[3/3]');
    });
    capturedMultiSelectOnSubmit!(['js', 'ts']);

    // Final result
    await vi.waitFor(() => {
      expect(onAnswer).toHaveBeenCalledOnce();
    });
    const response = onAnswer.mock.calls[0][0] as HumanResponse;
    expect(response.name).toEqual({ type: 'direct', value: 'Alice' });
    expect(response.color).toEqual({ type: 'direct', value: 'blue' });
    expect(response.skills).toEqual({ type: 'direct', value: ['js', 'ts'] });
  });

  it('unmount does not throw', () => {
    const questions: Question[] = [{ id: 'q1', question: 'Name?', type: 'text' }];
    const onAnswer = vi.fn();
    const { unmount } = render(<AskHumanDialog questions={questions} onAnswer={onAnswer} />);
    expect(() => unmount()).not.toThrow();
  });
});
