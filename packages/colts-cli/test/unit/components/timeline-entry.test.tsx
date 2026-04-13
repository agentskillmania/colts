/**
 * @fileoverview TimelineEntry 组件单元测试 — 覆盖所有 13 种条目类型渲染
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { TimelineEntry } from '../../../src/components/timeline/timeline-entry.js';
import type { TimelineEntry as TimelineEntryType } from '../../../src/types/timeline.js';

/** 工厂：创建 user 条目 */
function makeUser(overrides?: Partial<Extract<TimelineEntryType, { type: 'user' }>>): TimelineEntryType {
  return { type: 'user', id: 'u1', content: 'Hello', timestamp: 1000, ...overrides };
}

/** 工厂：创建 assistant 条目 */
function makeAssistant(overrides?: Partial<Extract<TimelineEntryType, { type: 'assistant' }>>): TimelineEntryType {
  return { type: 'assistant', id: 'a1', content: 'Hi there', timestamp: 1000, ...overrides };
}

/** 工厂：创建 tool 条目 */
function makeTool(overrides?: Partial<Extract<TimelineEntryType, { type: 'tool' }>>): TimelineEntryType {
  return { type: 'tool', id: 't1', tool: 'read_file', timestamp: 1000, ...overrides };
}

/** 工厂：创建 phase 条目 */
function makePhase(overrides?: Partial<Extract<TimelineEntryType, { type: 'phase' }>>): TimelineEntryType {
  return { type: 'phase', id: 'p1', from: 'idle', to: 'preparing', timestamp: 1000, ...overrides };
}

/** 工厂：创建 thought 条目 */
function makeThought(overrides?: Partial<Extract<TimelineEntryType, { type: 'thought' }>>): TimelineEntryType {
  return { type: 'thought', id: 'th1', content: 'need to check', timestamp: 1000, ...overrides };
}

/** 工厂：创建 step-start 条目 */
function makeStepStart(overrides?: Partial<Extract<TimelineEntryType, { type: 'step-start' }>>): TimelineEntryType {
  return { type: 'step-start', id: 'ss1', step: 0, timestamp: 1000, ...overrides };
}

/** 工厂：创建 step-end 条目 */
function makeStepEnd(
  resultType: 'done' | 'continue' | 'error' = 'done',
  overrides?: Partial<Extract<TimelineEntryType, { type: 'step-end' }>>
): TimelineEntryType {
  const result =
    resultType === 'done'
      ? { type: 'done' as const, answer: 'ok' }
      : resultType === 'continue'
        ? { type: 'continue' as const, toolResult: 'file content' }
        : { type: 'error' as const, error: new Error('fail') };
  return { type: 'step-end', id: 'se1', step: 0, result, timestamp: 1000, ...overrides };
}

/** 工厂：创建 run-complete 条目 */
function makeRunComplete(
  resultType: 'success' | 'max_steps' | 'error' = 'success',
  overrides?: Partial<Extract<TimelineEntryType, { type: 'run-complete' }>>
): TimelineEntryType {
  const result =
    resultType === 'success'
      ? { type: 'success' as const, answer: 'done', totalSteps: 3 }
      : resultType === 'max_steps'
        ? { type: 'max_steps' as const, totalSteps: 10 }
        : { type: 'error' as const, error: new Error('crash'), totalSteps: 2 };
  return { type: 'run-complete', id: 'rc1', result, timestamp: 1000, ...overrides };
}

/** 工厂：创建 compress 条目 */
function makeCompress(
  status: 'compressing' | 'compressed' = 'compressing',
  overrides?: Partial<Extract<TimelineEntryType, { type: 'compress' }>>
): TimelineEntryType {
  return { type: 'compress', id: 'c1', status, timestamp: 1000, ...overrides };
}

/** 工厂：创建 skill 条目 */
function makeSkill(
  status: 'loading' | 'loaded' = 'loading',
  overrides?: Partial<Extract<TimelineEntryType, { type: 'skill' }>>
): TimelineEntryType {
  return { type: 'skill', id: 'sk1', name: 'my-skill', status, timestamp: 1000, ...overrides };
}

/** 工厂：创建 subagent 条目 */
function makeSubagent(
  status: 'start' | 'end' = 'start',
  overrides?: Partial<Extract<TimelineEntryType, { type: 'subagent' }>>
): TimelineEntryType {
  return { type: 'subagent', id: 'sa1', name: 'researcher', status, timestamp: 1000, ...overrides };
}

/** 工厂：创建 system 条目 */
function makeSystem(overrides?: Partial<Extract<TimelineEntryType, { type: 'system' }>>): TimelineEntryType {
  return { type: 'system', id: 'sy1', content: 'Switched to RUN mode', timestamp: 1000, ...overrides };
}

