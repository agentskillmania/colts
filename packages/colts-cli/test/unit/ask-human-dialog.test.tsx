/**
 * @fileoverview AskHumanDialog 组件单元测试
 *
 * 测试逐题问答流程：text、number、single-select、multi-select 四种题型，
 * 以及多题顺序回答、context 显示、答案格式。
 * mock 策略：mock @inkjs/ui 的 TextInput/Select/MultiSelect，捕获 onSubmit/onChange。
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

// ── 辅助 ──

function resetCaptures() {
  capturedTextInputOnSubmit = null;
  capturedSelectOnChange = null;
  capturedMultiSelectOnSubmit = null;
}

// ── 测试用例 ──

describe('AskHumanDialog', () => {
  beforeEach(resetCaptures);

  it('显示第一题（text 类型）', () => {
    const questions: Question[] = [{ id: 'q1', question: 'What is your name?', type: 'text' }];
    const onAnswer = vi.fn();
    const { lastFrame } = render(<AskHumanDialog questions={questions} onAnswer={onAnswer} />);
    const frame = lastFrame();
    expect(frame).toContain('[1/1]');
    expect(frame).toContain('What is your name?');
  });

  it('显示 context 信息', () => {
    const questions: Question[] = [{ id: 'q1', question: 'Name?', type: 'text' }];
    const onAnswer = vi.fn();
    const { lastFrame } = render(
      <AskHumanDialog questions={questions} context="Need your info" onAnswer={onAnswer} />
    );
    expect(lastFrame()).toContain('Need your info');
  });

  it('不显示 context（无 context 时）', () => {
    const questions: Question[] = [{ id: 'q1', question: 'Name?', type: 'text' }];
    const onAnswer = vi.fn();
    const { lastFrame } = render(<AskHumanDialog questions={questions} onAnswer={onAnswer} />);
    // 只检查不崩溃，不含额外 context 文字
    expect(lastFrame()).toContain('Name?');
  });

  it('text 类型提交答案后调用 onAnswer', () => {
    const questions: Question[] = [{ id: 'q1', question: 'Name?', type: 'text' }];
    const onAnswer = vi.fn();
    render(<AskHumanDialog questions={questions} onAnswer={onAnswer} />);

    expect(capturedTextInputOnSubmit).not.toBeNull();
    capturedTextInputOnSubmit!('Alice');

    expect(onAnswer).toHaveBeenCalledOnce();
    const response = onAnswer.mock.calls[0][0] as HumanResponse;
    expect(response.q1).toEqual({ type: 'direct', value: 'Alice' });
  });

  it('number 类型解析为数字', () => {
    const questions: Question[] = [{ id: 'q1', question: 'How old?', type: 'number' }];
    const onAnswer = vi.fn();
    render(<AskHumanDialog questions={questions} onAnswer={onAnswer} />);

    capturedTextInputOnSubmit!('42');

    const response = onAnswer.mock.calls[0][0] as HumanResponse;
    expect(response.q1).toEqual({ type: 'direct', value: 42 });
  });

  it('number 类型无效输入保留原字符串', () => {
    const questions: Question[] = [{ id: 'q1', question: 'How old?', type: 'number' }];
    const onAnswer = vi.fn();
    render(<AskHumanDialog questions={questions} onAnswer={onAnswer} />);

    capturedTextInputOnSubmit!('not-a-number');

    const response = onAnswer.mock.calls[0][0] as HumanResponse;
    expect(response.q1).toEqual({ type: 'direct', value: 'not-a-number' });
  });

  it('single-select 类型使用 Select onChange', () => {
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

  it('multi-select 类型使用 MultiSelect onSubmit', () => {
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

  it('多题顺序回答：第一题答完后显示第二题', async () => {
    const questions: Question[] = [
      { id: 'q1', question: 'Name?', type: 'text' },
      { id: 'q2', question: 'Age?', type: 'number' },
    ];
    const onAnswer = vi.fn();
    const { lastFrame } = render(<AskHumanDialog questions={questions} onAnswer={onAnswer} />);

    // 第一题
    expect(lastFrame()).toContain('[1/2]');
    expect(lastFrame()).toContain('Name?');

    // 提交第一题答案
    capturedTextInputOnSubmit!('Bob');

    // 等待重渲染，第二题出现
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('[2/2]');
      expect(lastFrame()).toContain('Age?');
    });

    // 此时 onAnswer 还没调用（还有第二题）
    expect(onAnswer).not.toHaveBeenCalled();

    // 提交第二题
    capturedTextInputOnSubmit!('25');

    // 现在两题都答完，onAnswer 被调用
    await vi.waitFor(() => {
      expect(onAnswer).toHaveBeenCalledOnce();
    });
    const response = onAnswer.mock.calls[0][0] as HumanResponse;
    expect(response.q1).toEqual({ type: 'direct', value: 'Bob' });
    expect(response.q2).toEqual({ type: 'direct', value: 25 });
  });

  it('三题混合类型完整流程', async () => {
    const questions: Question[] = [
      { id: 'name', question: 'Your name?', type: 'text' },
      { id: 'color', question: 'Favorite color?', type: 'single-select', options: ['red', 'blue'] },
      { id: 'skills', question: 'Your skills?', type: 'multi-select', options: ['js', 'ts', 'go'] },
    ];
    const onAnswer = vi.fn();
    const { lastFrame } = render(<AskHumanDialog questions={questions} onAnswer={onAnswer} />);

    // 第一题（text）
    expect(lastFrame()).toContain('[1/3]');
    capturedTextInputOnSubmit!('Alice');

    // 等待第二题（single-select）
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('[2/3]');
    });
    capturedSelectOnChange!('blue');

    // 等待第三题（multi-select）
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('[3/3]');
    });
    capturedMultiSelectOnSubmit!(['js', 'ts']);

    // 最终结果
    await vi.waitFor(() => {
      expect(onAnswer).toHaveBeenCalledOnce();
    });
    const response = onAnswer.mock.calls[0][0] as HumanResponse;
    expect(response.name).toEqual({ type: 'direct', value: 'Alice' });
    expect(response.color).toEqual({ type: 'direct', value: 'blue' });
    expect(response.skills).toEqual({ type: 'direct', value: ['js', 'ts'] });
  });

  it('unmount 不报错', () => {
    const questions: Question[] = [{ id: 'q1', question: 'Name?', type: 'text' }];
    const onAnswer = vi.fn();
    const { unmount } = render(<AskHumanDialog questions={questions} onAnswer={onAnswer} />);
    expect(() => unmount()).not.toThrow();
  });
});
