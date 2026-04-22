/**
 * @fileoverview TimelineEntry component unit tests — covers rendering of all 13 entry types
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { TimelineEntry } from '../../../src/components/timeline/timeline-entry.js';
import type { TimelineEntry as TimelineEntryType } from '../../../src/types/timeline.js';
import { ICONS } from '../../../src/utils/theme.js';

// ── Factory functions ──

let testSeq = 0;
function seq(): number {
  return ++testSeq;
}

/** Create user entry */
function makeUser(
  overrides?: Partial<Extract<TimelineEntryType, { type: 'user' }>>
): TimelineEntryType {
  return { type: 'user', id: 'u1', seq: seq(), content: 'Hello', timestamp: 1000, ...overrides };
}

/** Create assistant entry */
function makeAssistant(
  overrides?: Partial<Extract<TimelineEntryType, { type: 'assistant' }>>
): TimelineEntryType {
  return {
    type: 'assistant',
    id: 'a1',
    seq: seq(),
    content: 'Hi there',
    timestamp: 1000,
    ...overrides,
  };
}

/** Create tool entry */
function makeTool(
  overrides?: Partial<Extract<TimelineEntryType, { type: 'tool' }>>
): TimelineEntryType {
  return { type: 'tool', id: 't1', seq: seq(), tool: 'read_file', timestamp: 1000, ...overrides };
}

/** Create phase entry */
function makePhase(
  overrides?: Partial<Extract<TimelineEntryType, { type: 'phase' }>>
): TimelineEntryType {
  return {
    type: 'phase',
    id: 'p1',
    seq: seq(),
    from: 'idle',
    to: 'preparing',
    timestamp: 1000,
    ...overrides,
  };
}

/** Create thought entry */
function makeThought(
  overrides?: Partial<Extract<TimelineEntryType, { type: 'thought' }>>
): TimelineEntryType {
  return {
    type: 'thought',
    id: 'th1',
    seq: seq(),
    content: 'need to check',
    timestamp: 1000,
    ...overrides,
  };
}

/** Create step-start entry */
function makeStepStart(
  overrides?: Partial<Extract<TimelineEntryType, { type: 'step-start' }>>
): TimelineEntryType {
  return { type: 'step-start', id: 'ss1', seq: seq(), step: 0, timestamp: 1000, ...overrides };
}

/** Create step-end entry */
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
  return {
    type: 'step-end',
    id: 'se1',
    seq: seq(),
    step: 0,
    result,
    timestamp: 1000,
    ...overrides,
  };
}

/** Create run-complete entry */
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
  return { type: 'run-complete', id: 'rc1', seq: seq(), result, timestamp: 1000, ...overrides };
}

/** Create compress entry */
function makeCompress(
  status: 'compressing' | 'compressed' = 'compressing',
  overrides?: Partial<Extract<TimelineEntryType, { type: 'compress' }>>
): TimelineEntryType {
  return { type: 'compress', id: 'c1', seq: seq(), status, timestamp: 1000, ...overrides };
}

/** Create skill entry */
function makeSkill(
  status: 'loading' | 'loaded' | 'active' | 'completed' = 'loading',
  overrides?: Partial<Extract<TimelineEntryType, { type: 'skill' }>>
): TimelineEntryType {
  return {
    type: 'skill',
    id: 'sk1',
    seq: seq(),
    name: 'my-skill',
    status,
    timestamp: 1000,
    ...overrides,
  };
}

/** Create subagent entry */
function makeSubagent(
  status: 'start' | 'end' = 'start',
  overrides?: Partial<Extract<TimelineEntryType, { type: 'subagent' }>>
): TimelineEntryType {
  return {
    type: 'subagent',
    id: 'sa1',
    seq: seq(),
    name: 'researcher',
    status,
    timestamp: 1000,
    ...overrides,
  };
}

/** Create system entry */
function makeSystem(
  overrides?: Partial<Extract<TimelineEntryType, { type: 'system' }>>
): TimelineEntryType {
  return {
    type: 'system',
    id: 'sy1',
    seq: seq(),
    content: 'Switched to RUN mode',
    timestamp: 1000,
    ...overrides,
  };
}

/** Create error entry */
function makeError(
  overrides?: Partial<Extract<TimelineEntryType, { type: 'error' }>>
): TimelineEntryType {
  return {
    type: 'error',
    id: 'e1',
    seq: seq(),
    message: 'something broke',
    timestamp: 1000,
    ...overrides,
  };
}

/** Create llm-request entry */
function makeLlmRequest(
  overrides?: Partial<Extract<TimelineEntryType, { type: 'llm-request' }>>
): TimelineEntryType {
  return {
    type: 'llm-request',
    id: 'lr1',
    seq: seq(),
    messageCount: 3,
    tools: [],
    skill: null,
    timestamp: 1000,
    ...overrides,
  };
}

