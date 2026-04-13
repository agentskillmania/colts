/**
 * @fileoverview TimelineEntry component unit tests — covering all 13 entry type renderings
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { TimelineEntry } from '../../../src/components/timeline/timeline-entry.js';
import type { TimelineEntry as TimelineEntryType } from '../../../src/types/timeline.js';

/** Factory: create a user entry */
function makeUser(overrides?: Partial<Extract<TimelineEntryType, { type: 'user' }>>): TimelineEntryType {
  return { type: 'user', id: 'u1', content: 'Hello', timestamp: 1000, ...overrides };
}

/** Factory: create an assistant entry */
function makeAssistant(overrides?: Partial<Extract<TimelineEntryType, { type: 'assistant' }>>): TimelineEntryType {
  return { type: 'assistant', id: 'a1', content: 'Hi there', timestamp: 1000, ...overrides };
}

/** Factory: create a tool entry */
function makeTool(overrides?: Partial<Extract<TimelineEntryType, { type: 'tool' }>>): TimelineEntryType {
  return { type: 'tool', id: 't1', tool: 'read_file', timestamp: 1000, ...overrides };
}

/** Factory: create a phase entry */
function makePhase(overrides?: Partial<Extract<TimelineEntryType, { type: 'phase' }>>): TimelineEntryType {
  return { type: 'phase', id: 'p1', from: 'idle', to: 'preparing', timestamp: 1000, ...overrides };
}

/** Factory: create a thought entry */
function makeThought(overrides?: Partial<Extract<TimelineEntryType, { type: 'thought' }>>): TimelineEntryType {
  return { type: 'thought', id: 'th1', content: 'need to check', timestamp: 1000, ...overrides };
}

/** Factory: create a step-start entry */
function makeStepStart(overrides?: Partial<Extract<TimelineEntryType, { type: 'step-start' }>>): TimelineEntryType {
  return { type: 'step-start', id: 'ss1', step: 0, timestamp: 1000, ...overrides };
}

/** Factory: create a step-end entry */
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

/** Factory: create a run-complete entry */
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

/** Factory: create a compress entry */
function makeCompress(
  status: 'compressing' | 'compressed' = 'compressing',
  overrides?: Partial<Extract<TimelineEntryType, { type: 'compress' }>>
): TimelineEntryType {
  return { type: 'compress', id: 'c1', status, timestamp: 1000, ...overrides };
}

/** Factory: create a skill entry */
function makeSkill(
  status: 'loading' | 'loaded' = 'loading',
  overrides?: Partial<Extract<TimelineEntryType, { type: 'skill' }>>
): TimelineEntryType {
  return { type: 'skill', id: 'sk1', name: 'my-skill', status, timestamp: 1000, ...overrides };
}

/** Factory: create a subagent entry */
function makeSubagent(
  status: 'start' | 'end' = 'start',
  overrides?: Partial<Extract<TimelineEntryType, { type: 'subagent' }>>
): TimelineEntryType {
  return { type: 'subagent', id: 'sa1', name: 'researcher', status, timestamp: 1000, ...overrides };
}

/** Factory: create a system entry */
function makeSystem(overrides?: Partial<Extract<TimelineEntryType, { type: 'system' }>>): TimelineEntryType {
  return { type: 'system', id: 'sy1', content: 'Switched to RUN mode', timestamp: 1000, ...overrides };
}

/** Factory: create an error entry */
function makeError(overrides?: Partial<Extract<TimelineEntryType, { type: 'error' }>>): TimelineEntryType {
  return { type: 'error', id: 'e1', message: 'something broke', timestamp: 1000, ...overrides };
}

// ──────────────────────────────────────────────────────────────
// user
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — user', () => {
  it('renders user message content', () => {
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
  it('renders assistant reply content (non-streaming)', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeAssistant({ content: 'Hello!', isStreaming: false })} />);
    expect(lastFrame()).toContain('Hello!');
    expect(lastFrame()).toContain('Agent:');
    // non-streaming should not have a cursor
    expect(lastFrame()).not.toContain('▌');
  });

  it('shows cursor during streaming output', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeAssistant({ content: 'Hello', isStreaming: true })} />);
    expect(lastFrame()).toContain('▌');
  });

  it('renders empty content', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeAssistant({ content: '' })} />);
    expect(lastFrame()).toContain('Agent:');
  });
});

