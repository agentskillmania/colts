/**
 * @fileoverview TimelineEntry 类型和过滤逻辑的单元测试
 */

import { describe, it, expect } from 'vitest';
import {
  type TimelineEntry,
  type DetailLevel,
  isVisible,
  filterByDetailLevel,
  VISIBILITY_MAP,
} from '../../src/types/timeline.js';

/** 创建指定类型的条目（最小字段） */
function makeEntry(type: TimelineEntry['type'], overrides?: Partial<TimelineEntry>): TimelineEntry {
  const base: TimelineEntry = {
    type: 'system' as const,
    id: 'test-1',
    content: 'test',
    timestamp: Date.now(),
  };
  // 根据类型构建最小条目
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
  // 验证所有条目类型在三个级别下的可见性
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

  it.each(allTypes)('应该为 %s 类型提供所有三个级别的可见性定义', (entryType) => {
    const entry = makeEntry(entryType);
    for (const level of levels) {
      // 不应抛异常
      expect(() => isVisible(entry, level)).not.toThrow();
    }
  });

  // compact 模式只显示核心信息
  it('compact 模式隐藏 phase、thought、step-start、step-end、compress', () => {
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

  it('compact 模式显示 user、assistant、tool、run-complete、skill、subagent、system、error', () => {
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

  // detail 模式
  it('detail 模式额外显示 step-start、step-end、compress', () => {
    const extraVisible: TimelineEntry['type'][] = ['step-start', 'step-end', 'compress'];
    for (const t of extraVisible) {
      expect(isVisible(makeEntry(t), 'detail')).toBe(true);
    }
  });

  it('detail 模式仍然隐藏 phase、thought', () => {
    const hidden: TimelineEntry['type'][] = ['phase', 'thought'];
    for (const t of hidden) {
      expect(isVisible(makeEntry(t), 'detail')).toBe(false);
    }
  });

  // verbose 模式显示所有
  it('verbose 模式显示所有条目类型', () => {
    for (const t of allTypes) {
      expect(isVisible(makeEntry(t), 'verbose')).toBe(true);
    }
  });
});

describe('filterByDetailLevel', () => {
  it('根据 level 过滤条目', () => {
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

  it('空数组返回空数组', () => {
    expect(filterByDetailLevel([], 'compact')).toEqual([]);
  });
});

describe('VISIBILITY_MAP 完整性', () => {
  it('每个条目类型都有三个级别的定义', () => {
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