/** Create llm-response entry */
function makeLlmResponse(
  overrides?: Partial<Extract<TimelineEntryType, { type: 'llm-response' }>>
): TimelineEntryType {
  return {
    type: 'llm-response',
    id: 'lrs1',
    seq: seq(),
    textLength: 100,
    toolCalls: null,
    timestamp: 1000,
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────
// user
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — user', () => {
  it('renders user message with icon', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeUser({ content: 'Read main.ts' })} />);
    const frame = lastFrame();
    expect(frame).toContain(ICONS.user);
    expect(frame).toContain('Read main.ts');
  });
});

// ──────────────────────────────────────────────────────────────
// assistant
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — assistant', () => {
  it('renders assistant reply with icon (non-streaming)', () => {
    const { lastFrame } = render(
      <TimelineEntry entry={makeAssistant({ content: 'Hello!', isStreaming: false })} />
    );
    expect(lastFrame()).toContain('Hello!');
    expect(lastFrame()).toContain(ICONS.assistant);
    expect(lastFrame()).not.toContain('▌');
  });

  it('shows cursor during streaming output', () => {
    const { lastFrame } = render(
      <TimelineEntry entry={makeAssistant({ content: 'Hello', isStreaming: true })} />
    );
    expect(lastFrame()).toContain('▌');
  });

  it('renders empty content with icon', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeAssistant({ content: '' })} />);
    expect(lastFrame()).toContain(ICONS.assistant);
  });
});

// ──────────────────────────────────────────────────────────────
// tool
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — tool', () => {
  it('shows tool name with running icon while running', () => {
    const { lastFrame } = render(
      <TimelineEntry entry={makeTool({ tool: 'read_file', isRunning: true })} />
    );
    const frame = lastFrame();
    expect(frame).toContain('read_file');
    expect(frame).toContain('...');
    expect(frame).toContain(ICONS.toolRunning);
  });

  it('shows tool name with done icon and result when completed', () => {
    const { lastFrame } = render(
      <TimelineEntry
        entry={makeTool({ tool: 'read_file', isRunning: false, result: 'file content here' })}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain('read_file');
    expect(frame).toContain('→');
    expect(frame).toContain('file content here');
    expect(frame).toContain(ICONS.toolDone);
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
      <TimelineEntry
        entry={makeTool({ tool: 'read_file', isRunning: false, result: longResult })}
      />
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

  it('shows duration when present', () => {
    const { lastFrame } = render(
      <TimelineEntry
        entry={makeTool({ tool: 'read_file', isRunning: false, result: 'ok', duration: 1500 })}
      />
    );
    expect(lastFrame()).toContain('1.5s');
  });

  it('shows error icon for error results', () => {
    const { lastFrame } = render(
      <TimelineEntry
        entry={makeTool({ tool: 'read_file', isRunning: false, result: 'Error: file not found' })}
      />
    );
    expect(lastFrame()).toContain(ICONS.toolError);
  });
});

// ──────────────────────────────────────────────────────────────
// phase
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — phase', () => {
  it('shows phase transition', () => {
    const { lastFrame } = render(
      <TimelineEntry entry={makePhase({ from: 'idle', to: 'calling-llm' })} />
    );
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
    const { lastFrame } = render(
      <TimelineEntry entry={makeThought({ content: 'need to check file' })} />
    );
    expect(lastFrame()).toContain(ICONS.thought);
    expect(lastFrame()).toContain('need to check file');
  });
});

// ──────────────────────────────────────────────────────────────
// step-start
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — step-start', () => {
  it('shows step number as separator', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeStepStart({ step: 3 })} />);
    const frame = lastFrame();
    expect(frame).toContain('Step');
    expect(frame).toContain('3');
    expect(frame).toContain(ICONS.separator);
  });
});

// ──────────────────────────────────────────────────────────────
// step-end
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — step-end', () => {
  it('shows done label for done result', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeStepEnd('done', { step: 1 })} />);
    const frame = lastFrame();
    expect(frame).toContain('Step 1');
    expect(frame).toContain('done');
  });

  it('shows continue label for continue result', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeStepEnd('continue', { step: 2 })} />);
    expect(lastFrame()).toContain('Step 2');
    expect(lastFrame()).toContain('continue');
  });

  it('shows continue label for error result (non-done branch)', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeStepEnd('error', { step: 0 })} />);
    expect(lastFrame()).toContain('Step 0');
    expect(lastFrame()).toContain('continue');
  });

  it('shows answer preview for done result', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeStepEnd('done', { step: 1 })} />);
    expect(lastFrame()).toContain('ok');
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
    expect(lastFrame()).toContain(ICONS.compress);
  });

  it('shows removed count for compressed status', () => {
    const { lastFrame } = render(
      <TimelineEntry entry={makeCompress('compressed', { removedCount: 5 })} />
    );
    expect(lastFrame()).toContain('Compressed');
    expect(lastFrame()).toContain('5 messages removed');
  });

  it('shows summary when present', () => {
    const { lastFrame } = render(
      <TimelineEntry
        entry={makeCompress('compressed', { removedCount: 3, summary: 'kept key info' })}
      />
    );
    expect(lastFrame()).toContain('kept key info');
  });
});