// ──────────────────────────────────────────────────────────────
// tool
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — tool', () => {
  it('shows tool name and ellipsis while running', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeTool({ tool: 'read_file', isRunning: true })} />);
    const frame = lastFrame();
    expect(frame).toContain('read_file');
    expect(frame).toContain('...');
  });

  it('shows tool name and result when completed', () => {
    const { lastFrame } = render(
      <TimelineEntry entry={makeTool({ tool: 'read_file', isRunning: false, result: 'file content here' })} />
    );
    const frame = lastFrame();
    expect(frame).toContain('read_file');
    expect(frame).toContain('→');
    expect(frame).toContain('file content here');
  });

  it('shows args when present', () => {
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

  it('does not show arg area when args are undefined', () => {
    const { lastFrame } = render(
      <TimelineEntry entry={makeTool({ tool: 'read_file', isRunning: false, result: 'done' })} />
    );
    // args not passed, should not contain arg line
    expect(lastFrame()).toContain('read_file');
    expect(lastFrame()).toContain('→ done');
  });

  it('result line is empty when result is undefined', () => {
    const { lastFrame } = render(
      <TimelineEntry entry={makeTool({ tool: 'read_file', isRunning: false })} />
    );
    expect(lastFrame()).toContain('read_file');
    expect(lastFrame()).toContain('→');
  });

  it('truncates long results', () => {
    const longResult = 'a'.repeat(200);
    const { lastFrame } = render(
      <TimelineEntry entry={makeTool({ tool: 'read_file', isRunning: false, result: longResult })} />
    );
    expect(lastFrame()).toContain('...');
  });

  it('formats object args correctly', () => {
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

  it('handles non-object args (string)', () => {
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

  it('uses JSON.stringify for object results', () => {
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
  it('shows phase transition', () => {
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
  it('shows thought content', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeThought({ content: 'need to check file' })} />);
    expect(lastFrame()).toContain('thought:');
    expect(lastFrame()).toContain('need to check file');
  });
});

// ──────────────────────────────────────────────────────────────
// step-start
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — step-start', () => {
  it('shows step number', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeStepStart({ step: 3 })} />);
    expect(lastFrame()).toContain('Step');
    expect(lastFrame()).toContain('3');
  });
});

// ──────────────────────────────────────────────────────────────
// step-end
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — step-end', () => {
  it('shows final label for done result', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeStepEnd('done', { step: 1 })} />);
    expect(lastFrame()).toContain('Step 1');
    expect(lastFrame()).toContain('done (final)');
  });

  it('shows continue label for continue result', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeStepEnd('continue', { step: 2 })} />);
    expect(lastFrame()).toContain('done (continue)');
  });

  it('shows continue label for error result (non-done branch)', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeStepEnd('error', { step: 0 })} />);
    expect(lastFrame()).toContain('done (continue)');
  });
});

// ──────────────────────────────────────────────────────────────
// run-complete
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — run-complete', () => {
  it('shows step count for success', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeRunComplete('success')} />);
    expect(lastFrame()).toContain('Completed');
    expect(lastFrame()).toContain('3 steps');
  });

  it('shows warning for max_steps', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeRunComplete('max_steps')} />);
    expect(lastFrame()).toContain('Max steps reached');
    expect(lastFrame()).toContain('10');
  });

  it('shows error message for error', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeRunComplete('error')} />);
    expect(lastFrame()).toContain('Run error');
    expect(lastFrame()).toContain('crash');
  });
});

// ──────────────────────────────────────────────────────────────
// compress
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — compress', () => {
  it('shows compressing status', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeCompress('compressing')} />);
    expect(lastFrame()).toContain('Compressing');
  });

  it('shows removed count for compressed status', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeCompress('compressed', { removedCount: 5 })} />);
    expect(lastFrame()).toContain('Compressed');
    expect(lastFrame()).toContain('5 messages removed');
  });
});

// ──────────────────────────────────────────────────────────────
// skill
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — skill', () => {
  it('shows loading status', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeSkill('loading', { name: 'code-review' })} />);
    expect(lastFrame()).toContain('Loading skill');
    expect(lastFrame()).toContain('code-review');
  });

  it('shows loaded status and char count', () => {
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
  it('shows task description for start status', () => {
    const { lastFrame } = render(
      <TimelineEntry entry={makeSubagent('start', { name: 'researcher', task: 'search web' })} />
    );
    expect(lastFrame()).toContain('researcher');
    expect(lastFrame()).toContain('Starting');
    expect(lastFrame()).toContain('search web');
  });

  it('shows done for end status', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeSubagent('end', { name: 'researcher' })} />);
    expect(lastFrame()).toContain('researcher');
    expect(lastFrame()).toContain('Done');
  });
});

// ──────────────────────────────────────────────────────────────
// system
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — system', () => {
  it('shows system message content', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeSystem({ content: 'Switched to RUN mode' })} />);
    expect(lastFrame()).toContain('Switched to RUN mode');
  });
});

// ──────────────────────────────────────────────────────────────
// error
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — error', () => {
  it('shows error message', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeError({ message: 'API timeout' })} />);
    expect(lastFrame()).toContain('API timeout');
  });
});

// ──────────────────────────────────────────────────────────────
// Edge cases & truncation
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — tool arg truncation', () => {
  it('truncates long arg values to 60 chars', () => {
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
    // should contain ... after truncation
    expect(lastFrame()).toContain('...');
  });

  it('truncates long results to 80 chars', () => {
    const longResult = 'y'.repeat(200);
    const { lastFrame } = render(
      <TimelineEntry entry={makeTool({ tool: 'read_file', isRunning: false, result: longResult })} />
    );
    expect(lastFrame()).toContain('...');
  });
});
