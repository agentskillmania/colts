/**
 * @fileoverview TimelineEntry type and filtering logic unit tests
 */

import { describe, it, expect } from 'vitest';
import {
  type TimelineEntry,
  type DetailLevel,
  isVisible,
  filterByDetailLevel,
  VISIBILITY_MAP,
} from '../../src/types/timeline.js';

/** Create an entry of specified type (minimum fields) */
function makeEntry(type: TimelineEntry['type'], overrides?: Partial<TimelineEntry>): TimelineEntry {
  const base: TimelineEntry = {
    type: 'system' as const,
    id: 'test-1',
    content: 'test',
    timestamp: Date.now(),
  };
  // Build minimum entry according to type
  switch (type) {
    case 'user':
      return { type, id: 'test-1', content: 'hello', timestamp: Date.now(), ...overrides };
    case 'assistant':
      return { type, id: 'test-1', content: 'hi', timestamp: Date.now(), ...overrides };
    case 'tool':
      return { type, id: 'test-1', tool: 'read_file', timestamp: Date.now(), ...overrides };
    case 'phase':
      return {
        type,
        id: 'test-1',
        from: 'idle',
        to: 'preparing',
        timestamp: Date.now(),
        ...overrides,
      };
    case 'thought':
      return { type, id: 'test-1', content: 'thinking...', timestamp: Date.now(), ...overrides };
    case 'step-start':
      return { type, id: 'test-1', step: 0, timestamp: Date.now(), ...overrides };
    case 'step-end':
      return {
        type,
        id: 'test-1',
        step: 0,
        result: { type: 'done', answer: 'ok' },
        timestamp: Date.now(),
        ...overrides,
      };
    case 'run-complete':
      return {
        type,
        id: 'test-1',
        result: { type: 'success', answer: 'ok', totalSteps: 1 },
        timestamp: Date.now(),
        ...overrides,
      };
    case 'compress':
      return { type, id: 'test-1', status: 'compressing', timestamp: Date.now(), ...overrides };
    case 'skill':
      return {
        type,
        id: 'test-1',
        name: 'test-skill',
        status: 'loading',
        timestamp: Date.now(),
        ...overrides,
      };
    case 'subagent':
      return {
        type,
        id: 'test-1',
        name: 'researcher',
        status: 'start',
        timestamp: Date.now(),
        ...overrides,
      };
    case 'error':
      return {
        type,
        id: 'test-1',
        message: 'something broke',
        timestamp: Date.now(),
        ...overrides,
      };
    default:
      return { ...base, type, ...overrides };
  }
}

describe('isVisible', () => {
  // Verify visibility of all entry types under three levels
  const allTypes: TimelineEntry['type'][] = [
    'user',
    'assistant',
    'tool',
    'phase',
    'thought',
    'step-start',
    'step-end',
    'run-complete',
    'compress',
    'skill',
    'subagent',
    'system',
    'error',
  ];

  const levels: DetailLevel[] = ['compact', 'detail', 'verbose'];

  it.each(allTypes)(
    'should provide visibility definitions for all three levels for %s type',
    (entryType) => {
      const entry = makeEntry(entryType);
      for (const level of levels) {
        // Should not throw
        expect(() => isVisible(entry, level)).not.toThrow();
      }
    }
  );

  // compact mode only shows core info
  it('compact mode hides phase, thought, step-start, step-end, compress', () => {
    const hiddenTypes: TimelineEntry['type'][] = [
      'phase',
      'thought',
      'step-start',
      'step-end',
      'compress',
    ];
    for (const t of hiddenTypes) {
      expect(isVisible(makeEntry(t), 'compact')).toBe(false);
    }
  });

  it('compact mode shows user, assistant, tool, run-complete, skill, subagent, system, error', () => {
    const visibleTypes: TimelineEntry['type'][] = [
      'user',
      'assistant',
      'tool',
      'run-complete',
      'skill',
      'subagent',
      'system',
      'error',
    ];
    for (const t of visibleTypes) {
      expect(isVisible(makeEntry(t), 'compact')).toBe(true);
    }
  });

  // detail mode
  it('detail mode additionally shows step-start, step-end, compress', () => {
    const extraVisible: TimelineEntry['type'][] = ['step-start', 'step-end', 'compress'];
    for (const t of extraVisible) {
      expect(isVisible(makeEntry(t), 'detail')).toBe(true);
    }
  });

  it('detail mode still hides phase, thought', () => {
    const hidden: TimelineEntry['type'][] = ['phase', 'thought'];
    for (const t of hidden) {
      expect(isVisible(makeEntry(t), 'detail')).toBe(false);
    }
  });

  // verbose mode shows all
  it('verbose mode shows all entry types', () => {
    for (const t of allTypes) {
      expect(isVisible(makeEntry(t), 'verbose')).toBe(true);
    }
  });
});

describe('filterByDetailLevel', () => {
  it('filters entries by level', () => {
    const entries: TimelineEntry[] = [
      makeEntry('user'),
      makeEntry('phase'),
      makeEntry('assistant'),
      makeEntry('thought'),
    ];

    const compact = filterByDetailLevel(entries, 'compact');
    expect(compact).toHaveLength(2); // user + assistant
    expect(compact.map((e) => e.type)).toEqual(['user', 'assistant']);

    const verbose = filterByDetailLevel(entries, 'verbose');
    expect(verbose).toHaveLength(4);
  });

  it('empty array returns empty array', () => {
    expect(filterByDetailLevel([], 'compact')).toEqual([]);
  });
});

describe('VISIBILITY_MAP completeness', () => {
  it('each entry type has definitions for all three levels', () => {
    const expectedTypes: TimelineEntry['type'][] = [
      'user',
      'assistant',
      'tool',
      'phase',
      'thought',
      'step-start',
      'step-end',
      'run-complete',
      'compress',
      'skill',
      'subagent',
      'system',
      'error',
    ];

    for (const t of expectedTypes) {
      expect(VISIBILITY_MAP[t]).toBeDefined();
      expect(VISIBILITY_MAP[t].compact).toBeDefined();
      expect(VISIBILITY_MAP[t].detail).toBeDefined();
      expect(VISIBILITY_MAP[t].verbose).toBeDefined();
    }
  });
});