// ──────────────────────────────────────────────────────────────
// skill
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — skill', () => {
  it('shows loading status', () => {
    const { lastFrame } = render(
      <TimelineEntry entry={makeSkill('loading', { name: 'code-review' })} />
    );
    expect(lastFrame()).toContain('Loading');
    expect(lastFrame()).toContain('code-review');
    expect(lastFrame()).toContain(ICONS.skill);
  });

  it('shows loaded status and char count', () => {
    const { lastFrame } = render(
      <TimelineEntry entry={makeSkill('loaded', { name: 'code-review', tokenCount: 1234 })} />
    );
    expect(lastFrame()).toContain('Loaded');
    expect(lastFrame()).toContain('code-review');
    expect(lastFrame()).toContain('1234 chars');
  });

  it('shows active status', () => {
    const { lastFrame } = render(<TimelineEntry entry={makeSkill('active', { name: 'search' })} />);
    expect(lastFrame()).toContain('Activated');
    expect(lastFrame()).toContain('search');
  });

  it('shows completed status with result', () => {
    const { lastFrame } = render(
      <TimelineEntry entry={makeSkill('completed', { name: 'search', result: 'found 3 items' })} />
    );
    expect(lastFrame()).toContain('Completed');
    expect(lastFrame()).toContain('search');
    expect(lastFrame()).toContain('found 3 items');
  });

  it('truncates long results in completed status', () => {
    const longResult = 'x'.repeat(100);
    const { lastFrame } = render(
      <TimelineEntry entry={makeSkill('completed', { name: 'search', result: longResult })} />
    );
    expect(lastFrame()).toContain('...');
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
    expect(lastFrame()).toContain('search web');
    expect(lastFrame()).toContain(ICONS.subagent);
  });

  it('shows done for end status', () => {
    const { lastFrame } = render(
      <TimelineEntry entry={makeSubagent('end', { name: 'researcher' })} />
    );
    expect(lastFrame()).toContain('researcher');
    expect(lastFrame()).toContain('done');
  });

  it('shows result summary for end status', () => {
    const { lastFrame } = render(
      <TimelineEntry entry={makeSubagent('end', { name: 'researcher', result: 'found 3 files' })} />
    );
    expect(lastFrame()).toContain('found 3 files');
  });
});

// ──────────────────────────────────────────────────────────────
// system
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — system', () => {
  it('shows system message content', () => {
    const { lastFrame } = render(
      <TimelineEntry entry={makeSystem({ content: 'Switched to RUN mode' })} />
    );
    expect(lastFrame()).toContain('Switched to RUN mode');
    expect(lastFrame()).toContain(ICONS.system);
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
// llm-request
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — llm-request', () => {
  it('shows message count', () => {
    const { lastFrame } = render(
      <TimelineEntry entry={makeLlmRequest({ messageCount: 5, tools: ['read_file', 'search'] })} />
    );
    expect(lastFrame()).toContain('5 messages');
    expect(lastFrame()).toContain('read_file');
    expect(lastFrame()).toContain('search');
  });

  it('shows skill context when present', () => {
    const { lastFrame } = render(
      <TimelineEntry
        entry={makeLlmRequest({
          messageCount: 3,
          tools: [],
          skill: { current: 'code-review', stack: ['root'] },
        })}
      />
    );
    expect(lastFrame()).toContain('skill: code-review');
  });

  it('hides tools line when empty', () => {
    const { lastFrame } = render(
      <TimelineEntry entry={makeLlmRequest({ messageCount: 2, tools: [] })} />
    );
    expect(lastFrame()).toContain('2 messages');
    expect(lastFrame()).not.toContain('tools:');
  });
});

// ──────────────────────────────────────────────────────────────
// llm-response
// ──────────────────────────────────────────────────────────────

describe('TimelineEntry — llm-response', () => {
  it('shows text length', () => {
    const { lastFrame } = render(
      <TimelineEntry entry={makeLlmResponse({ textLength: 256, toolCalls: null })} />
    );
    expect(lastFrame()).toContain('256 chars');
  });

  it('shows tool call names', () => {
    const { lastFrame } = render(
      <TimelineEntry
        entry={makeLlmResponse({
          textLength: 100,
          toolCalls: [
            { id: 'c1', name: 'read_file', arguments: { path: 'main.ts' } },
            { id: 'c2', name: 'search', arguments: { query: 'test' } },
          ],
        })}
      />
    );
    expect(lastFrame()).toContain('read_file');
    expect(lastFrame()).toContain('search');
    expect(lastFrame()).toContain('tool calls:');
  });

  it('hides tool calls line when null', () => {
    const { lastFrame } = render(
      <TimelineEntry entry={makeLlmResponse({ textLength: 50, toolCalls: null })} />
    );
    expect(lastFrame()).not.toContain('tool calls:');
  });
});

// ──────────────────────────────────────────────────────────────
// Tool arg truncation
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
    expect(lastFrame()).toContain('...');
  });

  it('truncates long results to 80 chars', () => {
    const longResult = 'y'.repeat(200);
    const { lastFrame } = render(
      <TimelineEntry
        entry={makeTool({ tool: 'read_file', isRunning: false, result: longResult })}
      />
    );
    expect(lastFrame()).toContain('...');
  });
});