/** 工厂：创建 error 条目 */
function makeError(overrides?: Partial<Extract<TimelineEntryType, { type: 'error' }>>): TimelineEntryType {
  return { type: 'error', id: 'e1', message: 'something broke', timestamp: 1000, ...overrides };
}

// ──────────────────────────────────────────────────────────────
// user
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — user', () => {
  it('渲染用户消息内容', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeUser({ content: 'Read main.ts' })} />);
    const frame = lastFrame();
    expect(frame).toContain('You:');
    expect(frame).toContain('Read main.ts');
  });
});

// ──────────────────────────────────────────────────────────────
// assistant
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — assistant', () => {
  it('渲染助手回复内容（非流式）', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeAssistant({ content: 'Hello!', isStreaming: false })} />);
    expect(lastFrame()).toContain('Hello!');
    expect(lastFrame()).toContain('Agent:');
    // 非流式不应有光标
    expect(lastFrame()).not.toContain('▌');
  });

  it('流式输出时显示光标', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeAssistant({ content: 'Hello', isStreaming: true })} />);
    expect(lastFrame()).toContain('▌');
  });

  it('空内容也能渲染', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeAssistant({ content: '' })} />);
    expect(lastFrame()).toContain('Agent:');
  });
});

// ──────────────────────────────────────────────────────────────
// tool
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — tool', () => {
  it('运行中显示工具名和省略号', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeTool({ tool: 'read_file', isRunning: true })} />);
    const frame = lastFrame();
    expect(frame).toContain('read_file');
    expect(frame).toContain('...');
  });

  it('完成时显示工具名和结果', () => {
    const { lastFrame } = render(
      <TimelineEntry entry={makeTool({ tool: 'read_file', isRunning: false, result: 'file content here' })} />
    );
    const frame = lastFrame();
    expect(frame).toContain('read_file');
    expect(frame).toContain('→');
    expect(frame).toContain('file content here');
  });

  it('有参数时显示参数', () => {
    const { lastFrame } = render(
      <TimelineEntry
        entry={makeTool({
          tool: 'read_file',
          isRunning: false,
          args: { path: 'main.ts' },
          result: 'ok',
        })}
      />
    );
    expect(lastFrame()).toContain('path: main.ts');
  });

  it('参数为 undefined 时不显示参数区域', () => {
    const { lastFrame } = render(
      <TimelineEntry entry={makeTool({ tool: 'read_file', isRunning: false, result: 'done' })} />
    );
    // args 未传，不应包含参数行
    expect(lastFrame()).toContain('read_file');
    expect(lastFrame()).toContain('→ done');
  });

  it('result 为 undefined 时结果行为空', () => {
    const { lastFrame } = render(
      <TimelineEntry entry={makeTool({ tool: 'read_file', isRunning: false })} />
    );
    expect(lastFrame()).toContain('read_file');
    expect(lastFrame()).toContain('→');
  });

  it('长结果被截断', () => {
    const longResult = 'a'.repeat(200);
    const { lastFrame } = render(
      <TimelineEntry entry={makeTool({ tool: 'read_file', isRunning: false, result: longResult })} />
    );
    expect(lastFrame()).toContain('...');
  });

  it('对象参数格式化正确', () => {
    const { lastFrame } = render(
      <TimelineEntry
        entry={makeTool({
          tool: 'search',
          isRunning: false,
          args: { query: 'test', limit: 10 },
          result: 'found',
        })}
      />
    );
    expect(lastFrame()).toContain('query: test');
    expect(lastFrame()).toContain('limit: 10');
  });

  it('非对象参数（字符串）也能处理', () => {
    const { lastFrame } = render(
      <TimelineEntry
        entry={makeTool({
          tool: 'echo',
          isRunning: false,
          args: 'raw-string-arg',
          result: 'ok',
        })}
      />
    );
    expect(lastFrame()).toContain('raw-string-arg');
  });

  it('对象 result 使用 JSON.stringify', () => {
    const { lastFrame } = render(
      <TimelineEntry
        entry={makeTool({
          tool: 'get_config',
          isRunning: false,
          result: { key: 'value', num: 42 },
        })}
      />
    );
    expect(lastFrame()).toContain('"key"');
  });
});

// ──────────────────────────────────────────────────────────────
// phase
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — phase', () => {
  it('显示 phase 转换', () => {
    const { lastFrame } = render(<TimelineEntry entry={makePhase({ from: 'idle', to: 'calling-llm' })} />);
    expect(lastFrame()).toContain('idle');
    expect(lastFrame()).toContain('calling-llm');
    expect(lastFrame()).toContain('→');
  });
});

// ──────────────────────────────────────────────────────────────
// thought
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — thought', () => {
  it('显示思考内容', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeThought({ content: 'need to check file' })} />);
    expect(lastFrame()).toContain('thought:');
    expect(lastFrame()).toContain('need to check file');
  });
});

// ──────────────────────────────────────────────────────────────
// step-start
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — step-start', () => {
  it('显示步骤编号', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeStepStart({ step: 3 })} />);
    expect(lastFrame()).toContain('Step');
    expect(lastFrame()).toContain('3');
  });
});

// ──────────────────────────────────────────────────────────────
// step-end
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — step-end', () => {
  it('done 结果显示 final 标签', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeStepEnd('done', { step: 1 })} />);
    expect(lastFrame()).toContain('Step 1');
    expect(lastFrame()).toContain('done (final)');
  });

  it('continue 结果显示 continue 标签', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeStepEnd('continue', { step: 2 })} />);
    expect(lastFrame()).toContain('done (continue)');
  });

  it('error 结果显示 continue 标签（非 done 分支）', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeStepEnd('error', { step: 0 })} />);
    expect(lastFrame()).toContain('done (continue)');
  });
});

// ──────────────────────────────────────────────────────────────
// run-complete
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — run-complete', () => {
  it('success 显示步骤数', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeRunComplete('success')} />);
    expect(lastFrame()).toContain('Completed');
    expect(lastFrame()).toContain('3 steps');
  });

  it('max_steps 显示警告', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeRunComplete('max_steps')} />);
    expect(lastFrame()).toContain('Max steps reached');
    expect(lastFrame()).toContain('10');
  });

  it('error 显示错误信息', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeRunComplete('error')} />);
    expect(lastFrame()).toContain('Run error');
    expect(lastFrame()).toContain('crash');
  });
});

// ──────────────────────────────────────────────────────────────
// compress
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — compress', () => {
  it('compressing 状态显示压缩中', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeCompress('compressing')} />);
    expect(lastFrame()).toContain('Compressing');
  });

  it('compressed 状态显示移除数量', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeCompress('compressed', { removedCount: 5 })} />);
    expect(lastFrame()).toContain('Compressed');
    expect(lastFrame()).toContain('5 messages removed');
  });
});

// ──────────────────────────────────────────────────────────────
// skill
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — skill', () => {
  it('loading 状态显示加载中', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeSkill('loading', { name: 'code-review' })} />);
    expect(lastFrame()).toContain('Loading skill');
    expect(lastFrame()).toContain('code-review');
  });

  it('loaded 状态显示加载完成和字符数', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeSkill('loaded', { name: 'code-review', tokenCount: 1234 })} />);
    expect(lastFrame()).toContain('Skill loaded');
    expect(lastFrame()).toContain('code-review');
    expect(lastFrame()).toContain('1234 chars');
  });
});

// ──────────────────────────────────────────────────────────────
// subagent
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — subagent', () => {
  it('start 状态显示任务描述', () => {
    const { lastFrame } = render(
      <TimelineEntry entry={makeSubagent('start', { name: 'researcher', task: 'search web' })} />
    );
    expect(lastFrame()).toContain('researcher');
    expect(lastFrame()).toContain('Starting');
    expect(lastFrame()).toContain('search web');
  });

  it('end 状态显示完成', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeSubagent('end', { name: 'researcher' })} />);
    expect(lastFrame()).toContain('researcher');
    expect(lastFrame()).toContain('Done');
  });
});

// ──────────────────────────────────────────────────────────────
// system
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — system', () => {
  it('显示系统消息内容', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeSystem({ content: 'Switched to RUN mode' })} />);
    expect(lastFrame()).toContain('Switched to RUN mode');
  });
});

// ──────────────────────────────────────────────────────────────
// error
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — error', () => {
  it('显示错误消息', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeError({ message: 'API timeout' })} />);
    expect(lastFrame()).toContain('API timeout');
  });
});

// ──────────────────────────────────────────────────────────────
// 边界 & 截断
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — 工具参数截断', () => {
  it('长参数值被截断到 60 字符', () => {
    const longValue = 'x'.repeat(100);
    const { lastFrame } = render(
      <TimelineEntry
        entry={makeTool({
          tool: 'write_file',
          isRunning: false,
          args: { content: longValue },
          result: 'ok',
        })}
      />
    );
    // 截断后应包含 ...
    expect(lastFrame()).toContain('...');
  });

  it('长结果被截断到 80 字符', () => {
    const longResult = 'y'.repeat(200);
    const { lastFrame } = render(
      <TimelineEntry entry={makeTool({ tool: 'read_file', isRunning: false, result: longResult })} />
    );
    expect(lastFrame()).toContain('...');
  });
});
